const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EPSILON_MS = 2000;
const MAX_RETRIES = 4;
const BASE_DELAY = 1000;
const API_BASE = 'https://www.googleapis.com/drive/v3';

class Semaphore {
  constructor(max) {
    this.max = max;
    this.current = 0;
    this.queue = [];
  }

  async run(fn) {
    if (this.current >= this.max) {
      await new Promise(resolve => this.queue.push(resolve));
    }
    this.current++;
    try {
      return await fn();
    } finally {
      this.current--;
      if (this.queue.length > 0) {
        this.queue.shift()();
      }
    }
  }
}

class DiffEngine {
  constructor(options = {}) {
    this.localPath = options.localPath;
    this.accessToken = options.accessToken;
    this.parentFolderId = options.parentFolderId || 'root';
    this.maxConcurrent = options.maxConcurrentRequests || 3;
    this.onProgress = options.onProgress || (() => {});
    this.isWindows = process.platform === 'win32';
    this.semaphore = new Semaphore(this.maxConcurrent);
    this.aborted = false;
  }

  async run() {
    this.onProgress({
      status: 'SYNC_HASHING',
      currentFile: 'Scanning local files...',
      processedFiles: 0,
      totalFiles: 0,
      percentage: 0,
      speed: ''
    });

    const localFiles = await this.scanLocalFiles();

    this.onProgress({
      status: 'SYNC_HASHING',
      currentFile: 'Fetching remote file list...',
      processedFiles: 0,
      totalFiles: localFiles.length,
      percentage: 0,
      speed: ''
    });

    const remoteFiles = await this.fetchRemoteFiles();

    this.onProgress({
      status: 'SYNC_PROCESSING',
      currentFile: 'Comparing files...',
      processedFiles: 0,
      totalFiles: Math.max(localFiles.length, remoteFiles.length),
      percentage: 0,
      speed: ''
    });

    const result = this.diff(localFiles, remoteFiles);

    this.onProgress({
      status: 'SYNC_PROCESSING',
      currentFile: 'Diff analysis complete',
      processedFiles: Math.max(localFiles.length, remoteFiles.length),
      totalFiles: Math.max(localFiles.length, remoteFiles.length),
      percentage: 100,
      speed: ''
    });

    return result;
  }

  abort() {
    this.aborted = true;
  }

  async computeMD5(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('md5');
      const stream = fs.createReadStream(filePath);
      stream.on('data', chunk => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  async _scanDirectory(dirPath, relativePath) {
    const files = [];
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (this.aborted) return files;

      const fullPath = path.join(dirPath, entry.name);
      const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;

      if (entry.isDirectory()) {
        const subFiles = await this._scanDirectory(fullPath, relPath);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        this.onProgress({
          status: 'SYNC_HASHING',
          currentFile: relPath,
          processedFiles: files.length,
          totalFiles: 0,
          percentage: 0,
          speed: ''
        });
        const md5 = await this.computeMD5(fullPath);
        const stat = await fs.promises.stat(fullPath);
        files.push({
          localPath: fullPath,
          relativePath: relPath,
          md5,
          mtimeMs: stat.mtimeMs
        });
      }
    }

    return files;
  }

  async scanLocalFiles() {
    if (!this.localPath || !fs.existsSync(this.localPath)) {
      throw new Error(`Local path does not exist: ${this.localPath}`);
    }
    return this._scanDirectory(this.localPath, '');
  }

  async _fetchWithRetry(url, options, retries = MAX_RETRIES) {
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (this.aborted) throw new Error('Aborted');

      try {
        const response = await fetch(url, options);

        if (response.ok) return response;

        if (response.status === 403) {
          const body = await response.text().catch(() => '');
          const isRateLimit = body.includes('rateLimitExceeded') || body.includes('userRateLimitExceeded');

          if (!isRateLimit) {
            throw new Error(`API error 403: ${body || 'Insufficient permissions or access denied'}`);
          }

          const delay = Math.min(BASE_DELAY * Math.pow(2, attempt), 16000);
          this.onProgress({
            status: 'SYNC_PROCESSING',
            currentFile: `Rate limited, retrying in ${delay}ms...`,
            processedFiles: 0,
            totalFiles: 0,
            percentage: 0,
            speed: ''
          });
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        if (response.status === 401) {
          throw new Error('Access token expired');
        }

        const text = await response.text();
        throw new Error(`API error ${response.status}: ${text}`);
      } catch (err) {
        lastError = err;
        if (err.message === 'Aborted' || err.message === 'Access token expired') throw err;
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, BASE_DELAY * Math.pow(2, attempt)));
        }
      }
    }

    throw lastError || new Error('Max retries exceeded');
  }

  async fetchRemoteFiles() {
    const files = [];
    let pageToken = null;

    do {
      const params = new URLSearchParams({
        q: `'${this.parentFolderId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, md5Checksum, modifiedTime, mimeType)',
        pageSize: '100'
      });
      if (pageToken) {
        params.set('pageToken', pageToken);
      }

      const url = `${API_BASE}/files?${params.toString()}`;

      const response = await this.semaphore.run(() =>
        this._fetchWithRetry(url, {
          headers: { Authorization: `Bearer ${this.accessToken}` }
        })
      );

      const data = await response.json();

      for (const file of data.files || []) {
        files.push({
          id: file.id,
          name: file.name,
          md5Checksum: file.md5Checksum,
          modifiedTime: file.modifiedTime,
          mimeType: file.mimeType
        });

        this.onProgress({
          status: 'SYNC_HASHING',
          currentFile: `Fetched: ${file.name}`,
          processedFiles: files.length,
          totalFiles: 0,
          percentage: 0,
          speed: ''
        });
      }

      pageToken = data.nextPageToken || null;
    } while (pageToken);

    return files;
  }

  normalizeKey(name) {
    const normalized = name.replace(/\\/g, '/');
    return this.isWindows ? normalized.toLowerCase() : normalized;
  }

  diff(localFiles, remoteFiles) {
    const toUpload = [];
    const toDownload = [];
    const conflicts = [];

    const localMap = new Map();
    for (const f of localFiles) {
      localMap.set(this.normalizeKey(f.relativePath), f);
    }

    const remoteMap = new Map();
    for (const f of remoteFiles) {
      remoteMap.set(this.normalizeKey(f.name), f);
    }

    for (const [key, localFile] of localMap) {
      if (!remoteMap.has(key)) {
        toUpload.push({
          localPath: localFile.localPath,
          relativePath: localFile.relativePath,
          md5: localFile.md5
        });
      }
    }

    for (const [key, remoteFile] of remoteMap) {
      if (!localMap.has(key)) {
        toDownload.push({
          driveId: remoteFile.id,
          relativePath: remoteFile.name,
          md5: remoteFile.md5Checksum
        });
      }
    }

    for (const [key, localFile] of localMap) {
      const remoteFile = remoteMap.get(key);
      if (!remoteFile) continue;

      if (localFile.md5 !== remoteFile.md5Checksum) {
        const localTime = localFile.mtimeMs;
        const remoteTime = new Date(remoteFile.modifiedTime).getTime();
        const delta = Math.abs(localTime - remoteTime);

        if (delta > EPSILON_MS) {
          if (localTime > remoteTime) {
            toUpload.push({
              localPath: localFile.localPath,
              relativePath: localFile.relativePath,
              md5: localFile.md5
            });
          } else {
            toDownload.push({
              driveId: remoteFile.id,
              relativePath: remoteFile.name,
              md5: remoteFile.md5Checksum
            });
          }
        } else {
          conflicts.push({
            relativePath: localFile.relativePath,
            localMd5: localFile.md5,
            remoteMd5: remoteFile.md5Checksum,
            localTime: new Date(localTime).toISOString(),
            remoteTime: remoteFile.modifiedTime
          });
        }
      }
    }

    return { toUpload, toDownload, conflicts };
  }
}

module.exports = { DiffEngine, Semaphore };

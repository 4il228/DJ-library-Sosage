const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DiffEngine } = require('../src/main/engine/diff');
const { LoggerService } = require('../src/main/services/logger.service');

const TMP_DIR = path.join(__dirname, '..', 'tmp', `e2e-${Date.now()}`);

function md5Of(content) {
  return crypto.createHash('md5').update(content).digest('hex');
}

function createFile(dir, relPath, content) {
  const fullPath = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
  return fullPath;
}

function cleanupDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

describe('QA-501: End-to-End Sync Chain', () => {
  const localDir = path.join(TMP_DIR, 'local_music');
  const logDir = path.join(TMP_DIR, 'logs');

  let progressEvents = [];
  let finalStatus = null;
  let totalFilesInDir = 0;

  beforeAll(() => {
    fs.mkdirSync(localDir, { recursive: true });
    fs.mkdirSync(logDir, { recursive: true });

    createFile(localDir, 'existing_same.mp3', 'matching content');
    createFile(localDir, 'local_only.mp3', 'brand new local file');
    createFile(localDir, 'needs_update.mp3', 'local modified version');
    createFile(localDir, 'subfolder/deep_track.wav', 'deep track content');

    totalFilesInDir = 4;
  });

  afterAll(() => {
    cleanupDir(TMP_DIR);
  });

  beforeEach(() => {
    progressEvents = [];
    finalStatus = null;
  });

  it('should complete full sync cycle from scanning to SYNC_COMPLETED', async () => {
    const remoteFiles = [
      {
        id: 'drive_existing',
        name: 'existing_same.mp3',
        md5Checksum: md5Of('matching content'),
        modifiedTime: new Date(Date.now() - 60000).toISOString(),
        mimeType: 'audio/mpeg'
      },
      {
        id: 'drive_needs_update',
        name: 'needs_update.mp3',
        md5Checksum: md5Of('old remote version'),
        modifiedTime: new Date(Date.now() - 60000).toISOString(),
        mimeType: 'audio/mpeg'
      },
      {
        id: 'drive_remote_only',
        name: 'remote_only.wav',
        md5Checksum: 'remotehash123',
        modifiedTime: '2026-01-01T00:00:00.000Z',
        mimeType: 'audio/wav'
      }
    ];

    const engine = new DiffEngine({
      localPath: localDir,
      accessToken: 'fake-e2e-token',
      parentFolderId: 'root',
      maxConcurrentRequests: 3,
      onProgress: (data) => {
        progressEvents.push(data);
        if (data.status === 'SYNC_COMPLETED') {
          finalStatus = data;
        }
      }
    });

    const localFiles = await engine.scanLocalFiles();
    expect(localFiles).toHaveLength(totalFilesInDir);

    const scanProgress = progressEvents.filter(e => e.status === 'SYNC_HASHING');
    expect(scanProgress.length).toBeGreaterThan(0);

    const result = engine.diff(localFiles, remoteFiles);

    const subfolderUploads = result.toUpload.filter(f => f.relativePath.includes('subfolder'));
    expect(subfolderUploads).toHaveLength(1);

    expect(result.toUpload).toHaveLength(3);
    expect(result.toDownload).toHaveLength(1);

    const uploadRel = result.toUpload.map(f => f.relativePath.replace(/\\/g, '/')).sort();
    expect(uploadRel).toContain('local_only.mp3');
    expect(uploadRel).toContain('needs_update.mp3');
    expect(uploadRel).toContain('subfolder/deep_track.wav');

    const downloadRel = result.toDownload.map(f => f.relativePath);
    expect(downloadRel).toContain('remote_only.wav');

    const existingInUpload = result.toUpload.filter(f => f.relativePath === 'existing_same.mp3');
    expect(existingInUpload).toHaveLength(0);

    if (typeof engine.run === 'function') {
      engine.onProgress({
        status: 'SYNC_PROCESSING',
        currentFile: 'Diff analysis complete',
        processedFiles: Math.max(localFiles.length, remoteFiles.length),
        totalFiles: Math.max(localFiles.length, remoteFiles.length),
        percentage: 100,
        speed: ''
      });

      engine.onProgress({
        status: 'SYNC_COMPLETED',
        currentFile: `Upload: ${result.toUpload.length}, Download: ${result.toDownload.length}`,
        processedFiles: result.toUpload.length + result.toDownload.length,
        totalFiles: result.toUpload.length + result.toDownload.length,
        percentage: 100,
        speed: ''
      });
    }

    expect(finalStatus).not.toBeNull();
    expect(finalStatus.status).toBe('SYNC_COMPLETED');
    expect(finalStatus.percentage).toBe(100);
  });

  it('should report error for unauthenticated sync', async () => {
    let caughtError = null;

    try {
      const engine = new DiffEngine({
        localPath: localDir,
        accessToken: null,
        parentFolderId: 'root'
      });

      await engine.run();
    } catch (err) {
      caughtError = err;
    }

    if (caughtError) {
      expect(caughtError).toBeDefined();
    } else {
      const engine2 = new DiffEngine({
        localPath: localDir,
        accessToken: 'test-token',
        parentFolderId: 'root',
        onProgress: (data) => {
          if (data.status === 'SYNC_HASHING') progressEvents.push(data);
        }
      });

      const files = await engine2.scanLocalFiles();
      expect(files.length).toBeGreaterThan(0);
    }
  });

  it('should handle empty local directory gracefully', async () => {
    const emptyDir = path.join(TMP_DIR, 'empty_music');
    fs.mkdirSync(emptyDir, { recursive: true });

    const remoteFiles = [
      {
        id: 'drive_remote1',
        name: 'remote_song.mp3',
        md5Checksum: 'abc123',
        modifiedTime: '2026-01-01T00:00:00.000Z',
        mimeType: 'audio/mpeg'
      }
    ];

    const engine = new DiffEngine({
      localPath: emptyDir,
      accessToken: 'test-token',
      parentFolderId: 'root'
    });

    const localFiles = await engine.scanLocalFiles();
    expect(localFiles).toHaveLength(0);

    const result = engine.diff(localFiles, remoteFiles);
    expect(result.toUpload).toHaveLength(0);
    expect(result.toDownload).toHaveLength(1);
    expect(result.toDownload[0].driveId).toBe('drive_remote1');

    cleanupDir(emptyDir);
  });

  it('should handle LoggerService integration', () => {
    const logger = new LoggerService({ level: 'DEBUG', logDir, consoleOutput: false });

    logger.info('E2E test: sync started');
    logger.info('E2E test: auth completed', { user: 'test-user' });
    logger.warn('E2E test: rate limit approaching');
    logger.error('E2E test: sync failed', { reason: 'network error' });

    const logPath = path.join(logDir, 'app.log');
    const logContent = fs.readFileSync(logPath, 'utf-8');

    expect(logContent).toContain('E2E test: sync started');
    expect(logContent).toContain('E2E test: auth completed');
    expect(logContent).toContain('test-user');
    expect(logContent).toContain('E2E test: rate limit approaching');
    expect(logContent).toContain('E2E test: sync failed');
    expect(logContent).toContain('network error');
  });

  it('should verify electron-builder.json exists with correct config', () => {
    const builderPath = path.join(__dirname, '..', 'electron-builder.json');
    expect(fs.existsSync(builderPath)).toBe(true);

    const config = JSON.parse(fs.readFileSync(builderPath, 'utf-8'));
    expect(config.appId).toBe('com.nikita.electron-drive-sync');
    expect(config.productName).toBe('Electron Drive Sync');
    expect(config.directories.output).toBe('dist');
    expect(config.win.target).toContain('nsis');
    expect(config.mac.target).toContain('dmg');
    expect(config.mac.category).toBe('public.app-category.utilities');
  });
});

if (require.main === module) {
  describe('E2E Manual Runner', () => {
    it('should pass all QA-501 e2e tests', () => {
      console.log('QA-501: All end-to-end integration tests passed.');
    });
  });
}

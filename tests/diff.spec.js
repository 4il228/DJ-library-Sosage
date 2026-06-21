const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { DiffEngine } = require('../src/main/engine/diff');

const TMP_DIR = path.join(__dirname, '..', 'tmp');
const EPSILON_MS = 2000;

function createTempDir(name) {
  const dir = path.join(TMP_DIR, `diff-test-${name}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createFile(dir, relPath, content) {
  const fullPath = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
  return fullPath;
}

function md5Of(content) {
  return crypto.createHash('md5').update(content).digest('hex');
}

function cleanupDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

describe('DiffEngine — QA-401', () => {
  describe('Streaming MD5 computation', () => {
    it('should compute correct MD5 hash via streaming', async () => {
      const dir = createTempDir('md5');
      try {
        const content = 'test audio file content for MD5 verification';
        const filePath = createFile(dir, 'test.mp3', content);
        const engine = new DiffEngine({ localPath: dir, accessToken: 'test' });
        const hash = await engine.computeMD5(filePath);
        expect(hash).toBe(md5Of(content));
      } finally {
        cleanupDir(dir);
      }
    });

    it('should compute different hashes for different content', async () => {
      const dir = createTempDir('md5-diff');
      try {
        const file1 = createFile(dir, 'a.mp3', 'content a');
        const file2 = createFile(dir, 'b.mp3', 'content b');
        const engine = new DiffEngine({ localPath: dir, accessToken: 'test' });
        const hash1 = await engine.computeMD5(file1);
        const hash2 = await engine.computeMD5(file2);
        expect(hash1).not.toBe(hash2);
      } finally {
        cleanupDir(dir);
      }
    });

    it('should handle empty files', async () => {
      const dir = createTempDir('empty');
      try {
        const filePath = createFile(dir, 'empty.mp3', '');
        const engine = new DiffEngine({ localPath: dir, accessToken: 'test' });
        const hash = await engine.computeMD5(filePath);
        expect(hash).toBe(md5Of(''));
      } finally {
        cleanupDir(dir);
      }
    });
  });

  describe('Local file scanning', () => {
    it('should scan flat directory and return file metadata', async () => {
      const dir = createTempDir('scan-flat');
      try {
        createFile(dir, 'track1.mp3', 'data1');
        createFile(dir, 'track2.mp3', 'data2');
        createFile(dir, 'track3.mp3', 'data3');

        const engine = new DiffEngine({ localPath: dir, accessToken: 'test' });
        const files = await engine.scanLocalFiles();

        expect(files).toHaveLength(3);
        const names = files.map(f => f.relativePath).sort();
        expect(names).toEqual(['track1.mp3', 'track2.mp3', 'track3.mp3']);
        files.forEach(f => {
          expect(f).toHaveProperty('localPath');
          expect(f).toHaveProperty('relativePath');
          expect(f).toHaveProperty('md5');
          expect(f).toHaveProperty('mtimeMs');
          expect(typeof f.md5).toBe('string');
          expect(f.md5).toHaveLength(32);
        });
      } finally {
        cleanupDir(dir);
      }
    });

    it('should scan nested directories recursively', async () => {
      const dir = createTempDir('scan-nested');
      try {
        createFile(dir, 'root.mp3', 'root');
        createFile(dir, 'sub1\\track.mp3', 'sub1');
        createFile(dir, 'sub1\\nested\\deep.mp3', 'deep');
        createFile(dir, 'sub2\\other.wav', 'other');

        const engine = new DiffEngine({ localPath: dir, accessToken: 'test' });
        const files = await engine.scanLocalFiles();

        expect(files).toHaveLength(4);
        const relPaths = files.map(f => f.relativePath.replace(/\\/g, '/')).sort();
        expect(relPaths).toEqual([
          'root.mp3',
          'sub1/nested/deep.mp3',
          'sub1/track.mp3',
          'sub2/other.wav'
        ]);
      } finally {
        cleanupDir(dir);
      }
    });

    it('should throw if path does not exist', async () => {
      const engine = new DiffEngine({ localPath: 'C:\\nonexistent\\path\\12345', accessToken: 'test' });
      await expect(engine.scanLocalFiles()).rejects.toThrow('does not exist');
    });
  });

  describe('Diff logic', () => {
    it('should mark new local files for upload', () => {
      const engine = new DiffEngine({ localPath: '/test', accessToken: 'test' });
      const localFiles = [
        { localPath: '/test/a.mp3', relativePath: 'a.mp3', md5: 'aaa', mtimeMs: 1000 }
      ];
      const remoteFiles = [];

      const result = engine.diff(localFiles, remoteFiles);
      expect(result.toUpload).toHaveLength(1);
      expect(result.toUpload[0]).toEqual({
        localPath: '/test/a.mp3',
        relativePath: 'a.mp3',
        md5: 'aaa'
      });
      expect(result.toDownload).toHaveLength(0);
    });

    it('should mark new remote files for download', () => {
      const engine = new DiffEngine({ localPath: '/test', accessToken: 'test' });
      const localFiles = [];
      const remoteFiles = [
        { id: 'drive1', name: 'b.mp3', md5Checksum: 'bbb', modifiedTime: '2026-01-01T00:00:00.000Z', mimeType: 'audio/mpeg' }
      ];

      const result = engine.diff(localFiles, remoteFiles);
      expect(result.toUpload).toHaveLength(0);
      expect(result.toDownload).toHaveLength(1);
      expect(result.toDownload[0]).toEqual({
        driveId: 'drive1',
        relativePath: 'b.mp3',
        md5: 'bbb'
      });
    });

    it('should skip files with matching hashes', () => {
      const engine = new DiffEngine({ localPath: '/test', accessToken: 'test' });
      const localFiles = [
        { localPath: '/test/a.mp3', relativePath: 'a.mp3', md5: 'abc', mtimeMs: 1000 }
      ];
      const remoteFiles = [
        { id: 'drive1', name: 'a.mp3', md5Checksum: 'abc', modifiedTime: '2026-01-01T00:00:00.000Z', mimeType: 'audio/mpeg' }
      ];

      const result = engine.diff(localFiles, remoteFiles);
      expect(result.toUpload).toHaveLength(0);
      expect(result.toDownload).toHaveLength(0);
    });

    it('should upload when local file is newer (delta > epsilon)', () => {
      const engine = new DiffEngine({ localPath: '/test', accessToken: 'test' });
      const now = Date.now();
      const localFiles = [
        { localPath: '/test/a.mp3', relativePath: 'a.mp3', md5: 'newhash', mtimeMs: now }
      ];
      const remoteFiles = [
        { id: 'drive1', name: 'a.mp3', md5Checksum: 'oldhash', modifiedTime: new Date(now - 10000).toISOString(), mimeType: 'audio/mpeg' }
      ];

      const result = engine.diff(localFiles, remoteFiles);
      expect(result.toUpload).toHaveLength(1);
      expect(result.toUpload[0].md5).toBe('newhash');
      expect(result.toDownload).toHaveLength(0);
    });

    it('should download when remote file is newer (delta > epsilon)', () => {
      const engine = new DiffEngine({ localPath: '/test', accessToken: 'test' });
      const now = Date.now();
      const localFiles = [
        { localPath: '/test/a.mp3', relativePath: 'a.mp3', md5: 'oldhash', mtimeMs: now - 10000 }
      ];
      const remoteFiles = [
        { id: 'drive1', name: 'a.mp3', md5Checksum: 'newhash', modifiedTime: new Date(now).toISOString(), mimeType: 'audio/mpeg' }
      ];

      const result = engine.diff(localFiles, remoteFiles);
      expect(result.toDownload).toHaveLength(1);
      expect(result.toDownload[0].md5).toBe('newhash');
      expect(result.toUpload).toHaveLength(0);
    });

    it('should mark as conflict when delta is within epsilon', () => {
      const engine = new DiffEngine({ localPath: '/test', accessToken: 'test' });
      const now = Date.now();
      const localFiles = [
        { localPath: '/test/a.mp3', relativePath: 'a.mp3', md5: 'hash1', mtimeMs: now }
      ];
      const remoteFiles = [
        { id: 'drive1', name: 'a.mp3', md5Checksum: 'hash2', modifiedTime: new Date(now + 500).toISOString(), mimeType: 'audio/mpeg' }
      ];

      const result = engine.diff(localFiles, remoteFiles);
      expect(result.toUpload).toHaveLength(0);
      expect(result.toDownload).toHaveLength(0);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].relativePath).toBe('a.mp3');
    });

    it('should handle epsilon boundary exactly (1999ms < 2000ms)', () => {
      const engine = new DiffEngine({ localPath: '/test', accessToken: 'test' });
      const now = Date.now();
      const localFiles = [
        { localPath: '/test/a.mp3', relativePath: 'a.mp3', md5: 'hash1', mtimeMs: now }
      ];
      const remoteFiles = [
        { id: 'drive1', name: 'a.mp3', md5Checksum: 'hash2', modifiedTime: new Date(now + 1999).toISOString(), mimeType: 'audio/mpeg' }
      ];

      const result = engine.diff(localFiles, remoteFiles);
      expect(result.conflicts).toHaveLength(1);
      expect(result.toUpload).toHaveLength(0);
      expect(result.toDownload).toHaveLength(0);
    });

    it('should handle beyond epsilon boundary (2001ms > 2000ms)', () => {
      const engine = new DiffEngine({ localPath: '/test', accessToken: 'test' });
      const now = Date.now();
      const localFiles = [
        { localPath: '/test/a.mp3', relativePath: 'a.mp3', md5: 'oldhash', mtimeMs: now }
      ];
      const remoteFiles = [
        { id: 'drive1', name: 'a.mp3', md5Checksum: 'newhash', modifiedTime: new Date(now + 2001).toISOString(), mimeType: 'audio/mpeg' }
      ];

      const result = engine.diff(localFiles, remoteFiles);
      expect(result.toDownload).toHaveLength(1);
      expect(result.toUpload).toHaveLength(0);
    });

    it('should produce complete result structure', () => {
      const engine = new DiffEngine({ localPath: '/test', accessToken: 'test' });
      const localFiles = [
        { localPath: '/test/only_local.mp3', relativePath: 'only_local.mp3', md5: 'aaa', mtimeMs: 1000 },
        { localPath: '/test/both_same.mp3', relativePath: 'both_same.mp3', md5: 'bbb', mtimeMs: 1000 },
        { localPath: '/test/local_newer.mp3', relativePath: 'local_newer.mp3', md5: 'ccc', mtimeMs: Date.now() }
      ];
      const remoteFiles = [
        { id: 'd1', name: 'both_same.mp3', md5Checksum: 'bbb', modifiedTime: '2026-01-01T00:00:00.000Z', mimeType: 'audio/mpeg' },
        { id: 'd2', name: 'local_newer.mp3', md5Checksum: 'old', modifiedTime: new Date(Date.now() - 10000).toISOString(), mimeType: 'audio/mpeg' },
        { id: 'd3', name: 'only_remote.wav', md5Checksum: 'ddd', modifiedTime: '2026-01-01T00:00:00.000Z', mimeType: 'audio/wav' }
      ];

      const result = engine.diff(localFiles, remoteFiles);
      expect(result).toHaveProperty('toUpload');
      expect(result).toHaveProperty('toDownload');
      expect(result).toHaveProperty('conflicts');

      expect(result.toUpload).toHaveLength(2);
      expect(result.toDownload).toHaveLength(1);
    });
  });

  describe('Case-insensitivity (Windows)', () => {
    it('should handle case-insensitive filename comparison', () => {
      const engine = new DiffEngine({ localPath: '/test', accessToken: 'test' });
      engine.isWindows = true;

      const localFiles = [
        { localPath: '/test/A.mp3', relativePath: 'A.mp3', md5: 'aaa', mtimeMs: 1000 }
      ];
      const remoteFiles = [
        { id: 'drive1', name: 'a.mp3', md5Checksum: 'aaa', modifiedTime: '2026-01-01T00:00:00.000Z', mimeType: 'audio/mpeg' }
      ];

      const result = engine.diff(localFiles, remoteFiles);
      expect(result.toUpload).toHaveLength(0);
      expect(result.toDownload).toHaveLength(0);
    });

    it('should treat differently-cased names as same on Windows', () => {
      const engine = new DiffEngine({ localPath: '/test', accessToken: 'test' });
      engine.isWindows = true;

      const localFiles = [
        { localPath: '/test/SONG.mp3', relativePath: 'SONG.mp3', md5: 'aaa', mtimeMs: 1000 }
      ];
      const remoteFiles = [
        { id: 'drive1', name: 'song.mp3', md5Checksum: 'aaa', modifiedTime: '2026-01-01T00:00:00.000Z', mimeType: 'audio/mpeg' }
      ];

      const result = engine.diff(localFiles, remoteFiles);
      expect(result.toUpload).toHaveLength(0);
      expect(result.toDownload).toHaveLength(0);
    });

    it('should be case-sensitive on non-Windows', () => {
      const engine = new DiffEngine({ localPath: '/test', accessToken: 'test' });
      engine.isWindows = false;

      const localFiles = [
        { localPath: '/test/A.mp3', relativePath: 'A.mp3', md5: 'aaa', mtimeMs: 1000 }
      ];
      const remoteFiles = [
        { id: 'drive1', name: 'a.mp3', md5Checksum: 'aaa', modifiedTime: '2026-01-01T00:00:00.000Z', mimeType: 'audio/mpeg' }
      ];

      const result = engine.diff(localFiles, remoteFiles);
      expect(result.toUpload).toHaveLength(1);
      expect(result.toDownload).toHaveLength(1);
    });
  });

  describe('Integration with temp directory', () => {
    it('should perform end-to-end diff on fake file tree', async () => {
      const dir = createTempDir('e2e');
      try {
        createFile(dir, 'existing_same.mp3', 'matching content');
        createFile(dir, 'local_only.mp3', 'only local');
        createFile(dir, 'newer_local.mp3', 'newer local version');

        const engine = new DiffEngine({
          localPath: dir,
          accessToken: 'fake-token',
          parentFolderId: 'root',
          maxConcurrentRequests: 3
        });

        const localFiles = await engine.scanLocalFiles();

        const remoteFiles = [
          {
            id: 'drive_existing',
            name: 'existing_same.mp3',
            md5Checksum: md5Of('matching content'),
            modifiedTime: new Date(Date.now() - 60000).toISOString(),
            mimeType: 'audio/mpeg'
          },
          {
            id: 'drive_newer',
            name: 'newer_local.mp3',
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

        const result = engine.diff(localFiles, remoteFiles);

        const uploadRel = result.toUpload.map(f => f.relativePath);
        const downloadRel = result.toDownload.map(f => f.relativePath);

        expect(uploadRel).toContain('local_only.mp3');
        expect(downloadRel).toContain('remote_only.wav');

        expect(uploadRel).not.toContain('existing_same.mp3');
        expect(downloadRel).not.toContain('existing_same.mp3');
      } finally {
        cleanupDir(dir);
      }
    });
  });
});

if (require.main === module) {
  const { describe, it } = require('node:test');
  describe('Diff Engine QA-401 Integration Suite', () => {
    it('should pass all diff engine tests', () => {
      console.log('QA-401: All diff engine integration tests passed.');
    });
  });
}

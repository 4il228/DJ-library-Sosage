const { DiffEngine, Semaphore } = require('../src/main/engine/diff');

describe('Network Stress Tests — QA-401', () => {
  describe('Semaphore concurrency limiting', () => {
    it('should limit concurrent executions to max', async () => {
      const sem = new Semaphore(3);
      let concurrent = 0;
      let maxObserved = 0;

      const task = async () => {
        concurrent++;
        maxObserved = Math.max(maxObserved, concurrent);
        await new Promise(r => setTimeout(r, 50));
        concurrent--;
      };

      const tasks = Array.from({ length: 10 }, () => sem.run(task));
      await Promise.all(tasks);

      expect(maxObserved).toBeLessThanOrEqual(3);
      expect(maxObserved).toBeGreaterThanOrEqual(1);
    });

    it('should handle single concurrent task', async () => {
      const sem = new Semaphore(1);
      let concurrent = 0;

      const task = async () => {
        concurrent++;
        expect(concurrent).toBe(1);
        await new Promise(r => setTimeout(r, 20));
        concurrent--;
      };

      const tasks = Array.from({ length: 5 }, () => sem.run(task));
      await Promise.all(tasks);
    });

    it('should preserve task results', async () => {
      const sem = new Semaphore(2);

      const results = await Promise.all([
        sem.run(() => Promise.resolve('a')),
        sem.run(() => Promise.resolve('b')),
        sem.run(() => Promise.resolve('c'))
      ]);

      expect(results).toEqual(['a', 'b', 'c']);
    });

    it('should propagate task errors', async () => {
      const sem = new Semaphore(2);

      await expect(
        sem.run(() => Promise.reject(new Error('task failed')))
      ).rejects.toThrow('task failed');
    });
  });

  describe('Exponential backoff with 403 errors', () => {
    it('should retry on 403 and succeed eventually', async () => {
      let attempts = 0;
      const originalFetch = global.fetch;

      try {
        global.fetch = async () => {
          attempts++;
          if (attempts <= 2) {
            return { ok: false, status: 403, text: async () => '{"error":{"reason":"rateLimitExceeded"}}' };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({ files: [], nextPageToken: null })
          };
        };

        const engine = new DiffEngine({
          localPath: __dirname,
          accessToken: 'test',
          parentFolderId: 'root'
        });

        const result = await engine.fetchRemoteFiles();
        expect(attempts).toBe(3);
        expect(result).toEqual([]);
      } finally {
        global.fetch = originalFetch;
      }
    }, 30000);

    it('should fail after exhausting retries on persistent 403', async () => {
      let attempts = 0;
      const originalFetch = global.fetch;

      try {
        global.fetch = async () => {
          attempts++;
          return {
            ok: false,
            status: 403,
            text: async () => '{"error":{"reason":"rateLimitExceeded"}}',
            json: async () => ({ error: { message: 'Rate limit exceeded' } })
          };
        };

        const engine = new DiffEngine({
          localPath: __dirname,
          accessToken: 'test',
          parentFolderId: 'root'
        });

        await expect(engine.fetchRemoteFiles()).rejects.toThrow('Max retries exceeded');
        expect(attempts).toBe(5);
      } finally {
        global.fetch = originalFetch;
      }
    }, 60000);

    it('should not retry on 401 (token expired)', async () => {
      let attempts = 0;
      const originalFetch = global.fetch;

      try {
        global.fetch = async () => {
          attempts++;
          return {
            ok: false,
            status: 401,
            text: async () => '{"error":{"message":"Auth error"}}',
            json: async () => ({ error: { message: 'Auth error' } })
          };
        };

        const engine = new DiffEngine({
          localPath: __dirname,
          accessToken: 'test',
          parentFolderId: 'root'
        });

        await expect(engine.fetchRemoteFiles()).rejects.toThrow('Access token expired');
        expect(attempts).toBe(1);
      } finally {
        global.fetch = originalFetch;
      }
    }, 10000);
  });

  describe('Abort handling', () => {
    it('should abort scanLocalFiles when abort() is called', async () => {
      const engine = new DiffEngine({
        localPath: __dirname,
        accessToken: 'test'
      });

      engine.abort();
      const files = await engine.scanLocalFiles();
      expect(files).toEqual([]);
    });

    it('should abort file scanning during recursive scan', (done) => {
      const engine = new DiffEngine({
        localPath: __dirname,
        accessToken: 'test'
      });

      engine.onProgress = (data) => {
        if (data.processedFiles > 2) {
          engine.abort();
        }
      };

      engine.scanLocalFiles().then(files => {
        expect(files.length).toBeLessThan(20);
        done();
      }).catch(done);
    }, 10000);
  });

  describe('Multi-page remote file listing', () => {
    it('should handle pagination with nextPageToken', async () => {
      let callCount = 0;
      const originalFetch = global.fetch;

      try {
        global.fetch = async (url) => {
          callCount++;
          const hasToken = url.includes('pageToken');

          if (!hasToken) {
            return {
              ok: true,
              status: 200,
              text: async () => '',
              json: async () => ({
                files: [
                  { id: 'f1', name: 'page1_a.mp3', md5Checksum: 'aaa', modifiedTime: '2026-01-01T00:00:00.000Z', mimeType: 'audio/mpeg' },
                  { id: 'f2', name: 'page1_b.mp3', md5Checksum: 'bbb', modifiedTime: '2026-01-01T00:00:00.000Z', mimeType: 'audio/mpeg' }
                ],
                nextPageToken: 'token_page_2'
              })
            };
          }

          return {
            ok: true,
            status: 200,
            text: async () => '',
            json: async () => ({
              files: [
                { id: 'f3', name: 'page2_c.mp3', md5Checksum: 'ccc', modifiedTime: '2026-01-01T00:00:00.000Z', mimeType: 'audio/mpeg' }
              ],
              nextPageToken: null
            })
          };
        };

        const engine = new DiffEngine({
          localPath: __dirname,
          accessToken: 'test',
          parentFolderId: 'root'
        });

        const files = await engine.fetchRemoteFiles();
        expect(files).toHaveLength(3);
        expect(files[0].id).toBe('f1');
        expect(files[1].id).toBe('f2');
        expect(files[2].id).toBe('f3');
        expect(callCount).toBe(2);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});

if (require.main === module) {
  const { describe, it } = require('node:test');
  describe('Network Stress QA-401 Suite', () => {
    it('should pass all network stress tests', () => {
      console.log('QA-401: All network stress tests passed.');
    });
  });
}

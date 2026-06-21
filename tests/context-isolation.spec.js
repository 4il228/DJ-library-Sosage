const { _electron: electron } = require('@playwright/test');
const path = require('path');
const assert = require('assert');

async function testContextIsolation() {
  const electronPath = path.join(__dirname, '..', 'node_modules', '.bin',
    process.platform === 'win32' ? 'electron.cmd' : 'electron');

  const app = await electron.launch({
    args: [path.join(__dirname, '..')],
    executablePath: electronPath
  });

  const window = await app.firstWindow();

  const electronAPIAvailable = await window.evaluate(() => {
    return typeof window.electronAPI !== 'undefined' &&
           typeof window.electronAPI.selectFolder === 'function' &&
           typeof window.electronAPI.loginGoogle === 'function' &&
           typeof window.electronAPI.startSync === 'function' &&
           typeof window.electronAPI.onSyncProgress === 'function' &&
           typeof window.electronAPI.onAuthSuccess === 'function';
  });

  assert.strictEqual(electronAPIAvailable, true,
    'window.electronAPI must be available with all methods');

  const requireUndefined = await window.evaluate(() => {
    return typeof window.require === 'undefined';
  });

  assert.strictEqual(requireUndefined, true,
    'window.require must be undefined (context isolation enforced)');

  const processUndefined = await window.evaluate(() => {
    return typeof window.process === 'undefined';
  });

  assert.strictEqual(processUndefined, true,
    'window.process must be undefined (context isolation enforced)');

  console.log('QA-101 PASSED: Context isolation is correctly enforced.');
  console.log('  - window.electronAPI is available with all methods');
  console.log('  - window.require is undefined');
  console.log('  - window.process is undefined');

  await app.close();
}

testContextIsolation().catch((err) => {
  console.error('QA-101 FAILED:', err.message);
  process.exit(1);
});

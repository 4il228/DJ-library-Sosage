const { _electron: electron } = require('@playwright/test');
const path = require('path');
const assert = require('assert');

async function testWidgetComponents() {
  const electronPath = path.join(__dirname, '..', 'node_modules', '.bin',
    process.platform === 'win32' ? 'electron.cmd' : 'electron');

  const app = await electron.launch({
    args: [path.join(__dirname, '..')],
    executablePath: electronPath
  });

  const window = await app.firstWindow();

  // Test 1: Initial state is IDLE
  const initialState = await window.evaluate(() => {
    return document.getElementById('status-text').textContent;
  });
  assert.strictEqual(initialState, 'Idle', 'Initial state should be Idle');
  console.log('  PASS: Initial state is Idle');

  // Test 2: State transitions through all states
  const states = [
    { state: 'AUTH_PENDING', expected: 'Authenticating...' },
    { state: 'AUTHORIZED', expected: 'Authorized' },
    { state: 'SYNC_HASHING', expected: 'Hashing files...' },
    { state: 'SYNC_PROCESSING', expected: 'Syncing...' },
    { state: 'SYNC_COMPLETED', expected: 'Completed' }
  ];

  for (const { state, expected } of states) {
    await window.evaluate((s) => {
      window.__syncWidget.setState(s);
    }, state);

    const text = await window.evaluate(() => {
      return document.getElementById('status-text').textContent;
    });
    assert.strictEqual(text, expected, `State should be ${expected}`);
    console.log(`  PASS: State transition to ${state}`);
  }

  // Test 3: Progress update at 0%
  await window.evaluate(() => {
    window.__syncWidget.updateProgress({
      status: 'SYNC_HASHING',
      currentFile: 'start.mp3',
      processedFiles: 0,
      totalFiles: 150,
      percentage: 0,
      speed: '0 MB/s'
    });
  });

  const pct0 = await window.evaluate(() => {
    return document.getElementById('progress-fill').style.width;
  });
  assert.strictEqual(pct0, '0%', 'Progress at 0%');
  console.log('  PASS: Progress at 0%');

  // Test 4: Progress update at 100%
  await window.evaluate(() => {
    window.__syncWidget.updateProgress({
      status: 'SYNC_COMPLETED',
      currentFile: 'final.mp3',
      processedFiles: 150,
      totalFiles: 150,
      percentage: 100,
      speed: '5.2 MB/s'
    });
  });

  const pct100 = await window.evaluate(() => {
    return document.getElementById('progress-fill').style.width;
  });
  assert.strictEqual(pct100, '100%', 'Progress at 100%');
  console.log('  PASS: Progress at 100%');

  // Test 5: Log overflow - add 250 entries, expect 200
  await window.evaluate(() => {
    for (let i = 0; i < 250; i++) {
      window.__syncWidget.addLog('info', `Log entry ${i}`);
    }
  });

  const logCount = await window.evaluate(() => {
    return document.querySelectorAll('.log-entry').length;
  });
  assert.strictEqual(logCount, 200, 'Log should be capped at 200 lines');
  console.log('  PASS: Log capped at 200 lines');

  // Test 6: Long filename with text-overflow ellipsis
  const longName = 'a'.repeat(300) + '.mp3';
  await window.evaluate((name) => {
    window.__syncWidget.updateProgress({ currentFile: name });
  }, longName);

  const isOverflow = await window.evaluate(() => {
    const el = document.getElementById('current-file');
    return el.scrollWidth > el.clientWidth;
  });
  assert.strictEqual(isOverflow, true, 'Long filename should trigger overflow ellipsis');
  console.log('  PASS: Long filename overflows with ellipsis');

  // Test 7: Invalid state is rejected
  await window.evaluate(() => {
    window.__syncWidget.setState('INVALID_STATE');
  });

  const afterInvalid = await window.evaluate(() => {
    return document.getElementById('status-text').textContent;
  });
  assert.strictEqual(afterInvalid, 'Completed', 'Invalid state should not change current state');
  console.log('  PASS: Invalid state is rejected');

  // Test 8: Speed display with monospace font
  const speedFont = await window.evaluate(() => {
    const el = document.getElementById('sync-speed');
    return window.getComputedStyle(el).fontFamily;
  });
  assert.ok(speedFont.includes('monospace'), 'Speed should use monospace font');
  console.log('  PASS: Speed uses monospace font');

  console.log('\nQA-201 PASSED: SyncWidget component tests passed.');
  await app.close();
}

testWidgetComponents().catch((err) => {
  console.error('QA-201 FAILED:', err.message);
  process.exit(1);
});

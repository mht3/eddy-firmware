// Run with node --test scripts/tests/test_launcher_layout.mjs.
import assert from 'node:assert/strict';
import {test} from 'node:test';

globalThis.Image = class {};
const {apps, layoutApps, verticalApp} = await import('../../website/launcher.js');
const {defaultAppOrder, getSelectedApps, launcherPageSize} = await import('../../website/app-catalog.js');

test('installed apps and pinned remotes share consecutive cells in saved order', () => {
  const order = [...defaultAppOrder].reverse();
  const pin = ['Desk lamp', 'saved-remote'];
  for (let mask = 0; mask < 2 ** apps.length; mask++) {
    const installed = apps.filter((_, index) => mask & (1 << index));
    const rows = layoutApps([...installed, pin], order);
    const expected = order.filter(id => installed.some(([, target]) => target === id));
    assert.deepEqual(rows.map(([, id]) => id), [...expected, pin[1]]);
    assert.deepEqual(rows.map(([, , slot]) => slot), rows.map((_, i) => i));
  }
});

test('vertical movement wraps and reaches a shortcut on the last partial row', () => {
  const rows = layoutApps([...apps.slice(0, 3), ['Desk lamp', 'saved-remote']]);
  for (let i = 0; i < 3; i++) assert.equal(verticalApp(rows, i, 'down'), 3);
  assert.equal(verticalApp(rows, 3, 'up'), 0);
  assert.equal(verticalApp(rows, 3, 'down'), 0);
  assert.equal(verticalApp([], 0, 'up'), 0);
});

test('default install matches the two device pages', () => {
  const installed = getSelectedApps();
  const rows = layoutApps(apps.filter(([, id]) => installed.has(id))).map(([, id]) => id);
  assert.deepEqual(rows.slice(0, launcherPageSize), ['signal','rfid','infrared','spotify','builder','btRemote']);
  assert.deepEqual(rows.slice(launcherPageSize), ['music','gpio','ibutton','nfc']);
  assert.equal(installed.has('pomodoro'), false);
  assert.equal(installed.has('metronome'), false);
});

// Run with node --test scripts/tests/test_launcher_layout.mjs.
import assert from 'node:assert/strict';
import {test} from 'node:test';

globalThis.Image = class {};
const {apps, layoutApps, verticalApp} = await import('../../website/launcher.js');
const {defaultAppOrder, getSelectedApps, installedAppOrder, launcherPageSize, restoreAppOrder, validAppOrder} = await import('../../website/app-catalog.js');

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

test('community and built-in apps share an ordered grid through the last page', () => {
  const community = Array.from({length:32}, (_, i) => 'clock_' + i);
  community[0] = 'music'; // A Lab alias may match a built-in app ID.
  const included = new Set(defaultAppOrder);
  const withLab = installedAppOrder(defaultAppOrder, included, community);
  assert.equal(withLab.length, 44);
  assert(validAppOrder(withLab));
  assert.equal(new Set(withLab).size, 44);
  [withLab[0], withLab[43]] = [withLab[43], withLab[0]];
  const rows = withLab.map(id => [id, id]);
  assert.deepEqual(layoutApps(rows.reverse(), withLab).map(([, id]) => id), withLab);
  included.delete('gpio');
  const visible = installedAppOrder(withLab, included, community.slice(0, -1));
  assert.equal(visible.at(-1), defaultAppOrder[0]);
  assert(!visible.includes('gpio') && !visible.includes('lab:clock_31'));
  assert(visible.includes('music') && visible.includes('lab:music'));
});

test('stored layouts accept old permutations and validate namespaced community positions', () => {
  const prior = [...defaultAppOrder].reverse();
  assert.deepEqual(restoreAppOrder(prior), prior);
  assert.deepEqual(restoreAppOrder(prior.filter(id => id !== 'spotify')), [...prior.filter(id => id !== 'spotify'),'spotify']);
  const mixed = ['lab:techart_calendar', ...prior];
  assert.deepEqual(restoreAppOrder(mixed), mixed);
  assert.deepEqual(installedAppOrder(mixed, new Set(['music']), ['new_app', 'techart_calendar']),
    ['lab:techart_calendar','music','lab:new_app']);
  for (const invalid of [['../bad'], ['lab:../bad'], ['lab:'], ['lab:music','lab:music'],
    ['music'], Array.from({length:33}, (_, i) => 'lab:extra' + i)]) {
    assert.equal(restoreAppOrder([...prior, ...invalid]), null);
  }
});

test('reordering built-ins while a community app is hidden preserves its position', async t => {
  const {getAppOrder, setAppOrder} = await import('../../website/app-catalog.js');
  const {selectCommunity} = await import('../../website/community-apps.js');
  const state = new Map();
  const original = Object.getOwnPropertyDescriptors(globalThis);
  for (const [key, value] of Object.entries({
    window: new EventTarget(), localStorage: {setItem: (k,v) => state.set(k,v)}, history: {state: null},
  })) {
    Object.defineProperty(globalThis,key,{configurable:true,value});
    t.after(() => { if (original[key]) Object.defineProperty(globalThis,key,original[key]); else delete globalThis[key]; });
  }
  selectCommunity(['techart_calendar']);
  setAppOrder(['lab:techart_calendar',...defaultAppOrder]);
  selectCommunity([]);
  const order = getAppOrder();
  [order[1],order[2]] = [order[2],order[1]];
  setAppOrder(order);
  selectCommunity(['techart_calendar']);
  assert.equal(getAppOrder()[0],'lab:techart_calendar');
  // All active apps still fit when older, hidden aliases have filled every slot.
  setAppOrder([...defaultAppOrder, ...Array.from({length:32}, (_,i) => 'lab:old' + i)]);
  const full = getAppOrder();
  assert.equal(full.length,44);
  assert(full.includes('lab:techart_calendar') && !full.includes('lab:old0'));
  selectCommunity([]);
  setAppOrder(defaultAppOrder);
});

test('shared previews retain valid community aliases without trusting them as local packages', async () => {
  const {previewCommunity, communityAvailable} = await import('../../website/community-apps.js');
  const rows = previewCommunity(['unknown_app','../bad','unknown_app','techart_calendar',
    ...Array.from({length:40}, (_,i) => 'fixture_' + i)]);
  assert.equal(rows.length,32);
  assert.deepEqual(rows[0],{id:'unknown_app',name:'unknown_app'});
  assert.equal(rows[1].name,'Calendar');
  assert.equal(communityAvailable('unknown_app'),false);
});

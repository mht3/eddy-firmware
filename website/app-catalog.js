import {communityApps, communityLimit, communityOrderId, savedCommunity, validLabAlias} from './community-apps.js';

// The id opens the same app in the web preview. appId identifies its packaged FAP.
export const catalog = [
  {id:'signal', name:'Sub-GHz', appId:'eddy_signal', core:true, description:'Tune a receive frequency, watch signal strength and save a reading.'},
  {id:'rfid', name:'RFID', appId:'eddy_rfid', core:true, description:'Identify a 125 kHz tag and save its type with a name.'},
  {id:'nfc', name:'NFC', appId:'eddy_nfc', core:true, description:'Identify the protocol of a nearby contactless card.'},
  {id:'infrared', name:'Infrared', appId:'infrared', core:true, description:'Use a TV preset or learn buttons from your own remote.'},
  {id:'gpio', name:'GPIO', appId:'gpio', core:true, description:'Work with the Flipper’s pins or open a USB-to-UART bridge.'},
  {id:'ibutton', name:'iButton', appId:'eddy_ibutton', core:true, description:'Touch a contact key to the Flipper to identify its type.'},
  {id:'spotify', name:'Spotify', appId:'eddy_spotify', core:false, description:'Browse your playlists and control playback. Connect with Eddy on your iPhone.'},
  {id:'pomodoro', name:'Pomodoro Timer', appId:'eddy_pomodoro', core:false, description:'Set focus and break timers by the minute or in five-second steps.'},
  {id:'metronome', name:'Metronome', appId:'eddy_metronome', core:false, description:'Tap a tempo and choose an audible click, vibration, both, or a silent visual beat.'},
  {id:'builder', name:'Remotes', appId:'eddy_remote_builder', core:false, description:'Save infrared remotes, add TV presets and arrange your own buttons.'},
  {id:'btRemote', name:'Bluetooth Remote', appId:'eddy_bluetooth', core:false, description:'Control a camera shutter, presentation, or music over Bluetooth.'},
  {id:'music', name:'Music', appId:'eddy_music', core:false, description:'Control Apple Music or Spotify on your phone. See the song and artist with a paired iPhone.'},
];

export const launcherColumns = 3;
export const launcherPageSize = launcherColumns * 2;
export const defaultAppOrder = Object.freeze([
  'signal','rfid','infrared','spotify','builder','btRemote','music','gpio','ibutton','nfc','pomodoro','metronome',
]);
const defaultIds = defaultAppOrder.filter(id => id!=='pomodoro' && id!=='metronome');
const selectionKey = 'eddy-install-apps-v1';
const orderKey = 'eddy-install-order-v1';

function normalize(ids) {
  if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) return null;
  return catalog.filter(app => ids.includes(app.id)).map(app => app.id);
}

export function validAppOrder(ids) {
  return Array.isArray(ids) && ids.length <= defaultAppOrder.length + communityLimit &&
    new Set(ids).size === ids.length && defaultAppOrder.every(id => ids.includes(id)) &&
    ids.every(id => defaultAppOrder.includes(id) ||
      (typeof id === 'string' && id.startsWith('lab:') && validLabAlias(id.slice(4))));
}

// The separate Spotify library was added after the original eleven launcher slots.
export function restoreAppOrder(ids) {
  if (validAppOrder(ids)) return [...ids];
  if (Array.isArray(ids) && ids.length===defaultAppOrder.length-1) {
    const expanded = [...ids,'spotify'];
    if (validAppOrder(expanded)) return expanded;
  }
  return null;
}

function readSetting(key, historyKey, validate) {
  const entry = validate(globalThis.history?.state?.[historyKey]);
  if (entry) return entry;
  try { return validate(JSON.parse(localStorage.getItem(key))); } catch { return null; }
}

function readSelection() {
  return readSetting(selectionKey,'eddyInstallApps',normalize);
}

function readOrder() {
  return readSetting(orderKey,'eddyInstallOrder',restoreAppOrder);
}

let selected = readSelection();
let order = readOrder();

export function getSelectedApps() {
  return new Set(selected ?? defaultIds);
}

// Community aliases are namespaced so an imported app called "music" can sit beside Music.
export function installedAppOrder(order, selectedIds, communityIds) {
  const included = new Set([...selectedIds, ...communityIds.map(communityOrderId)]);
  const arranged = order.filter(id => included.delete(id));
  return [...arranged, ...included];
}

export function getAppOrder() {
  const saved = order ?? defaultAppOrder;
  const active = savedCommunity().map(communityOrderId);
  const added = active.filter(id => !saved.includes(id));
  if (saved.length + added.length <= defaultAppOrder.length + communityLimit) return [...saved,...added];
  const kept = new Set(active);
  // Records retain their import order. If the 32 alias slots fill up, evict the oldest
  // hidden positions first so new selections always fit and recently added apps keep their place.
  const byAge = [...saved.filter(id => id.startsWith('lab:')), ...communityApps.map(app => communityOrderId(app.id))];
  for (const id of byAge.reverse()) {
    if (kept.size >= communityLimit) break;
    if (saved.includes(id)) kept.add(id);
  }
  return [...saved.filter(id => defaultAppOrder.includes(id) || kept.has(id)), ...added];
}

function persist(key, historyKey, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    if (history.state?.[historyKey]) {
      const saved = {...history.state};
      delete saved[historyKey];
      history.replaceState(saved, '');
    }
  } catch {
    // Keep this history entry usable if browser storage is blocked or full.
    try { history.replaceState({...history.state, [historyKey]:value}, ''); } catch {}
  }
  window.dispatchEvent(new Event('eddy-apps-changed'));
}

export function setSelectedApps(ids) {
  const next = normalize([...ids]);
  if (!next) return;
  selected = next;
  persist(selectionKey, 'eddyInstallApps', selected);
}

export function setAppOrder(ids) {
  const next = restoreAppOrder(ids);
  if (!next) return;
  order = next;
  persist(orderKey, 'eddyInstallOrder', order);
}

export function setAppSelected(id, enabled) {
  if (!catalog.some(app => app.id === id)) return;
  const next = getSelectedApps();
  if (enabled) next.add(id);
  else next.delete(id);
  setSelectedApps(next);
}

globalThis.addEventListener?.('storage', event => {
  if (event.key !== null && event.key !== selectionKey && event.key !== orderKey) return;
  selected = readSelection();
  order = readOrder();
  window.dispatchEvent(new Event('eddy-apps-changed'));
});

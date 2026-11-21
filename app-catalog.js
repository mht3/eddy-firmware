// The id opens the same app in the web preview. appId identifies its packaged FAP.
export const catalog = [
  {id:'signal', name:'Sub-GHz', appId:'eddy_signal', core:true, description:'Watch signal strength at 433.92 MHz and save a reading.'},
  {id:'rfid', name:'RFID', appId:'eddy_rfid', core:true, description:'Identify a 125 kHz tag and save its type with a name.'},
  {id:'nfc', name:'NFC', appId:'eddy_nfc', core:true, description:'Identify the protocol of a nearby contactless card.'},
  {id:'infrared', name:'Infrared', appId:'infrared', core:true, description:'Use a TV preset or learn buttons from your own remote.'},
  {id:'gpio', name:'GPIO', appId:'gpio', core:true, description:'Work with the Flipper’s pins or open a USB-to-UART bridge.'},
  {id:'ibutton', name:'iButton', appId:'eddy_ibutton', core:true, description:'Touch a contact key to the Flipper to identify its type.'},
  {id:'pomodoro', name:'Pomodoro Timer', appId:'eddy_pomodoro', core:false, description:'Set timers for focus sessions and short breaks.'},
  {id:'metronome', name:'Metronome', appId:'eddy_metronome', core:false, description:'Tap in a tempo and feel each beat on your Flipper.'},
  {id:'builder', name:'Remote Builder', appId:'eddy_remote_builder', core:false, description:'Design a six-button infrared remote with your own labels.'},
  {id:'btRemote', name:'Bluetooth Remote', appId:'eddy_bluetooth', core:false, description:'Control a camera shutter, presentation, or music over Bluetooth.'},
  {id:'music', name:'Spotify', appId:'eddy_music', core:false, description:'Control phone playback. With iPhone, see the song and artist on your Flipper.'},
];

const storageKey = 'eddy-install-apps-v1';
const defaults = catalog.filter(app => app.core).map(app => app.id);

function normalize(ids) {
  if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) return null;
  return catalog.filter(app => ids.includes(app.id)).map(app => app.id);
}

function savedSelection() {
  const entry = normalize(globalThis.history?.state?.eddyInstallApps);
  if (entry) return entry;
  try {
    const value = localStorage.getItem(storageKey);
    if (value !== null) return normalize(JSON.parse(value)) ?? defaults;
  } catch {}
  return defaults;
}

let selected = savedSelection();

export function getSelectedApps() {
  return new Set(selected);
}

export function setSelectedApps(ids) {
  const next = normalize([...ids]);
  if (!next) return;
  selected = next;
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
    if (history.state?.eddyInstallApps) {
      const saved = {...history.state};
      delete saved.eddyInstallApps;
      history.replaceState(saved, '');
    }
  } catch {
    // Keep this history entry usable if browser storage is blocked or full.
    try { history.replaceState({...history.state, eddyInstallApps:next}, ''); } catch {}
  }
  window.dispatchEvent(new Event('eddy-apps-changed'));
}

export function setAppSelected(id, enabled) {
  if (!catalog.some(app => app.id === id)) return;
  const next = getSelectedApps();
  if (enabled) next.add(id);
  else next.delete(id);
  setSelectedApps(next);
}

globalThis.addEventListener?.('storage', event => {
  if (event.key === storageKey || event.key === null) {
    selected = savedSelection();
    window.dispatchEvent(new Event('eddy-apps-changed'));
  }
});

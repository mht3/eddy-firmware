// These catalog apps are built with the same SDK as the firmware.
export const communityApps = [
  {id:'techart_calendar', name:'Calendar', description:'Browse months on your Flipper.', glyph:'31'},
  {id:'resistors', name:'Resistance calculator', description:'Look up a resistor value from its color bands.', glyph:'Ω'},
];
const key = 'eddy-community-apps-v1';
const known = ids => communityApps.filter(app => ids.includes(app.id)).map(app => app.id);

function read() {
  try {
    const ids = history.state?.eddyCommunity ?? JSON.parse(localStorage.getItem(key));
    return Array.isArray(ids) ? known(ids) : [];
  } catch { return []; }
}
let selected = read();
let available = new Set();

export function setCommunityRelease(records = {}) {
  available = new Set(communityApps.filter(app => Object.hasOwn(records, app.id)).map(app => app.id));
  window.dispatchEvent(new Event('eddy-apps-changed'));
}
export const communityAvailable = id => available.has(id);
export const getCommunitySelection = () => selected.filter(communityAvailable);
export const savedCommunity = () => [...selected];

export function selectCommunity(ids) {
  selected = known(ids);
  try {
    localStorage.setItem(key, JSON.stringify(selected));
    if (history.state?.eddyCommunity) {
      const next = {...history.state};
      delete next.eddyCommunity;
      history.replaceState(next, '');
    }
  } catch {
    try { history.replaceState({...history.state, eddyCommunity:selected}, ''); } catch {}
  }
  window.dispatchEvent(new Event('eddy-apps-changed'));
}

globalThis.addEventListener?.('storage', event => {
  if (event.key !== key && event.key !== null) return;
  selected = read();
  window.dispatchEvent(new Event('eddy-apps-changed'));
});

export function labAlias(input) {
  try {
    const url = new URL(input.trim());
    if (url.origin !== 'https://lab.flipper.net' || url.username || url.password) return null;
    return /^\/apps\/([a-z0-9_-]+)\/?$/i.exec(url.pathname)?.[1] ?? null;
  } catch { return null; }
}

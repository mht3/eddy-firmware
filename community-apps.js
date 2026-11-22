// Bundled apps are compiled with Eddy. Imported catalog apps carry their own FAP metadata.
const bundled = [
  {id:'techart_calendar', name:'Calendar', description:'Browse months on your Flipper.', glyph:'31'},
];
const selectionKey = 'eddy-community-apps-v1';
const recordsKey = 'eddy-lab-records-v1';
export const communityLimit = 32;
export const validLabAlias = id => typeof id === 'string' && /^[a-z0-9][a-z0-9_-]{0,47}$/.test(id);
const validSha = hash => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash);

function load(key, fallback) {
  try { return history.state?.[key] ?? JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function save(key, data) {
  try {
    localStorage.setItem(key,JSON.stringify(data));
    if (history.state && Object.hasOwn(history.state,key)) {
      const state = {...history.state};
      delete state[key];
      history.replaceState(state,'');
    }
  } catch {
    try { history.replaceState({...history.state,[key]:data},''); } catch {}
  }
}

function metadata(app) {
  if (!app || !validLabAlias(app.id) || bundled.some(entry => entry.id === app.id) ||
      !validSha(app.sha256) || typeof app.name !== 'string' || !app.name.trim()) return null;
  const name = app.name.trim().slice(0,80);
  const description = typeof app.description === 'string' ? app.description.slice(0,400) : '';
  const iconHex = /^[0-9a-f]{40}$/i.test(app.iconHex) ? app.iconHex.toLowerCase() : '';
  let sourceUrl = '';
  try {
    const url = new URL(app.sourceUrl, globalThis.location?.href);
    if (app.sourceUrl && (url.protocol === 'https:' ||
        (url.protocol === 'http:' && url.origin === globalThis.location?.origin))) sourceUrl = url.href;
  } catch {}
  return {id:app.id, name, description, sha256:app.sha256, iconHex, sourceUrl, glyph:name[0], imported:true};
}

export const communityApps = [...bundled];
function restoreRecords() {
  const records = load(recordsKey,[]);
  if (!Array.isArray(records)) return;
  const distinct = new Map();
  for (const record of records) {
    const app = metadata(record);
    if (app) distinct.set(app.id,app);
  }
  communityApps.splice(bundled.length,Infinity,...distinct.values());
}
restoreRecords();

function readSelection() {
  const saved = load(selectionKey,[]);
  return Array.isArray(saved) ? [...new Set(saved.filter(validLabAlias))] : [];
}
let selected = readSelection();
let available = new Set();
let compatibility;
let importing = false;
const signal = () => window.dispatchEvent(new Event('eddy-apps-changed'));
export function setCommunityRelease(records = {}, target) {
  available = new Set(bundled.filter(app => Object.hasOwn(records,app.id)).map(app => app.id));
  compatibility = target;
  signal();
}
export const catalogCompatibility = () => compatibility;
export const importInProgress = () => importing;
export function setImportBusy(value) { importing = value; signal(); }
export const communityAvailable = id => available.has(id) || Boolean(compatibility && importedRecord(id));
export const getCommunitySelection = () => selected.filter(communityAvailable);
export const savedCommunity = () => [...selected];
export const importedRecord = id => communityApps.find(app => app.imported && app.id === id);
export function selectCommunity(ids) {
  selected = [...new Set(ids.filter(id => communityApps.some(app => app.id === id)))];
  save(selectionKey,selected);
  signal();
}
export function labAlias(input) {
  try {
    const url = new URL(input.trim());
    if (url.origin !== 'https://lab.flipper.net' || url.username || url.password) return null;
    const id = /^\/apps\/([^/]+)\/?$/.exec(url.pathname)?.[1];
    return validLabAlias(id) ? id : null;
  } catch { return null; }
}

// Keep the downloaded package across reloads, including files selected by hand.
const sessionFiles = new Map();
let database;
async function fileStore(mode, request) {
  if (!globalThis.indexedDB) return;
  database ??= new Promise((resolve,reject) => {
    const open = indexedDB.open('eddy-lab-files',1);
    open.onupgradeneeded = () => open.result.createObjectStore('files');
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  const db = await database;
  return new Promise((resolve,reject) => {
    const tx = db.transaction('files',mode);
    const op = request(tx.objectStore('files'));
    tx.oncomplete = () => resolve(op.result);
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
}
export async function rememberLabApp(app) {
  const record = metadata(app);
  if (!record) throw Error('Flipper Lab returned incomplete app information.');
  const file = {sha256:record.sha256,data:app.data,license:app.license ?? ''};
  sessionFiles.set(app.id,file);
  try { await fileStore('readwrite',store => store.put(file,app.id)); } catch {}
  const previous = communityApps.findIndex(entry => entry.id === app.id);
  if (previous < 0) communityApps.push(record);
  else communityApps[previous] = record;
  save(recordsKey,communityApps.filter(entry => entry.imported));
  return record;
}
export async function readLabFile(record) {
  let file = sessionFiles.get(record.id);
  if (file?.sha256 !== record.sha256) {
    try { file = await fileStore('readonly',store => store.get(record.id)); } catch {}
  }
  return file?.sha256 === record.sha256 ? file : undefined;
}

globalThis.addEventListener?.('storage', event => {
  if (event.key !== null && event.key !== recordsKey && event.key !== selectionKey) return;
  restoreRecords();
  selected = readSelection();
  signal();
});

export const previewId = app => app.imported ? 'lab:'+app.id : app.id;
export function drawLabIcon(ctx,hex,x,y) {
  for (let row=0;row<10;row++) {
    for (let col=0;col<10;col++) {
      const at = row*4 + (col>=8 ? 2 : 0);
      if (parseInt(hex.slice(at,at+2),16) & (1<<(col%8))) ctx.fillRect(x+col,y+row,1,1);
    }
  }
}

// These named buttons and remotes belong to the browser simulation.
let saved;
try { saved = JSON.parse(localStorage.getItem('eddy-preview-remotes')); } catch {}
const validName = n => typeof n==='string' && n.trim() && n.length<=22;
let remotes=(Array.isArray(saved?.remotes)?saved.remotes:[])
  .filter(r=>validName(r?.name) && Array.isArray(r.buttons) && r.buttons.length && r.buttons.every(validName));
const maxPins=16;
const savedPins=Array.isArray(saved?.pins) ? saved.pins : [saved?.pin];
let pins=[...new Set(savedPins)].filter(name=>remotes.some(r=>r.name===name)).slice(0,maxPins);
let active=null;
function save() {
  try { localStorage.setItem('eddy-preview-remotes',JSON.stringify({remotes,pins})); } catch {}
}
export const remoteDemo = {
  get active() { return active?.name; },
  get pin() { return pins.at(-1); },
  get pins() { return [...pins]; },
  get buttons() { return active?.buttons || []; },
  get rows() { return [...remotes].sort((a,b)=>a.name.localeCompare(b.name)).map(r=>[r.name,'remote']); },
  select(name) { active=remotes.find(r=>r.name===name); },
  edit(action,name,button) {
    name=name.trim();
    button=button.trim();
    if (action!=='add' && (!validName(name) || remotes.some(r=>r.name===name && (action==='create'|| r!==active)))) return 'Choose a different remote name.';
    if (action!=='rename' && (!validName(button) || (action==='add' && active.buttons.includes(button)))) return 'Choose a different button name.';
    if (action==='rename') {
      pins=pins.map(pin=>pin===active.name?name:pin);
      active.name=name;
    } else if (action==='add') active.buttons.push(button);
    else { active={name,buttons:[button]}; remotes.push(active); }
    save();
    return '';
  },
  remove() {
    pins=pins.filter(pin=>pin!==active.name);
    remotes=remotes.filter(r=>r!==active);
    active=null;
    save();
  },
  setPinned(pin) {
    if (pin && !pins.includes(active.name)) {
      if (pins.length===maxPins) return false;
      pins.push(active.name);
    } else if (!pin) pins=pins.filter(name=>name!==active.name);
    save();
    return true;
  },
};

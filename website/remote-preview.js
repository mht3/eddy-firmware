// The preview stores names and button positions in this browser.
let saved;
try { saved = JSON.parse(localStorage.getItem('eddy-preview-remotes')); } catch {}
const validName = n => typeof n==='string' && n.trim() && n.length<=22;
let remotes=(Array.isArray(saved?.remotes)?saved.remotes:[])
  .filter(r=>validName(r?.name) && Array.isArray(r.buttons) && r.buttons.length && r.buttons.every(validName));
let layouts=(Array.isArray(saved?.layouts)?saved.layouts:[])
  .filter(r=>validName(r?.name) && Array.isArray(r.cells) && r.cells.length===6 &&
    r.cells.every(c=>c===null || (validName(c?.name) && Number.isInteger(c.icon))));
const savedPins=Array.isArray(saved?.pins) ? saved.pins : [saved?.pin];
let pins=savedPins.map(p=>typeof p==='string'?[p,'remote']:p).filter(p=>Array.isArray(p) &&
  (p[1]==='layout'?layouts:p[1]==='remote'?remotes:[]).some(r=>r.name===p[0])).slice(0,16);
let active=null;
function save() {
  try { localStorage.setItem('eddy-preview-remotes',JSON.stringify({remotes,layouts,pins:pins.map(p=>p[1]==='remote'?p[0]:p)})); }
  catch { return false; }
  return true;
}
function pinIndex(name,page) { return pins.findIndex(p=>p[0]===name && p[1]===page); }
function setPin(name,page,enabled) {
  const previous=pins.map(p=>[...p]);
  const i=pinIndex(name,page);
  if(enabled && i<0) {
    if(pins.length>=16) return 'full';
    pins.push([name,page]);
  } else if(!enabled && i>=0) pins.splice(i,1);
  if(save()) return '';
  pins=previous;
  return 'storage';
}
export const layoutDemo = {
  get names() { return layouts.map(l=>l.name).sort((a,b)=>a.localeCompare(b)); },
  get(name) { return layouts.find(l=>l.name===name); },
  create(name) {
    if (!validName(name) || /[\\/:*?"<>|]/.test(name) || name.startsWith('.') || name.endsWith('.') ||
        layouts.some(l=>l.name.toLowerCase()===name.toLowerCase())) return 'Choose another remote name.';
    layouts.push({name,cells:Array(6).fill(null)});
    if (!save()) { layouts.pop(); return 'This browser could not save the remote.'; }
    return '';
  },
  update(name,cells) {
    const layout=this.get(name), previous=layout.cells;
    layout.cells=cells;
    if (save()) return true;
    layout.cells=previous;
    return false;
  },
  pinned(name) { return pinIndex(name,'layout')>=0; },
  setPinned(name,on) { return setPin(name,'layout',on); },
};
export const remoteDemo = {
  get active() { return active?.name; },
  get pin() { return this.pins.at(-1); },
  pinError:'',
  get pins() { return pins.filter(p=>p[1]==='remote').map(p=>p[0]); },
  get shortcuts() { return pins.map(p=>[...p]); },
  get buttons() { return active?.buttons || []; },
  get rows() { return [...remotes].sort((a,b)=>a.name.localeCompare(b.name)).map(r=>[r.name,'remote']); },
  select(name) { active=remotes.find(r=>r.name===name); },
  edit(action,name,button) {
    name=name.trim();
    button=button.trim();
    if (action!=='add' && (!validName(name) || remotes.some(r=>r.name===name && (action==='create'|| r!==active)))) return 'Choose a different remote name.';
    if (action!=='rename' && (!validName(button) || (action==='add' && active.buttons.includes(button)))) return 'Choose a different button name.';
    if (action==='rename') {
      const i=pinIndex(active.name,'remote');
      if (i>=0) pins[i][0]=name;
      active.name=name;
    } else if (action==='add') active.buttons.push(button);
    else { active={name,buttons:[button]}; remotes.push(active); }
    save();
    return '';
  },
  remove() {
    const i=pinIndex(active.name,'remote');
    if (i>=0) pins.splice(i,1);
    remotes=remotes.filter(r=>r!==active);
    active=null;
    save();
  },
  setPinned(pin) {
    this.pinError=setPin(active.name,'remote',pin);
    return !this.pinError;
  },
};

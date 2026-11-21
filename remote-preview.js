// The preview stores names and button positions in this browser.
let saved;
try { saved = JSON.parse(localStorage.getItem('eddy-preview-remotes')); } catch {}
const validName = n => typeof n==='string' && n.trim() && n.length<=22;
let remotes=(Array.isArray(saved?.remotes)?saved.remotes:[])
  .filter(r=>validName(r?.name) && Array.isArray(r.buttons) && r.buttons.every(validName));
let layouts=(Array.isArray(saved?.layouts)?saved.layouts:[])
  .filter(r=>validName(r?.name) && Array.isArray(r.cells) && r.cells.length<=24 &&
    r.cells.every(c=>c===null || (validName(c?.name) && Number.isInteger(c.icon))));
for(const layout of layouts) layout.cells=layout.cells.filter(Boolean);
const savedPins=Array.isArray(saved?.pins) ? saved.pins : [saved?.pin];
let pins=savedPins.map(p=>typeof p==='string'?[p,'remote']:p).filter(p=>Array.isArray(p) &&
  (p[1]==='layout'?layouts:p[1]==='remote'?remotes:[]).some(r=>r.name===p[0])).slice(0,16);
let active=null;
function save(nextRemotes=remotes,nextPins=pins) {
  try { localStorage.setItem('eddy-preview-remotes',JSON.stringify({remotes:nextRemotes,layouts,pins:nextPins.map(p=>p[1]==='remote'?p[0]:p)})); }
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
  get entries() {
    return [...layouts.map(l=>[l.name,'layout']),...remotes.map(r=>[r.name,'remote'])]
      .sort(([a],[b])=>a.localeCompare(b));
  },
  source(name,kind) { return kind==='layout'?'Custom':remotes.find(r=>r.name===name)?.preset?'TV presets':'Infrared'; },
  get(name,kind='layout') {
    if(kind==='layout') return layouts.find(l=>l.name===name);
    const remote=remotes.find(r=>r.name===name);
    const labels=['Power','Vol +','Vol -','Mute','Play/Pause','Channel +','Channel -','Input'];
    return remote && {name,cells:remote.buttons.map(name=>{
      const index=labels.indexOf(name);
      return {name,icon:index<0?8:index};
    })};
  },
  create(name) {
    if (!validName(name) || /[\\/:*?"<>|]/.test(name) || name.startsWith('.') || name.endsWith('.') ||
        layouts.some(l=>l.name.toLowerCase()===name.toLowerCase())) return 'Choose another remote name.';
    layouts.push({name,cells:[]});
    if (!save()) { layouts.pop(); return 'This browser could not save the remote.'; }
    return '';
  },
  addPreset(name,buttons) {
    const existing=remotes.find(r=>r.preset===name);
    if(existing) return existing.name;
    let title=name;
    for(let i=2;remotes.some(r=>r.name===title);i++) title=name+' '+i;
    remotes.push({name:title,buttons:[...buttons],preset:name});
    if(save()) return title;
    remotes.pop();
    return '';
  },
  update(name,cells,kind='layout') {
    const layout=(kind==='layout'?layouts:remotes).find(r=>r.name===name);
    if(!layout) return false;
    const key=kind==='layout'?'cells':'buttons', previous=layout[key];
    layout[key]=kind==='layout'?cells:cells.map(c=>c.name);
    if (save()) return true;
    layout[key]=previous;
    return false;
  },
  remove(name,kind) {
    const items=kind==='layout'?layouts:remotes, index=items.findIndex(r=>r.name===name);
    if(index<0) return false;
    const [remote]=items.splice(index,1), previous=pins;
    pins=pins.filter(([n,k])=>n!==name || k!==kind);
    if(save()) { if(active===remote) active=null; return true; }
    items.splice(index,0,remote); pins=previous; return false;
  },
  pinned(name,kind='layout') { return pinIndex(name,kind)>=0; },
  setPinned(name,on,kind='layout') { return setPin(name,kind,on); },
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
    const editing=action==='rename' || action==='add';
    const updated=editing ? {...active} : {name,buttons:[button]};
    if(action==='rename') updated.name=name;
    if(action==='add') updated.buttons=[...active.buttons,button];
    const nextRemotes=editing ? remotes.map(r=>r===active?updated:r) : [...remotes,updated];
    const nextPins=action==='rename' ? pins.map(p=>p[0]===active.name && p[1]==='remote'?[name,'remote']:p) : pins;
    if(!save(nextRemotes,nextPins)) return 'Could not save in this browser.';
    remotes=nextRemotes;
    pins=nextPins;
    active=updated;
    return '';
  },
  remove() {
    return active && layoutDemo.remove(active.name,'remote');
  },
  setPinned(pin) {
    this.pinError=setPin(active.name,'remote',pin);
    return !this.pinError;
  },
};

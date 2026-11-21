// These named buttons and remotes belong to the browser simulation.
let saved;
try { saved = JSON.parse(localStorage.getItem('eddy-preview-remotes')); } catch {}
const validName = n => typeof n==='string' && n.trim() && n.length<=22;
let remotes=(Array.isArray(saved?.remotes)?saved.remotes:[])
  .filter(r=>validName(r?.name) && Array.isArray(r.buttons) && r.buttons.length && r.buttons.every(validName));
let pin=remotes.some(r=>r.name===saved?.pin) ? saved.pin : null;
let active=null;
function save() {
  try { localStorage.setItem('eddy-preview-remotes',JSON.stringify({remotes,pin})); } catch {}
}
export const remoteDemo = {
  get active() { return active?.name; },
  get pin() { return pin; },
  get buttons() { return active?.buttons || []; },
  get rows() { return [...remotes].sort((a,b)=>a.name.localeCompare(b.name)).map(r=>[r.name,'remote']); },
  select(name) { active=remotes.find(r=>r.name===name); },
  edit(action,name,button) {
    name=name.trim();
    button=button.trim();
    if (action!=='add' && (!validName(name) || remotes.some(r=>r.name===name && (action==='create'|| r!==active)))) return 'Choose a different remote name.';
    if (action!=='rename' && (!validName(button) || (action==='add' && active.buttons.includes(button)))) return 'Choose a different button name.';
    if (action==='rename') {
      if (pin===active.name) pin=name;
      active.name=name;
    } else if (action==='add') active.buttons.push(button);
    else { active={name,buttons:[button]}; remotes.push(active); }
    save();
    return '';
  },
  remove() {
    if (pin===active.name) pin=null;
    remotes=remotes.filter(r=>r!==active);
    active=null;
    save();
  },
  togglePin() { pin=pin===active.name?null:active.name; save(); },
};

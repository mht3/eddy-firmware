import {openEditor} from './lcd-input.js';
// The preview stores only the displayed protocol or meter reading, just like the device.
const key = 'eddy-observations-v1';
function loadNotes() {
  const data = JSON.parse(localStorage.getItem(key) || '[]');
  if (!Array.isArray(data) || data.some(note => !note ||
    ['category','name','detail'].some(field => typeof note[field] !== 'string'))) {
    throw new Error('Unreadable observations');
  }
  return data;
}

export function listNotes(category) {
  return loadNotes().filter(note => note.category === category)
    .sort((a,b) => {
      const left = a.name.toLowerCase(), right = b.name.toLowerCase();
      return left < right ? -1 : left > right ? 1 : 0;
    });
}

export function nameNote(category, detail, saved) {
  let value='Observation';
  try {
    const used=new Set(listNotes(category).map(note=>note.name.toLowerCase()));
    for(let n=1;used.has(value.toLowerCase());n++) value='Observation'+n;
  } catch { /* The submit handler reports unavailable storage. */ }
  openEditor('Name observation',value,22,name=>{
    if(!name || /^[. ]|[. ]$/.test(name) || /[^ -~]|[<>:"/\\|?*]/.test(name)) return 'Choose a file-safe name';
    try {
      const all=loadNotes();
      if(all.some(note=>note.category===category && note.name.toLowerCase()===name.toLowerCase())) return 'Name in use. Pick another.';
      const note={category,name,detail};
      localStorage.setItem(key,JSON.stringify([...all,note]));
      saved(note);
    } catch {return 'Could not save in this browser.';}
  });
}

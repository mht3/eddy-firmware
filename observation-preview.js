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
  const dialog = document.querySelector('#observation-dialog');
  const input = dialog.querySelector('input');
  input.value = 'Observation';
  try {
    const used = new Set(listNotes(category).map(note => note.name.toLowerCase()));
    for (let suffix=1; used.has(input.value.toLowerCase()); suffix++) input.value = 'Observation'+suffix;
  } catch { /* The save action reports a browser storage error if it persists. */ }
  input.setCustomValidity('');
  dialog.querySelector('form').onsubmit = event => {
    event.preventDefault();
    const name = input.value;
    let error = '';
    if (!name || name.length > 22 || /^[. ]|[. ]$/.test(name) ||
      /[^ -~]|[<>:"/\\|?*]/.test(name)) error = 'Choose a file-safe name.';
    if (!error) {
      try {
        const all = loadNotes();
        if (all.some(note => note.category === category && note.name.toLowerCase() === name.toLowerCase())) {
          error = 'That name is already in use.';
        } else {
          const note = {category,name,detail};
          localStorage.setItem(key,JSON.stringify([...all,note]));
          dialog.close();
          saved(note);
          return;
        }
      } catch { error = 'Could not save in this browser.'; }
    }
    input.setCustomValidity(error);
    input.reportValidity();
  };
  input.oninput = () => input.setCustomValidity('');
  dialog.querySelector('[type=button]').onclick = () => dialog.close();
  dialog.showModal();
  input.select();
}

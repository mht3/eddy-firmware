import {openEditor} from './lcd-input.js';

export function askName(label,value,length,submit) {
  openEditor(label,value,length,name=>name.trim() ? submit(name.trim()) : 'Enter a name.');
}

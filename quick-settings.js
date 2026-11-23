import {text} from './lcd.js';
import {icon,rounded} from './launcher-graphics.js';
const labels = ['Brightness', 'Volume', 'Settings'];
export const settingsRows = [
  ['Bluetooth','bluetooth'], ['LCD and Notifications','notifications'], ['Storage','storage'],
  ['Power','power'], ['Desktop','desktop'], ['Passport','passport'], ['System','system'],
  ['Expansion Modules','expansion'], ['Clock & Alarm','clock'], ['Input','input'], ['About','about'],
];

const defaults = [100,100];
let levels = defaults.slice();
try {
  const saved = JSON.parse(localStorage.getItem('eddy-quick-settings'));
  if (Array.isArray(saved) && saved.length===2 && saved.every(v=>Number.isInteger(v) && v>=0 && v<=100)) levels=saved;
} catch {}

export function quickStatus(row) {
  return row===2 ? 'Settings. Press OK for device settings.' : labels[row]+', '+levels[row]+'%. Up or Down to adjust.';
}

export function adjustQuick(row, change) {
  if (row>=2) return;
  levels[row] = Math.max(0,Math.min(100,levels[row]+change));
  try { localStorage.setItem('eddy-quick-settings',JSON.stringify(levels)); } catch {}
}

export function drawQuick(ctx, row) {
  labels.forEach((label,i)=>{
    const x=21+42*i;
    const width=i===2 ? 27 : 15;
    const left=x-Math.floor(width/2);
    rounded(ctx,left,12,width,27,4);
    if(row===i) rounded(ctx,left-2,10,width+4,31,5);
    if(i<2) {
      const height=Math.round(19*levels[i]/100);
      ctx.fillRect(x-4,35-height,9,height);
    } else icon(ctx,'gear',x,24);
    text(ctx,label,x,49,'secondary','center');
  });
  text(ctx,row===2?'OK for device settings':levels[row]+'%   Up / Down',64,62,'secondary','center');
}
export const quickPercent = row => levels[row];

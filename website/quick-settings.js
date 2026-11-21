const labels = ['Brightness', 'Volume', 'Settings'];
export const settingsRows = [
  ['Bluetooth','bluetooth'], ['LCD and Notifications','notifications'], ['Storage','storage'],
  ['Power','power'], ['Desktop','desktop'], ['Passport','passport'], ['System','system'],
  ['Expansion Modules','expansion'], ['Clock & Alarm','clock'], ['Input','input'], ['About','about'],
];

export const settingsSamples = {
  bluetooth:['Bluetooth','Ready to pair'], notifications:['Backlight and sound'], storage:['microSD card','Space available: 12 GB'],
  desktop:['Eddy home screen'], system:['Firmware: Eddy','Hardware: Flipper Zero'],
  expansion:['Expansion modules'], input:['Device buttons'],
};

const defaults = [75,50];
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
  ctx.save();
  ctx.textAlign='center';
  labels.forEach((label,i)=>{
    const x=21+42*i;
    ctx.beginPath();
    ctx.roundRect(x-13,3,27,35,5);
    ctx.stroke();
    if (row===i) {
      ctx.beginPath();
      ctx.roundRect(x-15,1,31,39,6);
      ctx.stroke();
    }
    if (i<2) {
      const height=Math.round(29*levels[i]/100);
      ctx.fillRect(x-10,35-height,21,height);
      // Amber ink remains visible over the filled part of each meter.
      ctx.save();
      ctx.font='bold 13px sans-serif';
      const symbol=i===0?'☼':'♪';
      ctx.fillText(symbol,x,13);
      ctx.beginPath();
      ctx.rect(x-10,35-height,21,height);
      ctx.clip();
      ctx.globalCompositeOperation='destination-out';
      ctx.fillText(symbol,x,13);
      ctx.restore();
    } else {
      ctx.font='18px sans-serif';
      ctx.fillText('⚙',x,10);
    }
    ctx.font='7px sans-serif';
    ctx.fillText(label,x,41);
  });
  ctx.fillText(row===2?'OK for device settings':levels[row]+'%   Up / Down',64,54);
  ctx.restore();
}

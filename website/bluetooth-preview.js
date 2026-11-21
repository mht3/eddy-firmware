import {askName} from './preview-name.js';
const demoAddress='12:34:56:78:9A:BC';
let nickname='';
try { nickname=localStorage.getItem('eddy-preview-bt-label') || ''; } catch {}
const modes=['Camera','Slides','Media'];
export function bluetoothKey(s,key,render) {
  if(key==='hold' && !s.mode) {
    askName('Name this demo device',nickname,14,name=>{
      try { localStorage.setItem('eddy-preview-bt-label',name); }
      catch { return 'This browser could not save the name.'; }
      nickname=name; render(); return '';
    });
  } else if(key==='back') {
    if(!s.mode) return false;
    s.mode=null;
  } else if(s.mode) {
    const commands={Camera:{ok:'Shutter'},Slides:{left:'Previous slide',right:'Next slide'},Media:{ok:'Play / pause',left:'Previous track',right:'Next track'}};
    s.message=commands[s.mode][key] || '';
  } else if(key==='up' || key==='down') s.row=(s.row+(key==='up'?2:1))%3;
  else if(key==='ok') { s.mode=modes[s.row]; s.message=''; }
  return true;
}
export function bluetoothStatus(s) {
  if(!s.mode) return modes[s.row]+'. Simulated Bluetooth connection. '+(nickname || demoAddress)+'. Hold OK to name this device.';
  return s.mode+'. Demo connected. '+(s.message || {Camera:'OK shutter',Slides:'Left previous, Right next',Media:'OK play or pause, Left or Right for tracks'}[s.mode]);
}
export function drawBluetooth(ctx,s) {
  ctx.font='bold 9px sans-serif'; ctx.fillText(s.mode || 'Bluetooth Remote',2,1,89);
  ctx.fillRect(1,11,126,1);
  ctx.font='8px sans-serif'; ctx.fillText('Demo · '+(nickname || demoAddress),3,53,121);
  if(!s.mode) {
    modes.forEach((mode,i)=>{
      const y=13+12*i;
      if(i===s.row)ctx.fillRect(1,y,67,11);
      ctx.fillStyle=i===s.row?'#ffbe70':'#432a14';
      ctx.fillText(mode,5,y+1); ctx.fillStyle='#432a14';
    });
    ctx.fillText('Hold OK',73,19); ctx.fillText('to name device',73,32,53);
  } else {
    const lines={Camera:['Open iPhone Camera','OK shutter'],Slides:['Start your slideshow','‹ Previous     Next ›'],Media:['‹ Previous     Next ›','OK play / pause']}[s.mode];
    ctx.font='bold 10px sans-serif'; ctx.fillText(lines[0],4,19);
    ctx.font='9px sans-serif'; ctx.fillText(s.message || lines[1],4,35);
  }
}

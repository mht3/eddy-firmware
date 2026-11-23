import {text,textWidth} from './lcd.js';
import {box,line,inverted} from './utility-pixels.js';
import {askName} from './preview-name.js';
const demoAddress='12:34:56:78:9A:BC';
let nickname='';
try { nickname=localStorage.getItem('eddy-preview-bt-label') || ''; } catch {}
const modes=['Camera','Slides','Media'];
export function bluetoothKey(s,key,render) {
  if(key==='hold' && !s.mode) {
    askName('Name this device',nickname,14,name=>{
      try { localStorage.setItem('eddy-preview-bt-label',name); }
      catch { return 'This browser could not save the name.'; }
      nickname=name; render(); return '';
    });
  } else if(key==='back') {
    if(!s.mode) return false;
    s.mode=null;
  } else if(s.mode) {
    const message=key==='ok' && s.mode==='Camera'?'Shutter sent':key==='ok' && s.mode==='Media'?'Play / pause sent':
      key==='left' && s.mode!=='Camera'?'Previous sent':key==='right' && s.mode!=='Camera'?'Next sent':null;
    if(message) {
      s.message=message;
      clearTimeout(s.feedbackTimer);
      s.feedbackTimer=setTimeout(()=>{s.message='';render();},650);
    }
  } else if(key==='up' || key==='down') s.row=(s.row+(key==='up'?2:1))%3;
  else if(key==='ok') { s.mode=modes[s.row]; s.message=''; }
  return true;
}
export function bluetoothStatus(s) {
  if(!s.mode) return modes[s.row]+'. Simulated Bluetooth connection. '+(nickname || demoAddress)+'. Hold OK to name this device.';
  return s.mode+'. Demo connected. '+(s.message || {Camera:'OK shutter',Slides:'Left previous, Right next',Media:'OK play or pause, Left or Right for tracks'}[s.mode]);
}
export function drawBluetooth(ctx,s) {
  text(ctx,s.mode || 'Bluetooth Remote',2,10,'primary');
  if(!s.mode) {
    modes.forEach((mode,i)=>{
      const y=13+12*i;
      if(i===s.row) box(ctx,1,y,61,12,3,true);
      inverted(ctx,i===s.row,()=>text(ctx,mode,6,y+9));
    });
    text(ctx,'Hold OK',73,28);
    text(ctx,'name device',73,40);
  } else {
    const [hint,action]={
      Camera:['Open Camera on iPhone','OK: take photo'],
      Slides:['Start your slideshow','< Previous       Next >'],
      Media:['< Previous      Next >','OK: play / pause'],
    }[s.mode];
    text(ctx,hint,64,27,'secondary','center');
    text(ctx,s.message || action,64,45,'primary','center');
  }
  const status='Linked '+(nickname || demoAddress);
  if(nickname && textWidth(status)>122) {
    line(ctx,2,50,4,52); line(ctx,4,52,8,48); line(ctx,12,51,125,51);
    text(ctx,nickname,1,62);
  } else {
    line(ctx,2,51,125,51);
    text(ctx,status,3,62);
  }
}

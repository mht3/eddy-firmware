import {drawBattery,text,textWidth} from './lcd.js';
export {drawBattery, overlayBattery} from './lcd.js';
import {icon, rounded} from './launcher-graphics.js';

export const sampleCharge = 84;
export const ocean = new Image();
ocean.src = new URL('eddy-ocean.png', import.meta.url).href;

export function drawHome(ctx, frame, charging = false, bluetooth = false, clock = false) {
  ctx.save();
  ctx.fillStyle = '#432a14';
  ctx.imageSmoothingEnabled = false;
  const width=bluetooth?23:16;
  rounded(ctx,0,0,width,13,1);
  ctx.fillRect(width-2,1,1,11);
  ctx.fillRect(1,11,width-2,1);
  icon(ctx,'sd',7,6);
  if(bluetooth) icon(ctx,'ble',17,6);
  if(clock) {
    const now=new Date();
    const value=[now.getHours(),now.getMinutes()].map(n=>String(n).padStart(2,'0')).join(':');
    const width=textWidth(value,'primary')-1+(now.getMinutes()%10===1?1:0);
    const left=89-width;
    rounded(ctx,left,0,93-left,13,1);
    ctx.fillRect(91,1,1,11); ctx.fillRect(left+1,11,92-left-1,1);
    text(ctx,value,left+2,10,'primary');
  }
  drawBattery(ctx, charging, 2);
  if (ocean.naturalWidth) ctx.drawImage(ocean,frame*128,0,128,50,0,14,128,50);
  ctx.restore();
}

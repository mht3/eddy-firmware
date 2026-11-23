export const launcherArt = new Image();
launcherArt.src = new URL('launcher.png', import.meta.url).href;

// First frames of the firmware icons, centered in 18-pixel cells.
const icons = ['apps','settings','off','signal','rfid','nfc','infrared','gpio','ibutton',
  'pomodoro','metronome','builder','btRemote','music','spotify','gear','sd','ble'];

export function icon(ctx, id, x, y) {
  const index = icons.indexOf(id);
  if (index >= 0 && launcherArt.naturalWidth) {
    ctx.drawImage(launcherArt,index*18,0,18,18,x-9,y-9,18,18);
  }
  return index >= 0;
}

export {rounded} from './lcd.js';

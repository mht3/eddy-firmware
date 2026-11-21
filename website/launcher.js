// Matches MenuStyleWii in applications/services/gui/modules/menu.c.
// The atlas uses the firmware's 14px icon animations and FontSecondary labels.
export const launcherArt = new Image();
launcherArt.src = new URL('launcher.png', import.meta.url).href;
export const launcherApps = [
  {name:'Apps', page:'apps', frames:9, width:19},
  {name:'SubGHz', page:'subghz', frames:6, width:32},
  {name:'RFID', page:'rfid', frames:4, width:19},
  {name:'NFC', page:'nfc', frames:4, width:17},
  {name:'Infrared', page:'infrared', frames:6, width:32},
  {name:'GPIO', page:'gpio', frames:8, width:19},
  {name:'iButton', page:'ibutton', frames:7, width:30},
  {name:'Bad KB', page:'badkb', frames:11, width:29},
  {name:'U2F', page:'u2f', frames:4, width:17},
  {name:'Signal Meter', page:'signal', frames:6, width:52},
  {name:'Eddy', page:'settings', frames:11, width:20},
  {name:'Settings', page:'system', frames:10, width:34},
];

function drawTile(ctx, selected) {
  if (selected) {
    ctx.fillRect(1,0,38,30);
    ctx.fillRect(0,1,40,28);
  } else {
    ctx.fillRect(2,0,37,1);
    ctx.fillRect(1,1,1,1);
    ctx.fillRect(0,2,1,27);
    ctx.fillRect(39,1,1,28);
    ctx.fillRect(40,2,1,27);
    ctx.fillRect(1,29,40,1);
    ctx.fillRect(2,30,38,1);
  }
}

// Glyph positions from the firmware font. Long labels scroll one glyph at a time.
const signalGlyphs = [0,6,8,13,18,23,25,27,35,40,44,49,53];

export function drawLauncher(ctx, selection, elapsed) {
  // Momentum scrolls a column at a time with the selection in the middle.
  const first = Math.max(0,Math.min(launcherApps.length-6,2*Math.floor(selection/2)-2));
  for (let slot=0; slot<6; slot++) {
    const i = first+slot;
    const app = launcherApps[i];
    const selected = i === selection;
    ctx.save();
    ctx.translate(1 + Math.floor(slot/2)*43, (slot%2)*32);
    drawTile(ctx,selected);
    if (launcherArt.naturalWidth) {
      const tick = selected ? Math.floor(elapsed/333) : 0;
      const frame = tick % app.frames;
      if (selected) ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(launcherArt,frame*14,i*14,14,14,13,3,14,14);
      let offset = 0, width = app.width, x = 20-Math.floor(width/2);
      if (width > 36) {
        const start = Math.max(0,tick-1) % 7;
        offset = signalGlyphs[start];
        const end = signalGlyphs.filter(pos => pos <= offset+37).at(-1);
        width = end-offset-1;
        x = 2;
      }
      ctx.drawImage(launcherArt,154+offset,i*14,width,14,x,16,width,14);
    }
    ctx.restore();
  }
}

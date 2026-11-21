// Icons and positions match the device launcher in loader_menu.c.
export const launcherArt = new Image();
launcherArt.src = new URL('launcher.png', import.meta.url).href;
export const sections = [
  ['Apps','apps'], ['Settings','settings'], ['Power off','off'],
];
export const apps = [
  ['Sub-GHz','signal'], ['RFID','rfid'], ['NFC','nfc'], ['Infrared','infrared'],
  ['GPIO','gpio'], ['iButton','ibutton'], ['Pomodoro Timer','pomodoro'], ['Metronome','metronome'],
  ['Remote Builder','builder'], ['Bluetooth Remote','btRemote'], ['Spotify','music'],
];

export function drawLauncher(ctx, page, selected, gridItems = apps) {
  const grid = page === 'apps';
  const items = grid ? gridItems : sections;
  ctx.font = '7px sans-serif';
  ctx.textAlign = 'center';
  const first = grid ? Math.floor(selected/8)*8 : 0;
  if (items.length>8) {
    ctx.textAlign = 'left';
    ctx.fillText('Apps '+(first/8+1)+'/'+Math.ceil(items.length/8),2,0);
    ctx.textAlign = 'center';
  }
  items.slice(first,first+8).forEach(([name],slot) => {
    const i = first+slot;
    const x = grid ? 16 + 32*(i%4) : 21 + 42*i;
    const y = grid ? 18 + 20*Math.floor(slot/4) : 26;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x-12,y-(grid?9:10),25,grid?19:21,4);
    if (i === selected) {
      ctx.fill();
      ctx.globalCompositeOperation = 'destination-out';
    } else ctx.stroke();
    if (grid && i>=apps.length) {
      let label='';
      for(const char of name) {
        if(ctx.measureText(label+char).width>21) break;
        label+=char;
      }
      ctx.fillText(label,x,y-3);
    } else if (grid && ['builder','btRemote'].includes(items[i][1])) {
      ctx.beginPath();
      if (items[i][1]==='btRemote') {
        ctx.moveTo(x-4,y-4); ctx.lineTo(x+4,y+3); ctx.lineTo(x,y+7);
        ctx.lineTo(x,y-7); ctx.lineTo(x+4,y-3); ctx.lineTo(x-4,y+4);
      } else {
        for (let r=0;r<2;r++) for (let c=0;c<3;c++) ctx.rect(x-7+c*5,y-4+r*5,3,3);
      }
      ctx.stroke();
    } else if (launcherArt.naturalWidth) {
      const index = grid ? (items[i][1]==='music' ? 7 : i) + sections.length : i;
      ctx.drawImage(launcherArt,index*18,0,18,18,x-9,y-9,18,18);
    }
    ctx.restore();
    if (!grid) ctx.fillText(name,x,40);
  });
  if (grid) {
    ctx.fillRect(4,49,120,1);
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText(items[selected][0],64,51,120);
  }
  ctx.textAlign = 'start';
}

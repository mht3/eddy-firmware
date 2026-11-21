// Icons and positions match the device launcher in loader_menu.c.
export const launcherArt = new Image();
launcherArt.src = new URL('launcher.png', import.meta.url).href;
export const sections = [
  ['Apps','apps'], ['Settings','settings'], ['Power','power'],
];
export const apps = [
  ['Sub-GHz','signal'], ['RFID','rfid'], ['NFC','nfc'], ['Infrared','infrared'],
  ['GPIO','gpio'], ['iButton','ibutton'], ['Pomodoro Timer','pomodoro'],
];

export function drawLauncher(ctx, page, selected, gridItems = apps) {
  const grid = page === 'apps';
  const items = grid ? gridItems : sections;
  ctx.font = '7px sans-serif';
  ctx.textAlign = 'center';
  items.forEach(([name],i) => {
    const x = grid ? 16 + 32*(i%4) : 21 + 42*i;
    const y = grid ? 18 + 20*Math.floor(i/4) : 26;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x-12,y-(grid?9:10),25,grid?19:21,4);
    if (i === selected) {
      ctx.fill();
      ctx.globalCompositeOperation = 'destination-out';
    } else ctx.stroke();
    if (launcherArt.naturalWidth) {
      const index = grid ? (i < apps.length ? i : 3) + sections.length : i;
      ctx.drawImage(launcherArt,index*18,0,18,18,x-9,y-9,18,18);
    }
    ctx.restore();
    if (!grid) ctx.fillText(name,x,40);
  });
  if (grid) {
    ctx.fillRect(4,49,120,1);
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText(items[selected][0],64,51);
  }
  ctx.textAlign = 'start';
}

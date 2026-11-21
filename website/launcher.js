import {catalog, getAppOrder} from './app-catalog.js';
// Icons and positions match the device launcher in loader_menu.c.
export const launcherArt = new Image();
launcherArt.src = new URL('launcher.png', import.meta.url).href;
export const sections = [
  ['Apps','apps'], ['Settings','settings'], ['Power off','off'],
];
export const apps = catalog.map(({name,id})=>[name,id]);

// The list stays dense for Left/Right. Its third field is the physical cell on the display.
export function layoutApps(items, order = getAppOrder()) {
  const cells = [];
  order.forEach(id => {
    const item = items.find(([,target]) => target === id);
    if (item) cells.push([item[0],id,cells.length]);
  });
  for (const [name,id] of items) {
    if (!order.includes(id)) cells.push([name,id,cells.length]);
  }
  return cells;
}

export function verticalApp(items,index,key) {
  if (!items.length) return 0;
  const rows = Math.ceil(items.length/4);
  const row = Math.floor(index/4);
  const nextRow = (row + (key === 'up' ? rows-1 : 1)) % rows;
  return Math.min(nextRow*4 + index%4, items.length-1);
}

export function drawLauncher(ctx, page, selected, gridItems = layoutApps(apps)) {
  const grid = page === 'apps';
  const items = grid ? gridItems : sections;
  ctx.font = '7px sans-serif';
  ctx.textAlign = 'center';
  if (!items.length) {
    ctx.font = '10px sans-serif';
    ctx.fillText('No apps installed',64,26);
    ctx.textAlign = 'start';
    return;
  }
  const pageNumber = grid ? Math.floor(items[selected][2]/8) : 0;
  const pageCount = grid ? Math.floor(items.at(-1)[2]/8)+1 : 1;
  if (pageCount>1) {
    ctx.textAlign = 'left';
    ctx.fillText('Apps '+(pageNumber+1)+'/'+pageCount,2,0);
    ctx.textAlign = 'center';
  }
  items.forEach(([name,id,cell],i) => {
    if (grid && Math.floor(cell/8)!==pageNumber) return;
    const x = grid ? 16 + 32*(cell%4) : 21 + 42*i;
    const y = grid ? 18 + 20*Math.floor((cell%8)/4) : 26;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x-12,y-(grid?9:10),25,grid?19:21,4);
    if (i === selected) {
      ctx.fill();
      ctx.globalCompositeOperation = 'destination-out';
    } else ctx.stroke();
    const appIndex = grid ? apps.findIndex(([,id])=>id===items[i][1]) : -1;
    if (grid && appIndex<0) {
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
      const musicGlyphs = {music:10,spotify:11};
      const index = grid ? (musicGlyphs[id] ?? appIndex+sections.length) : i;
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

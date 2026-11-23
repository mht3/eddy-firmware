import {catalog, getAppOrder, launcherColumns, launcherPageSize} from './app-catalog.js';
import {importedRecord,drawLabIcon} from './community-apps.js';
import {text, textWidth} from './lcd.js';
import {icon, rounded} from './launcher-graphics.js';
export {launcherArt} from './launcher-graphics.js';
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
  const rows = Math.ceil(items.length/launcherColumns);
  const row = Math.floor(index/launcherColumns);
  const nextRow = (row + (key === 'up' ? rows-1 : 1)) % rows;
  return Math.min(nextRow*launcherColumns + index%launcherColumns, items.length-1);
}

export function drawLauncher(ctx, page, selected, gridItems = layoutApps(apps)) {
  const grid = page === 'apps';
  const items = grid ? gridItems : sections;
  if (!items.length) {
    text(ctx,'No apps installed',64,39,'secondary','center');
    return;
  }
  const pageNumber = grid ? Math.floor(items[selected][2]/launcherPageSize) : 0;
  const pageCount = grid ? Math.floor(items.at(-1)[2]/launcherPageSize)+1 : 1;
  if (pageCount>1) text(ctx,'Apps '+(pageNumber+1)+'/'+pageCount,2,7);
  items.forEach(([name,id,cell],i) => {
    if (grid && Math.floor(cell/launcherPageSize)!==pageNumber) return;
    const x = grid ? 21 + 42*(cell%launcherColumns) : 21 + 42*i;
    const y = grid ? 18 + 20*Math.floor((cell%launcherPageSize)/launcherColumns) : 26;
    ctx.save();
    rounded(ctx,x-12,y-(grid?9:10),25,grid?19:21,4,i===selected);
    if (i===selected) ctx.globalCompositeOperation='destination-out';
    const labIcon = id.startsWith('lab:') && importedRecord(id.slice(4))?.iconHex;
    if (labIcon) drawLabIcon(ctx,labIcon,x-5,y-5);
    else if (!icon(ctx,id,x,y)) {
      if(id.startsWith('lab:')) icon(ctx,'apps',x,y);
      else {
        let label=name;
        while(textWidth(label)>21) label=label.slice(0,-1);
        text(ctx,label,x,y+3,'secondary','center');
      }
    }
    ctx.restore();
    if (!grid) text(ctx,name,x,49,'secondary','center');
  });
  if (grid) {
    ctx.fillRect(4,49,120,1);
    text(ctx,items[selected][0],64,63,'primary','center');
  }
}

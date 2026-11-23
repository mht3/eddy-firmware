import {text,textWidth,button,submenu} from './lcd.js';
import {line,circle,box,inverted} from './utility-pixels.js';
import {askName} from './preview-name.js';
import {presetButtons,tvPresetRows} from './tv-presets.js';
import {layoutDemo} from './remote-preview.js';

const stock=['Power','Vol +','Vol -','Mute','Play/Pause','Channel +','Channel -','Input','Custom'];
function glyph(ctx,id,x,y) {
  const stroke=(a,b,c,d)=>line(ctx,x+a,y+b,x+c,y+d);
  switch(id) {
    case 0: circle(ctx,x,y+1,4); stroke(0,-5,0,0); break;
    case 1: case 2: stroke(-4,0,4,0); if(id===1) stroke(0,-4,0,4); break;
    case 3:
      ctx.fillRect(x-5,y-1,3,3); stroke(-2,-1,0,-3); stroke(0,-3,0,3);
      stroke(0,3,-2,1); stroke(2,-2,5,1); stroke(2,1,5,-2); break;
    case 4:
      stroke(-5,-3,-5,3); stroke(-5,-3,0,0); stroke(0,0,-5,3);
      stroke(2,-3,2,3); stroke(4,-3,4,3); break;
    case 5: case 6: {
      const dy=id===5?-2:2;
      stroke(-4,-dy,0,dy); stroke(0,dy,4,-dy); break;
    }
    case 7: box(ctx,x,y-4,5,9); stroke(-5,0,2,0); stroke(0,-2,2,0); stroke(2,0,0,2); break;
    default: box(ctx,x-4,y-4,9,9,2); ctx.fillRect(x,y,1,1);
  }
}

function fitted(ctx,label,x,y,width,font='secondary') {
  while(label.length && textWidth(label,font)>width) label=label.slice(0,-1);
  text(ctx,label,x,y,font);
}
function library(s) {
  const rows=[], page=s.libraryPage || 0;
  const entries=layoutDemo.entries;
  if(s.step==='library') rows.push(['New remote'],['TV presets']);
  if(page) rows.push(['Previous page']);
  if(entries.length && s.step==='library') rows.push(['Delete a remote']);
  entries.slice(page*8,page*8+8).forEach(([name,kind])=>{
    rows.push([name+' ('+layoutDemo.source(name,kind)+')',name,kind]);
  });
  if(entries.length>(page+1)*8) rows.push(['Next page']);
  if(s.step==='deleteList' && !entries.length) rows.push(['Back to Remotes']);
  return rows;
}
function choices(s) {
  if(s.step==='library' || s.step==='deleteList') return library(s).map(([label])=>label);
  if(s.step==='presets') return tvPresetRows.map(([name])=>name);
  if(s.step==='stock') return stock;
  if(s.step==='options') {
    const actions=layoutDemo.get(s.name,s.kind).cells[s.slot] ? ['Rename button','Learn again','Move button','Remove button'] : [];
    return [...(layoutDemo.pinned(s.name,s.kind) ? [...actions,'Remove from Apps'] : ['Add to Apps',...actions]),'Delete remote'];
  }
  return [];
}
function go(s,step) { s.step=step; s.row=0; s.message=''; }
export function openBuilder(name,kind='layout') {
  return {page:'builder',step:name?'grid':'library',name,kind,slot:0,row:0,shortcut:Boolean(name)};
}
function cellCount(s,layout) {
  return layout.cells.length + (s.step!=='move' && (s.kind==='remote' || layout.cells.length<24) ? 1 : 0);
}
function update(s,cells) {
  if (!layoutDemo.update(s.name,cells,s.kind)) { s.message='Could not save'; return false; }
  go(s,'grid');
  s.slot=Math.min(s.slot,cellCount(s,layoutDemo.get(s.name,s.kind))-1);
  return true;
}
export function builderStatus(s) {
  const rows=choices(s);
  if(s.message) return s.message==='Sent'?'Demo sent: '+layoutDemo.get(s.name,s.kind).cells[s.slot].name:s.message;
  if(rows.length) return rows[s.row];
  const button=layoutDemo.get(s.name,s.kind)?.cells[s.slot];
  if(s.step==='learn') return 'Point remote at Flipper. Use Present sample to supply an IR button press.';
  if(s.step==='delete') return 'Delete '+s.name+' ('+layoutDemo.source(s.name,s.kind)+')? OK deletes. Left cancels.';
  if(s.step==='remove') return 'Remove button? OK removes. Left cancels.';
  if(s.step==='move') return 'Choose a position, then press OK.';
  return (button?.name || 'Add button')+'. '+(button?'OK sends.':'OK adds a button.')+' Hold OK for options.';
}
export function drawBuilder(ctx,s) {
  const layout=layoutDemo.get(s.name,s.kind);
  const cell=layout?.cells[s.slot];
  const headers={library:'Remotes',deleteList:'Delete which remote?',presets:'Add TV preset',stock:'Choose a button',options:cell?.name || 'Remote options'};
  if(headers[s.step]) {
    submenu(ctx,headers[s.step],choices(s),s.row);
    return;
  }
  if(s.step==='learn' || s.step==='remove' || s.step==='delete') {
    const learn=s.step==='learn', remove=s.step==='remove';
    text(ctx,learn?'Learn button':remove?'Remove button?':'Delete remote?',64,20,'primary','center');
    if(remove) text(ctx,cell.name,64,35,'secondary','center');
    else {
      text(ctx,learn?'Point the original remote':s.name,64,29,'secondary','center');
      text(ctx,learn?'at Flipper and press once.':layoutDemo.source(s.name,s.kind),64,39,'secondary','center');
    }
    if(!learn) {button(ctx,'left','Cancel');button(ctx,'center',remove?'Remove':'Delete');}
    return;
  }
  if(!layout) return;
  const total=cellCount(s,layout), first=Math.floor(s.slot/6)*6;
  fitted(ctx,s.name,2,9,total>6?64:92,'primary');
  if(total>6) text(ctx,(first/6+1)+'/'+Math.ceil(total/6),94,9,'secondary','right');
  const count=Math.min(6,total-first), columns=Math.min(3,count);
  const width=Math.floor(126/columns)-2;
  for(let i=0;i<count;i++) {
    const entry=layout.cells[first+i];
    const x=2+(width+2)*(i%columns), y=12+17*Math.floor(i/columns);
    const selected=first+i===s.slot;
    box(ctx,x,y,width,16,3,selected);
    inverted(ctx,selected,()=>{
      if(entry) {
        glyph(ctx,entry.icon,x+8,y+8);
        fitted(ctx,entry.name,x+15,y+11,width-17);
      } else text(ctx,width>50?'+ Add button':'+',x+Math.floor(width/2),y+11,'secondary','center');
    });
  }
  text(ctx,s.message || (s.step==='move'?'Choose destination':cell?.name || 'Add button'),64,53,'secondary','center');
  text(ctx,s.step==='move'?'OK: place    Back: cancel':cell?'OK: send    Hold OK: menu':'OK: add    Hold OK: menu',64,63,'secondary','center');
}
export function builderKey(s,key,render) {
  const rows=choices(s);
  const layout=layoutDemo.get(s.name,s.kind);
  const cell=layout?.cells[s.slot];
  if(key==='back' || (key==='left' && ['delete','remove'].includes(s.step))) {
    if(s.step==='library' || (s.step==='grid' && s.shortcut)) return false;
    if(s.step==='move') s.slot=s.from;
    if(s.step==='learn') { go(s,'grid'); return true; }
    if(s.step==='delete' && s.deleteFromList) {
      go(s,'deleteList');
      s.row=Math.max(0,library(s).findIndex(([,name,kind])=>s.name===name && s.kind===kind));
    } else go(s,['grid','presets','deleteList'].includes(s.step)?'library':['remove','delete'].includes(s.step)?'options':'grid');
    return true;
  }
  s.message='';
  if(rows.length && (key==='up' || key==='down')) {
    s.row=(s.row+rows.length+(key==='up'?-1:1))%rows.length;
  } else if(['grid','move'].includes(s.step) && ['up','down','left','right'].includes(key)) {
    const count=cellCount(s,layout);
    if(key==='left' || key==='right') s.slot=(s.slot+count+(key==='left'?-1:1))%count;
    else {
      const rows=Math.ceil(count/3), row=(Math.floor(s.slot/3)+rows+(key==='up'?-1:1))%rows;
      s.slot=Math.min(count-1,row*3+s.slot%3);
    }
  } else if(key==='hold' && s.step==='grid') go(s,'options');
  else if(s.step==='remove' && key==='ok') {
    const cells=layout.cells.slice(); cells.splice(s.slot,1);
    update(s,cells);
  } else if((key==='ok' && s.step!=='learn') || (key==='sample' && s.step==='learn')) {
    const choice=rows[s.row];
    if(s.step==='library' || s.step==='deleteList') {
      const [,name,kind]=library(s)[s.row];
      if(name) {
        s.name=name; s.kind=kind; s.slot=0;
        s.deleteFromList=s.step==='deleteList';
        go(s,s.deleteFromList?'delete':'grid');
      } else if(choice==='Next page' || choice==='Previous page') {
        s.libraryPage=(s.libraryPage || 0)+(choice==='Next page'?1:-1); s.row=0;
      } else if(choice==='TV presets') go(s,'presets');
      else if(choice==='Delete a remote') {s.libraryPage=0;go(s,'deleteList');}
      else if(choice==='Back to Remotes') {s.libraryPage=0;go(s,'library');}
      else askName('Remote name','',22,name=>{
        const error=layoutDemo.create(name);
        if(!error) { s.name=name; s.kind='layout'; s.slot=0; go(s,'grid'); render(); }
        return error;
      });
    } else if(s.step==='presets') {
      const name=layoutDemo.addPreset(choice,presetButtons(s.row));
      if(name) { s.name=name; s.kind='remote'; s.slot=0; go(s,'grid'); }
      else s.message='Could not save preset';
    } else if(s.step==='delete') {
      if(!layoutDemo.remove(s.name,s.kind)) s.message='Could not delete';
      else if(s.shortcut) { s.exit=true; return false; }
      else { s.name=undefined; s.libraryPage=0; go(s,'library'); }
    } else if(s.step==='grid') {
      if(cell) {
        s.message='Sent';
        clearTimeout(s.feedbackTimer);
        s.feedbackTimer=setTimeout(()=>{s.message='';render();},950);
      }
      else go(s,'stock');
    } else if(s.step==='stock') {
      s.icon=s.row; go(s,'learn');
    } else if(s.step==='learn' || choice==='Rename button') {
      const icon=s.step==='learn'?s.icon:cell.icon;
      askName(s.step==='learn'?'Signal read. Name & save':'Rename button',cell?.name || stock[icon],16,name=>{
        const cells=layout.cells.slice(); cells[s.slot]={icon,name};
        if(!update(s,cells)) return s.message;
        render(); return '';
      });
    } else if(s.step==='move') {
      const cells=layout.cells.slice();
      if(s.kind==='remote') cells.splice(s.slot,0,cells.splice(s.from,1)[0]);
      else [cells[s.from],cells[s.slot]]=[cells[s.slot],cells[s.from]];
      update(s,cells);
    } else if(choice==='Learn again') { s.icon=cell.icon; go(s,'learn'); }
    else if(choice==='Move button') { s.from=s.slot; go(s,'move'); }
    else if(choice==='Delete remote') { s.deleteFromList=false; go(s,'delete'); }
    else if(choice==='Remove button') go(s,'remove');
    else if(choice==='Add to Apps' || choice==='Remove from Apps') {
      const error=layoutDemo.setPinned(s.name,choice==='Add to Apps',s.kind);
      go(s,'grid');
      s.message=error ? (error==='full'?'Apps shortcuts full':'Could not save shortcut') :
        (choice==='Add to Apps'?'Added to Apps':'Removed from Apps');
    }
  }
  return true;
}

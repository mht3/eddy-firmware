import {askName} from './preview-name.js';
import {presetButtons,tvPresetRows} from './tv-presets.js';
import {layoutDemo} from './remote-preview.js';

const stock=['Power','Vol +','Vol -','Mute','Play/Pause','Channel +','Channel -','Input','Custom'];
const marks=['⏻','+','−','M','▶Ⅱ','▲','▼','⇥','•'];
function choices(s) {
  if(s.step==='library') return ['New remote','TV presets',...layoutDemo.entries.map(([name,kind])=>name+' ('+layoutDemo.source(name,kind)+')')];
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
  if(s.message) return s.message;
  if(rows.length) return rows[s.row];
  const button=layoutDemo.get(s.name,s.kind)?.cells[s.slot];
  if(s.step==='learn') return 'Point remote at Flipper. OK for a sample IR signal.';
  if(s.step==='delete') return 'Delete '+s.name+' ('+layoutDemo.source(s.name,s.kind)+')? OK deletes. Left cancels.';
  if(s.step==='remove') return 'Remove button? OK removes. Left cancels.';
  if(s.step==='move') return 'Choose a position, then press OK.';
  return (button?.name || 'Add button')+'. '+(button?'OK sends.':'OK adds a button.')+' Hold OK for options.';
}
export function drawBuilder(ctx,s) {
  const grid=['move','grid'].includes(s.step);
  const layout=grid?layoutDemo.get(s.name,s.kind):null;
  const total=grid?cellCount(s,layout):0;
  const header={library:'Remotes',presets:'Add TV preset',delete:'Delete remote?',stock:'Choose a button',options:'Options',learn:'Learn button',
    move:'Move button',remove:'Remove button?'};
  ctx.font='bold 9px sans-serif';
  ctx.fillText(header[s.step] || s.name,2,1,total>6?64:88);
  ctx.fillRect(1,11,126,1);
  const rows=choices(s);
  if(rows.length) {
    const start=Math.max(0,s.row-2);
    rows.slice(start,start+3).forEach((label,i)=>{
      const y=15+i*16,selected=start+i===s.row;
      if(selected) ctx.fillRect(1,y,126,14);
      ctx.fillStyle=selected?'#ffbe70':'#432a14';
      ctx.fillText(label,5,y+2,117); ctx.fillStyle='#432a14';
    });
    return;
  }
  if(grid) {
    const first=Math.floor(s.slot/6)*6;
    if(total>6) {
      ctx.textAlign='right'; ctx.font='8px sans-serif';
      ctx.fillText((first/6+1)+'/'+Math.ceil(total/6),94,1);
      ctx.textAlign='start';
    }
    for(let i=0;i<Math.min(6,total-first);i++) {
      const cell=layout.cells[first+i];
      const columns=Math.min(3,total-first), width=Math.floor(126/columns)-2;
      const x=2+(width+2)*(i%columns), y=12+17*Math.floor(i/columns);
      const selected=first+i===s.slot;
      ctx.beginPath(); ctx.roundRect(x+.5,y+.5,width-1,15,3);
      if(selected) ctx.fill(); else ctx.stroke();
      ctx.fillStyle=selected?'#ffbe70':'#432a14';
      ctx.font='bold 10px sans-serif'; ctx.textAlign='center';
      ctx.fillText(cell?marks[cell.icon]:(width>50?'+ Add button':'+'),x+(cell?8:width/2),y+2,cell?12:width-4);
      if(cell) {
        ctx.font='8px sans-serif'; ctx.textAlign='start';
        let short=cell.name;
        while(short && ctx.measureText(short).width>width-17) short=short.slice(0,-1);
        ctx.fillText(short,x+15,y+3);
      }
      ctx.fillStyle='#432a14'; ctx.textAlign='start';
    }
  }
  ctx.font='8px sans-serif';
  const copy=s.step==='learn'?['Point original remote','OK for demo signal']:
    s.step==='remove'?['OK to remove','Left to cancel']:s.step==='delete'?[s.name+' ('+layoutDemo.source(s.name,s.kind)+')','Left cancel · OK delete']:[];
  copy.forEach((line,i)=>ctx.fillText(line,4,21+i*15,120));
  if(!copy.length) {
    const cell=layoutDemo.get(s.name,s.kind).cells[s.slot];
    ctx.textAlign='center';
    ctx.fillText(s.message || (s.step==='move'?'Choose destination':cell?.name || 'Add button'),64,45,122);
    ctx.fillText(s.step==='move'?'OK place · Back cancel':cell?'OK send · Hold OK menu':'OK add · Hold OK menu',64,55,124);
    ctx.textAlign='start';
  }
}
export function builderKey(s,key,render) {
  const rows=choices(s);
  const layout=layoutDemo.get(s.name,s.kind);
  const cell=layout?.cells[s.slot];
  if(key==='back' || (key==='left' && ['delete','remove'].includes(s.step))) {
    if(s.step==='library' || (s.step==='grid' && s.shortcut)) return false;
    if(s.step==='move') s.slot=s.from;
    go(s,['grid','presets'].includes(s.step)?'library':['remove','delete'].includes(s.step)?'options':'grid');
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
  } else if(key==='ok') {
    const choice=rows[s.row];
    if(s.step==='library') {
      if(s.row===1) go(s,'presets');
      else if(s.row>1) {
        [s.name,s.kind]=layoutDemo.entries[s.row-2];
        s.slot=0; go(s,'grid');
      }
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
      else { s.name=undefined; go(s,'library'); }
    } else if(s.step==='grid') {
      if(cell) s.message=cell.name+' · Demo sent';
      else go(s,'stock');
    } else if(s.step==='stock') {
      s.icon=s.row; go(s,'learn');
    } else if(s.step==='learn' || choice==='Rename button') {
      const icon=s.step==='learn'?s.icon:cell.icon;
      askName('Button name',cell?.name || stock[icon],16,name=>{
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
    else if(choice==='Delete remote') go(s,'delete');
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

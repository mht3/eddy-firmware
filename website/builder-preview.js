import {askName} from './preview-name.js';
import {layoutDemo} from './remote-preview.js';

const stock=['Power','Vol +','Vol -','Mute','Play/Pause','Channel +','Channel -','Input','Custom'];
const marks=['⏻','+','−','M','▶Ⅱ','▲','▼','⇥','•'];
function choices(s) {
  if(s.step==='library') return ['New remote',...layoutDemo.names];
  if(s.step==='stock') return stock;
  if(s.step==='options') {
    const actions=layoutDemo.get(s.name).cells[s.slot] ? ['Rename button','Learn again','Move button','Remove button'] : [];
    return [...actions, layoutDemo.pinned(s.name)?'Remove from Apps':'Add to Apps'];
  }
  return [];
}
function go(s,step) { s.step=step; s.row=0; s.message=''; }
export function openBuilder(name) {
  return {page:'builder',step:name?'grid':'library',name,slot:name?Math.max(0,layoutDemo.get(name).cells.findIndex(Boolean)):0,row:0,shortcut:Boolean(name)};
}
function update(s,cells) {
  if (!layoutDemo.update(s.name,cells)) { s.message='Could not save'; return false; }
  go(s,'grid');
  return true;
}
export function builderStatus(s) {
  const rows=choices(s);
  if(s.message) return s.message;
  if(rows.length) return rows[s.row];
  const button=layoutDemo.get(s.name)?.cells[s.slot];
  if(s.step==='learn') return 'Point remote at Flipper. OK for a sample IR signal.';
  if(s.step==='remove') return 'Remove button? OK removes. Back cancels.';
  if(s.step==='move') return 'Choose a position, then press OK.';
  return (button?.name || 'Empty slot')+'. '+(button?'OK sends.':'OK adds a button.')+' Hold OK for options.';
}
export function drawBuilder(ctx,s) {
  const header={library:'Remote Builder',stock:'Choose a button',options:'Options',learn:'Learn button',
    move:'Move button',remove:'Remove button?'};
  ctx.font='bold 9px sans-serif';
  ctx.fillText(header[s.step] || s.name,2,1,88);
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
  if(['move','grid'].includes(s.step)) {
    const cells=layoutDemo.get(s.name).cells;
    cells.forEach((cell,i)=>{
      const x=2+42*(i%3), y=12+17*Math.floor(i/3);
      const selected=i===s.slot;
      ctx.beginPath(); ctx.roundRect(x+.5,y+.5,39,15,3);
      if(selected) ctx.fill(); else ctx.stroke();
      ctx.fillStyle=selected?'#ffbe70':'#432a14';
      ctx.font='bold 10px sans-serif'; ctx.textAlign='center';
      ctx.fillText(cell?marks[cell.icon]:'+',x+(cell?8:20),y+2,12);
      if(cell) {
        ctx.font='8px sans-serif'; ctx.textAlign='start';
        let short=cell.name;
        while(short && ctx.measureText(short).width>23) short=short.slice(0,-1);
        ctx.fillText(short,x+15,y+3);
      }
      ctx.fillStyle='#432a14'; ctx.textAlign='start';
    });
  }
  ctx.font='8px sans-serif';
  const copy=s.step==='learn'?['Point original remote','OK for demo signal']:
    s.step==='remove'?['OK to remove','Back to cancel']:[];
  copy.forEach((line,i)=>ctx.fillText(line,4,21+i*15));
  if(!copy.length) {
    const cell=layoutDemo.get(s.name).cells[s.slot];
    ctx.textAlign='center';
    ctx.fillText(s.message || (s.step==='move'?'Choose destination':cell?.name || 'Empty spot'),64,45,122);
    ctx.fillText(s.step==='move'?'OK place · Back cancel':cell?'OK send · Hold OK edit':'OK add · Hold OK options',64,55,124);
    ctx.textAlign='start';
  }
}
export function builderKey(s,key,render) {
  const rows=choices(s);
  const layout=layoutDemo.get(s.name);
  const cell=layout?.cells[s.slot];
  if(key==='back') {
    if(s.step==='library' || (s.step==='grid' && s.shortcut)) return false;
    if(s.step==='move') s.slot=s.from;
    go(s,s.step==='grid'?'library':s.step==='remove'?'options':'grid');
    return true;
  }
  s.message='';
  if(rows.length && (key==='up' || key==='down')) {
    s.row=(s.row+rows.length+(key==='up'?-1:1))%rows.length;
  } else if(['grid','move'].includes(s.step) && ['up','down','left','right'].includes(key)) {
    if(key==='left' || key==='right') s.slot=3*Math.floor(s.slot/3)+(s.slot%3+(key==='left'?2:1))%3;
    else s.slot=(s.slot+3)%6;
  } else if(key==='hold' && s.step==='grid') go(s,'options');
  else if(s.step==='remove' && key==='ok') {
    const cells=layout.cells.slice(); cells[s.slot]=null;
    update(s,cells);
  } else if(key==='ok') {
    const choice=rows[s.row];
    if(s.step==='library') {
      if(s.row) { s.name=choice; s.slot=Math.max(0,layoutDemo.get(choice).cells.findIndex(Boolean)); go(s,'grid'); }
      else askName('Remote name','',22,name=>{
        const error=layoutDemo.create(name);
        if(!error) { s.name=name; s.slot=0; go(s,'grid'); render(); }
        return error;
      });
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
      [cells[s.from],cells[s.slot]]=[cells[s.slot],cells[s.from]];
      update(s,cells);
    } else if(choice==='Learn again') { s.icon=cell.icon; go(s,'learn'); }
    else if(choice==='Move button') { s.from=s.slot; go(s,'move'); }
    else if(choice==='Remove button') go(s,'remove');
    else if(choice==='Add to Apps' || choice==='Remove from Apps') {
      const error=layoutDemo.setPinned(s.name,choice==='Add to Apps');
      go(s,'grid');
      s.message=error ? (error==='full'?'Apps shortcuts full':'Could not save shortcut') :
        (choice==='Add to Apps'?'Added to Apps':'Removed from Apps');
    }
  }
  return true;
}

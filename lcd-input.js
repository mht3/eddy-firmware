// TextInput and NumberInput use the same D-pad layouts as the firmware GUI modules.
import {text, textWidth} from './lcd.js';
import {bitmap, frame, boxText} from './lcd-widgets.js';

const keys=(chars,xs,y)=>Array.from(chars,(key,i)=>({key,x:xs[i],y}));
const alpha=[
  keys('qwertyuiop0123',[2,11,20,29,38,47,56,65,74,83,93,103,112,121],37),
  keys('asdfghjkl\b456',[2,11,20,29,38,47,56,65,74,83,103,112,121],49),
  keys('\tzxcvbnm_\r789',[1,14,22,30,38,46,54,62,70,78,103,112,121],61),
];
const symbols=[
  keys('!@#$%^&()0123',[3,13,23,33,43,53,63,72,82,93,103,112,121],37),
  keys('~+-=[]{}\b456',[3,13,23,33,43,53,63,73,83,103,112,121],49),
  keys("\t.,;\x60'\r789",[1,16,30,42,54,66,78,103,112,121],61),
];
const numbers=[keys('01234\b',[7,18,29,40,51,107],43),keys('56789\r',[7,18,29,40,51,102],57)];
const special={'\b':'KeyBackspace','\t':'KeyKeyboard','\r':'KeySave'};
export let editor;
const notify=()=>document.dispatchEvent(new Event('eddy-editor-change'));
export function openEditor(label,value,limit,submit,range) {
  editor={label,value,limit,submit,range,replace:Boolean(value),row:value ? 2 : 0,
    column:value ? 9 : 0,keyboard:range ? numbers : alpha,cursor:value.length};
  notify();
}
function inRange(e) {return e.value!=='' && +e.value>=e.range[0] && +e.value<=e.range[1];}
function selectedBox(ctx,x,y,w,h) {
  ctx.fillRect(x+1,y,w-2,h);
  ctx.fillRect(x,y+1,w,h-2);
}
export function drawEditor(ctx,e=editor) {
  text(ctx,e.label,2,e.range?9:8);
  frame(ctx,e.range?4:1,e.range?14:12,e.range?120:126,15,true);
  let shown=e.value;
  if(!e.range && !e.replace) shown=shown.slice(0,e.cursor)+'|'+shown.slice(e.cursor);
  while(shown.length && textWidth(shown)>117) shown=shown.slice(1);
  ctx.save();
  if(e.replace) {
    selectedBox(ctx,3,14,textWidth(shown)+2,10);
    ctx.globalCompositeOperation='destination-out';
  }
  text(ctx,shown,e.range?8:4,e.range?25:22);
  ctx.restore();
  for (const [r,row] of e.keyboard.entries()) for(const [c,{key,x,y}] of row.entries()) {
    const active=r===e.row && c===e.column && !e.cursorMode;
    const icon=special[key];
    if(icon) {
      const blocked=e.range && key==='\r' && !inRange(e);
      bitmap(ctx,icon+(blocked?'Blocked':'')+(active?'Selected':''),x,y-9);
      continue;
    }
    ctx.save();
    if(active) {
      selectedBox(ctx,x-(e.range?3:2),y-(e.range?10:9),e.range?11:9,e.range?13:11);
      ctx.globalCompositeOperation='destination-out';
    }
    const upper=e.keyboard===alpha && (e.replace || !e.value);
    text(ctx,upper?key.toUpperCase():key,x,y-(!upper && /[a-z_]/.test(key)?1:0),'keyboard');
    ctx.restore();
  }
  if(e.error) {
    ctx.clearRect(8,10,112,48); frame(ctx,8,10,112,48,true);
    bitmap(ctx,'WarningDolphin',10,14); boxText(ctx,e.error,60,15,54,39);
  }
}

export function editorKey(key) {
  const e=editor;
  if(!e) return false;
  if(e.error) {e.error=''; return true;}
  if(key==='back') {editor=undefined; return true;}
  const row=e.keyboard[e.row], item=row[e.column];
  if(key==='up'||key==='down') {
    if(!e.range && key==='up' && e.row===0) {e.cursorMode=true;e.replace=false;}
    else if(e.cursorMode) e.cursorMode=false;
    else {
      e.row=Math.min(e.keyboard.length-1,Math.max(0,e.row+(key==='up'?-1:1)));
      e.column=e.keyboard[e.row].reduce((nearest,k,i,all)=>Math.abs(k.x-item.x)<Math.abs(all[nearest].x-item.x)?i:nearest,0);
    }
  } else if(key==='left'||key==='right') {
    const dir=key==='left'?-1:1;
    if(e.cursorMode) e.cursor=Math.max(0,Math.min(e.value.length,e.cursor+dir));
    else e.column=(e.column+row.length+dir)%row.length;
  } else if(key==='ok'||key==='holdOk') {
    const k=item.key;
    if(e.cursorMode) e.replace=!e.replace;
    else if(k==='\r') {
      if(e.range && !inRange(e)) return true;
      editor=undefined;
      const error=e.submit(e.value);
      if(error) {e.error=error;editor=e;}
    } else if(k==='\t') {
      e.keyboard=e.keyboard===alpha ? symbols : alpha; e.row=2; e.column=0;
    } else if(k==='\b') {
      if(e.replace) {e.value='';e.cursor=0;}
      else if(e.cursor) {e.value=e.value.slice(0,e.cursor-1)+e.value.slice(e.cursor);e.cursor--;}
      e.replace=false;
    } else if(e.replace || e.value.length<e.limit) {
      if(e.replace) {e.value='';e.cursor=0;e.replace=false;}
      const char=e.keyboard===alpha && ((key==='holdOk')!==(!e.value)) ? k.toUpperCase() : k;
      e.value=e.value.slice(0,e.cursor)+char+e.value.slice(e.cursor);e.cursor++;
    }
  }
  return true;
}

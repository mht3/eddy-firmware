import {text} from './lcd.js';
import {box,circle,line,inverted} from './utility-pixels.js';
import {bitmap} from './lcd-widgets.js';
const profiles = [
  ['Samsung TV','Samsung TV'], ['LG TV','LG TV'],
  ['TCL (RC3000E02)','TCL TV'], ['TCL Roku (32S327)','TCL Roku TV'],
];
export const tvPresetRows = profiles.map(([name])=>[name,'tvPad']);
const standard = ['Power','Mute','Vol -','Vol +','CH -','CH +'];
const roku = ['Power','Home','Vol -','Vol +','Exit','D-pad'];

const arrows=[['up','Up',64,18],['left','Left',35,32],['ok','OK',64,32],['right','Right',93,32],['down','Down',64,46]];

export function presetButtons(index) {
  return index===3 ? [...roku.slice(0,5),...arrows.map(([,label])=>label)] : standard;
}

export function tvPadStatus(state) {
  if(state.navigation) return 'TCL Roku D-pad. '+(state.sentUntil>performance.now()?'Demo sent: '+state.lastKey:'Arrows and OK send. Back returns to remote.');
  if(state.profile===3 && state.row===5) return 'TCL Roku TV. D-pad. OK to open.';
  const label=(state.profile===3?roku:standard)[state.row];
  return profiles[state.profile][1]+'. '+(state.sentUntil>performance.now()?'Demo sent: '+label:label+'. OK to send.');
}

export function tvPadKey(state,key) {
  if(state.navigation) {
    if(key==='back') { state.navigation=false; state.sentUntil=0; return; }
    const arrow=arrows.find(([code])=>code===key);
    if(arrow) { state.lastKey=arrow[1]; state.sentUntil=performance.now()+800; }
    return;
  }
  if(key==='ok' && state.profile===3 && state.row===5) { state.navigation=true; state.sentUntil=0; return; }
  if(key==='ok') { state.sentUntil=performance.now()+800; return; }
  state.sentUntil=0;
  if(key==='up' || key==='down') state.row=(state.row+(key==='up'?4:2))%6;
  if(key==='left' || key==='right') state.row^=1;
}

export function drawTvPad(ctx,state) {
  const isRoku=state.profile===3;
  const labels=isRoku?roku:standard;
  text(ctx,profiles[state.profile][1],3,10,'primary');
  const remaining=(state.sentUntil||0)-performance.now();
  if(state.navigation) {
    arrows.forEach(([,label,x,y])=>{
      const lit=remaining>0 && state.lastKey===label;
      box(ctx,x-14,y-6,28,13,3,lit);
      inverted(ctx,lit,()=>text(ctx,label,x,y+4,'secondary','center'));
    });
    text(ctx,'Arrows / OK send  Back exits',64,63,'secondary','center');
  } else {
    const glyphs=[null,['Muted',4,4],['Voldwn',3,3],['Volup',4,3],isRoku?['back',5,5]:['ButtonDown',3,2],isRoku?['ButtonCenter',3,3]:['ButtonUp',3,2]];
    labels.forEach((label,i)=>{
      const x=3+i%2*62,y=13+Math.floor(i/2)*14;
      box(ctx,x,y,59,13,3,i===state.row);
      inverted(ctx,i===state.row,()=>{
        if(i===0) {
          circle(ctx,x+10,y+7,3);
          line(ctx,x+10,y+2,x+10,y+6);
        } else if(i===1 && isRoku) {
          line(ctx,x+6,y+6,x+10,y+2);
          line(ctx,x+10,y+2,x+14,y+6);
          box(ctx,x+7,y+6,7,5);
        } else {
          const [icon,dx,dy]=glyphs[i];
          bitmap(ctx,icon,x+10-dx,y+6-dy);
        }
        text(ctx,label,x+35,y+10,'secondary','center');
      });
    });
    const hint=isRoku && state.row===5?'OK: open D-pad':'Choose a key   OK: send';
    text(ctx,remaining>0?'Sent: '+labels[state.row]:hint,64,63,'secondary','center');
  }
  return Math.max(0,Math.ceil(remaining));
}

export function tvNavigationHit(x,y) {
  return arrows.find(([,label,cx,cy])=>Math.abs(x-cx)<14 && Math.abs(y-cy)<6.5)?.[0];
}

export function tvPadHit(x,y) {
  for(let i=0;i<6;i++) {
    const left=3+(i%2)*62, top=13+Math.floor(i/2)*14;
    if(x>=left && x<left+59 && y>=top && y<top+13) return i;
  }
  return -1;
}

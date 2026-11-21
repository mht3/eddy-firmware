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
  const marks=['⏻',isRoku?'⌂':'×','−','+',isRoku?'↩':'▾',isRoku?'●':'▴'];
  ctx.save();
  ctx.font='bold 9px sans-serif';
  ctx.fillText(profiles[state.profile][1],3,1);
  const remaining=(state.sentUntil||0)-performance.now();
  if(state.navigation) {
    ctx.font='8px sans-serif'; ctx.textAlign='center';
    arrows.forEach(([,label,x,y])=>{
      ctx.beginPath(); ctx.roundRect(x-13.5,y-5.5,27,12,3);
      const lit=remaining>0 && state.lastKey===label;
      if(lit) ctx.fill(); else ctx.stroke();
      ctx.fillStyle=lit?'#ffbe70':'#432a14'; ctx.fillText(label,x,y-4); ctx.fillStyle='#432a14';
    });
    ctx.fillText('Arrows / OK send  Back exits',64,55); ctx.restore();
    return Math.max(0,Math.ceil(remaining));
  }
  labels.forEach((label,i)=>{
    const x=3+i%2*62,y=13+Math.floor(i/2)*14;
    ctx.beginPath(); ctx.roundRect(x+.5,y+.5,58,12,3);
    if(i===state.row) ctx.fill(); else ctx.stroke();
    ctx.fillStyle=i===state.row?'#ffbe70':'#432a14';
    ctx.textAlign='center'; ctx.font='bold 9px sans-serif'; ctx.fillText(marks[i],x+10,y+1);
    ctx.font='8px sans-serif'; ctx.fillText(label,x+35,y+2);
    ctx.fillStyle='#432a14';
  });
  const hint=isRoku && state.row===5?'OK: open D-pad':'Choose a key   OK: send';
  ctx.fillText(remaining>0?'Demo sent: '+labels[state.row]:hint,64,55);
  ctx.restore();
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

// Only the physical Flipper pulses its motor. The preview shows the same beat on the LCD.
const preference = 'eddy-metronome-bpm';
let bpm = 96;
try {
  const stored = Number(localStorage.getItem(preference));
  if (Number.isInteger(stored) && stored>=40 && stored<=220) bpm=stored;
} catch {}

export function metronomeInput(state, key, now) {
  if (key==='ok') {
    state.taps=[];
    state.started = state.started === undefined ? now : undefined;
    return;
  }
  let next = bpm;
  if (key==='up') {
    const taps = state.taps ??= [];
    const gap = now-taps[taps.length-1];
    if (gap<200) return;
    if (gap>2000) taps.length=0;
    taps.push(now);
    if (taps.length>5) taps.shift();
    if (taps.length>1) next=Math.round(60000*(taps.length-1)/(now-taps[0]));
  } else if (key==='left' || key==='right') {
    state.taps=[];
    next+=key==='right'?1:-1;
  }
  next=Math.max(40,Math.min(220,next));
  if (next===bpm) return;
  if (state.started!==undefined) {
    const beat=Math.floor((now-state.started)*bpm/60000)%4;
    state.started=now-beat*60000/next;
  }
  bpm=next;
  try { localStorage.setItem(preference,String(bpm)); } catch {}
}

export function metronomeStatus(state) {
  return bpm+' BPM. '+(state.started===undefined?'Stopped.':'Playing.')+
    ' Up to tap tempo, Left or Right to adjust, OK to start or stop.';
}

export function drawMetronome(ctx, state, now) {
  const playing=state.started!==undefined;
  const period=60000/bpm;
  const elapsed=playing?now-state.started:0;
  const step=Math.floor(elapsed/period);
  ctx.save();
  ctx.font='bold 9px monospace';
  ctx.fillText('Metronome',2,0);
  ctx.textAlign='center';
  ctx.font='bold 19px monospace';
  ctx.fillText(String(bpm),59,12);
  ctx.font='8px sans-serif';
  ctx.fillText('BPM',91,24);
  function arrow(x, dx) {
    ctx.beginPath(); ctx.moveTo(x+dx,21); ctx.lineTo(x,25); ctx.lineTo(x+dx,29); ctx.stroke();
  }
  if (bpm>40) arrow(10,4);
  if (bpm<220) arrow(117,-4);
  for (let i=0;i<4;i++) {
    ctx.beginPath();
    ctx.roundRect(30.5+18*i,39.5,13,6,2);
    if (playing && i===step%4) ctx.fill(); else ctx.stroke();
  }
  ctx.textAlign='left';
  ctx.fillText(state.taps?.length===1?'Tap Up again':'Up: tap tempo',3,53);
  ctx.textAlign='right';
  ctx.fillText(playing?'OK: stop':'OK: start',125,53);
  ctx.restore();
  return playing ? Math.max(1,Math.ceil((step+1)*period-elapsed)) : 0;
}

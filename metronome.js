const outputs = ['Sound + buzz','Sound','Vibration','Silent'];
const outputPreference = 'eddy-metronome-output';
let output = 0;
let audio;
const preference = 'eddy-metronome-bpm';
let bpm = 96;
try {
  const storedOutput=Number(localStorage.getItem(outputPreference));
  if (Number.isInteger(storedOutput) && storedOutput>=0 && storedOutput<outputs.length) output=storedOutput;
  const stored = Number(localStorage.getItem(preference));
  if (Number.isInteger(stored) && stored>=40 && stored<=220) bpm=stored;
} catch {}

function unlockAudio() {
  if (output>1 || !window.AudioContext) return;
  try {
    audio ??= new AudioContext();
    if (audio.state==='suspended') audio.resume().catch(()=>{});
  } catch {}
}

function playBeat() {
  if (output===0 || output===2) navigator.vibrate?.(50);
  if (output>1 || !audio || audio.state==='closed') return;
  const start=audio.currentTime, tone=audio.createOscillator(), gain=audio.createGain();
  tone.frequency.value=1046.5;
  gain.gain.setValueAtTime(0,start);
  gain.gain.linearRampToValueAtTime(.16,start+.003);
  gain.gain.exponentialRampToValueAtTime(.001,start+.05);
  tone.connect(gain); gain.connect(audio.destination);
  tone.start(start); tone.stop(start+.05);
}

export function metronomeInput(state, key, now) {
  if (key==='down') {
    output=(output+1)%outputs.length;
    try { localStorage.setItem(outputPreference,String(output)); } catch {}
    unlockAudio();
    return;
  }
  if (key==='ok') {
    state.taps=[];
    state.lastBeat=undefined;
    unlockAudio();
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
    ' '+outputs[output]+'. Down to change sound and vibration. Up to tap tempo, Left or Right to adjust, OK to start or stop.';
}

export function drawMetronome(ctx, state, now) {
  const playing=state.started!==undefined;
  const period=60000/bpm;
  const elapsed=playing?now-state.started:0;
  const step=Math.floor(elapsed/period);
  if (playing && state.lastBeat!==step) {
    state.lastBeat=step;
    playBeat();
  }
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
    ctx.roundRect(30.5+18*i,34.5,13,5,2);
    if (playing && i===step%4) ctx.fill(); else ctx.stroke();
  }
  ctx.fillText('Down: '+outputs[output],64,42);
  ctx.textAlign='left';
  ctx.fillText(state.taps?.length===1?'Tap Up again':'Up: tap tempo',3,53);
  ctx.textAlign='right';
  ctx.fillText(playing?'OK: stop':'OK: start',125,53);
  ctx.restore();
  return playing ? Math.max(1,Math.ceil((step+1)*period-elapsed)) : 0;
}

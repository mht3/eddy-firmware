import {text} from './lcd.js';
import {line,box} from './utility-pixels.js';
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
  text(ctx,'Metronome',2,9,'primary');
  text(ctx,String(bpm),59,32,'big','center');
  text(ctx,'BPM',83,32);
  if (bpm>40) { line(ctx,10,25,14,21); line(ctx,10,25,14,29); }
  if (bpm<220) { line(ctx,117,25,113,21); line(ctx,117,25,113,29); }
  for (let i=0;i<4;i++) box(ctx,30+18*i,34,14,6,2,playing && i===step%4);
  text(ctx,'Down: '+outputs[output],64,50,'secondary','center');
  text(ctx,state.taps?.length===1?'Tap Up again':'Up: tap tempo',3,62);
  text(ctx,playing?'OK: stop':'OK: start',125,62,'secondary','right');
  return playing ? Math.max(1,Math.ceil((step+1)*period-elapsed)) : 0;
}

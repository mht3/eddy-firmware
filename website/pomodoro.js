const step = 5000;
const max = 99 * 60000;
const durations = [25 * 60000, 5 * 60000];
export const focus = {rest:false, left:durations[0], deadline:0, muted:false};

let audio;
let alarm;
function chime() {
  if (focus.muted || !audio || audio.state !== 'running') return;
  let start=audio.currentTime;
  for (const [hz, duration] of [[523,.25],[659,.25],[784,.5]]) {
    const oscillator=audio.createOscillator(), gain=audio.createGain();
    oscillator.frequency.value=hz;
    gain.gain.setValueAtTime(0,start);
    gain.gain.linearRampToValueAtTime(.1,start+.015);
    gain.gain.linearRampToValueAtTime(0,start+duration);
    oscillator.connect(gain); gain.connect(audio.destination);
    oscillator.start(start); oscillator.stop(start+duration);
    start+=duration+.1;
  }
}
function arm() {
  clearTimeout(alarm);
  if (focus.deadline) alarm=setTimeout(remaining,Math.max(1,focus.deadline-Date.now()));
}
export function remaining() {
  const now=Date.now();
  if (focus.deadline && now>=focus.deadline) {
    if (now-focus.deadline<=5000) chime();
    if (!focus.rest && now-focus.deadline<durations[1]) {
      focus.rest=true;
      focus.left=durations[1];
      focus.deadline+=focus.left;
    } else {
      focus.rest=false;
      focus.left=durations[0];
      focus.deadline=0;
    }
    arm();
  }
  return focus.deadline ? Math.min(focus.left,focus.deadline-now) : focus.left;
}
export function pomodoroKey(key, held=false) {
  const left=remaining();
  if (key==='up') focus.muted=!focus.muted;
  if ((key==='ok' || key==='up') && !focus.muted && window.AudioContext) {
    try {
      audio ??= new AudioContext();
      if (audio.state==='suspended') audio.resume().catch(()=>{});
    } catch {}
  }
  if (key==='ok') {
    if (focus.deadline) { focus.left=Math.ceil(left/1000)*1000; focus.deadline=0; }
    else focus.deadline=Date.now()+left;
    arm();
  }
  if ((key==='left' || key==='right') && !focus.deadline) {
    if (key==='left' && left<=step) return;
    const delta=held?60000:step;
    focus.left=Math.max(step,Math.min(max,left+(key==='right'?delta:-delta)));
    durations[Number(focus.rest)]=focus.left;
  }
}
export function drawPomodoro(ctx) {
  const left=remaining(), sec=Math.ceil(left/1000);
  ctx.save();
  ctx.font='8px sans-serif';
  ctx.textAlign='left';
  ctx.fillText(focus.rest?'Short break':'Focus session',3,1);
  ctx.textAlign='center';
  ctx.font='bold 24px monospace';
  const clock=String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0');
  ctx.fillText(clock,64,17);
  if (!focus.deadline) {
    ctx.beginPath();
    if (left>step) { ctx.moveTo(18,26); ctx.lineTo(12,32); ctx.lineTo(18,38); }
    if (left<max) { ctx.moveTo(109,26); ctx.lineTo(115,32); ctx.lineTo(109,38); }
    ctx.stroke();
  }
  ctx.font='8px sans-serif';
  if (!focus.deadline) ctx.fillText('Tap 5s / Hold 1m',64,44);
  ctx.textAlign='left';
  ctx.fillText(focus.muted?'Up: muted':'Up: sound on',2,53);
  ctx.textAlign='right';
  const verb=focus.deadline?'pause':focus.left<durations[Number(focus.rest)]?'resume':'start';
  ctx.fillText('OK '+verb,126,53);
  ctx.restore();
}

import {setPreviewVisible,pickerPreview} from './preview.js';

const chapters = [...document.querySelectorAll('[data-phase]')];
const device = document.querySelector('eddy-device');
const label = document.querySelector('#scene-label');
const labels = ['DEVICE PREVIEW', 'USB CONNECTION', 'FIRMWARE UPDATE', 'HOME SCREEN'];
const milestones = [0, 0.63, 1.48, 3];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
// Decode the face while the tour is visible, ahead of the first button press.
document.querySelector('#playable img').decode().catch(() => {});
const tourLink = document.querySelector('.tour');
let enterControls = false;
tourLink.addEventListener('click', event => {
  enterControls = event.detail === 0;
  requestScene();
});
let queued = false;
function syncScene() {
  queued = false;
  if (pickerPreview) {
    device.hidden=true;
    setPreviewVisible(true);
    label.textContent='APP PREVIEW';
    return;
  }
  const portraitTour = matchMedia('(max-width:760px)').matches &&
    !matchMedia('(orientation:landscape) and (max-height:500px)').matches;
  const focus = innerHeight * (portraitTour ? 0.72 : 0.5);
  // Align the first and last poses with their navigation targets, even when
  // the final section is taller than a landscape phone's viewport.
  const stops = chapters.map((section,i) => {
    if (i === 0) return -scrollY;
    const box = section.getBoundingClientRect();
    if (i === chapters.length-1) return box.top - parseFloat(getComputedStyle(section).scrollMarginTop || 0);
    return box.top + Math.min(box.height/2,innerHeight*0.32) - focus;
  });
  let chapter = 0;
  while (chapter < stops.length-1 && stops[chapter+1] <= 1) chapter++;
  const next = Math.min(chapter+1,stops.length-1);
  const t = next===chapter ? 0 : Math.max(0,Math.min(1,-stops[chapter]/(stops[next]-stops[chapter])));
  const phase = milestones[chapter] + t*(milestones[next]-milestones[chapter]);
  const pose = reducedMotion.matches ? milestones[t > 0.5 ? next : chapter] : phase;
  device.setAttribute('phase', pose.toFixed(3));
  const playable = phase >= 2.72;
  setPreviewVisible(playable);
  if (playable && enterControls) {
    enterControls = false;
    if (location.hash === '#home-screen' && (document.activeElement === tourLink || document.activeElement === document.body)) {
      document.querySelector('#playable [data-key=ok]').focus({preventScroll:true});
    }
  }
  device.hidden = playable;
  label.textContent = playable ? 'INTERACTIVE HOME SCREEN' : labels[t > 0.5 ? next : chapter];
}
function requestScene() {
  if (!queued) requestAnimationFrame(syncScene);
  queued = true;
}
window.addEventListener('scroll', requestScene, {passive:true});
window.addEventListener('resize', requestScene);
reducedMotion.addEventListener('change', requestScene);
syncScene();
if (pickerPreview) {
  window.addEventListener('pageshow', () => {
    document.querySelector('#playable [data-key=ok]').focus({preventScroll:true});
  }, {once:true});
}

const field = document.querySelector('.field');
function drawField() {
  const {width, height} = field.getBoundingClientRect();
  const scale = Math.min(devicePixelRatio, 2);
  field.width = Math.round(width * scale);
  field.height = Math.round(height * scale);
  const ctx = field.getContext('2d');
  if (!ctx) return;
  ctx.scale(scale, scale);
  ctx.translate(width * 0.57, height * 0.51);
  ctx.rotate(-0.24);
  for (let n = 1; n <= 30; n++) {
    const r = width * (0.12 + n * 0.016);
    ctx.beginPath();
    for (let j = 0; j <= 150; j++) {
      const a = j * Math.PI * 2 / 150;
      const w = r * (1 + 0.115 * Math.sin(3 * a + n * 0.055));
      const x = w * Math.cos(a);
      const y = 0.63 * w * Math.sin(a);
      if (j === 0) ctx.moveTo(x,y);
      else ctx.lineTo(x,y);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(115,181,248,' + (0.05 + 0.13 * (1 - n / 31)) + ')';
    ctx.stroke();
  }
}
new ResizeObserver(drawField).observe(field);

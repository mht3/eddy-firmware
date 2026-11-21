const chapters = [...document.querySelectorAll('[data-phase]')];
const device = document.querySelector('eddy-device');
const label = document.querySelector('#scene-label');
const labels = ['DEVICE PREVIEW', 'USB CONNECTION', 'FIRMWARE UPDATE', 'SIGNAL METER / SETTINGS'];
const milestones = [0, 0.63, 1.48, 3];
let queued = false;
function syncScene() {
  queued = false;
  const focus = innerHeight * (matchMedia('(max-width: 760px)').matches ? 0.72 : 0.5);
  const centers = chapters.map(section => {
    const box = section.getBoundingClientRect();
    return box.top + box.height / 2;
  });
  let chapter = 0;
  while (chapter < centers.length - 1 && centers[chapter + 1] < focus) chapter++;
  const next = Math.min(chapter + 1, centers.length - 1);
  const t = next === chapter ? 0 : Math.max(0, Math.min(1, (focus - centers[chapter]) / (centers[next] - centers[chapter])));
  const phase = milestones[chapter] + t * (milestones[next] - milestones[chapter]);
  device.setAttribute('phase', phase.toFixed(3));
  label.textContent = labels[t > 0.5 ? next : chapter];
}
function requestScene() {
  if (!queued) requestAnimationFrame(syncScene);
  queued = true;
}
window.addEventListener('scroll', requestScene, {passive:true});
window.addEventListener('resize', requestScene);
syncScene();

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
    ctx.strokeStyle = 'rgba(132,222,178,' + (0.05 + 0.13 * (1 - n / 31)) + ')';
    ctx.stroke();
  }
}
new ResizeObserver(drawField).observe(field);

async function loadBuild() {
  const status = document.querySelector('#build-status');
  try {
    const response = await fetch('firmware/main.json', {cache:'no-cache'});
    if (!response.ok) throw new Error('Manifest unavailable');
    const build = await response.json();
    if (build === null) {
      status.textContent = 'The first Eddy main build has not been published yet.';
      return;
    }
    if (!/^eddy-[a-zA-Z0-9._-]+$/.test(build.version) || build.target !== 'f7' ||
        build.file !== 'flipper-z-f7-update-' + build.version + '.tgz' ||
        (build.commit !== null && !/^[a-f0-9]{40}$/.test(build.commit))) throw new Error('Invalid build');
    const archive = new URL('firmware/' + build.file, document.baseURI);
    const check = await fetch(archive, {method:'HEAD'});
    if (!check.ok) throw new Error('Package unavailable');
    const download = document.querySelector('#download');
    download.href = archive.href;
    download.download = build.file;
    download.hidden = false;
    const source = document.querySelector('#source');
    if (build.commit) {
      source.href = 'https://github.com/mht3/eddy-firmware/tree/' + build.commit;
      source.hidden = false;
    }
    const webInstall = document.querySelector('#install-link');
    status.textContent = build.version;
    if (location.protocol === 'https:' && navigator.serial) {
      const lab = new URL('https://lab.flipper.net/');
      lab.search = new URLSearchParams({url:archive.href, target:'f7', channel:'release-cfw', version:build.version});
      webInstall.href = lab.href;
      webInstall.hidden = false;
    } else {
      status.append(' · Use qFlipper, or open the HTTPS site in desktop Chrome or Edge.');
    }
  } catch {
    status.textContent = 'The build could not be loaded. Refresh to try again.';
  }
}
loadBuild();

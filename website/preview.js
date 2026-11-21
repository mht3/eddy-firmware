import {drawLauncher, launcherApps, launcherArt} from './launcher.js';
import {drawCloseUpHome} from './home-screen.js';

const panel = document.querySelector('#playable');
const display = panel.querySelector('canvas');
const ctx = display.getContext('2d');
const status = document.querySelector('#preview-state');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const ink = '#432a14';
const titles = {
  home:'Home screen', menu:'Main menu', apps:'Apps', system:'Settings', about:'About', archive:'Archive', folder:'Dolphin',
  note:'Eddy.txt', signal:'Signal Meter', settings:'Eddy Settings',
  clock:'Clock', passport:'Passport', lock:'Lock menu', locked:'Locked',
};
const lists = {
  system:[['Passport','passport'], ['Clock & Alarm','clock'], ['About','about']],
  archive:[['Dolphin/','folder'], ['Eddy.txt','note']],
  folder:[['Eddy Current','home']],
  settings:[['Animation','toggle']],
  lock:[['Lock keypad','locked']],
};
const homeKeys = {ok:'menu', up:'lock', down:'archive', left:'clock', right:'passport'};
let history = [{page:'home',row:0}];
let animation = true;
let menuSelection = 0;
let selectedSince = 0;
let timer;
let inView = false;
const current = () => history[history.length-1];

function drawList(page, row) {
  lists[page].forEach(([label], i) => {
    const y = 17 + 15*i;
    const selected = i === row;
    if (selected) ctx.fillRect(2, y-1, 124, 13);
    ctx.fillStyle = selected ? '#ffbe70' : ink;
    ctx.fillText(label, 6, y+1);
    if (page === 'settings') ctx.fillText(animation ? 'On' : 'Off', 99, y+1);
    ctx.fillStyle = ink;
  });
}

function drawMeter(tick) {
  ctx.font = '8px monospace';
  ctx.fillText('433.92 MHz', 76, 3);
  ctx.strokeRect(2.5, 15.5, 123, 36);
  for (let x=0; x<120; x++) {
    const t = (x + tick) * 0.11;
    const height = 3 + Math.round(17 * Math.abs(Math.sin(t)*Math.cos(t*.23))**4);
    ctx.fillRect(x+4, 51-height, 1, height);
  }
  ctx.fillText('Sample signal', 3, 54);
}

function draw() {
  clearTimeout(timer);
  if (panel.hidden || !inView || document.hidden) return;
  const bounds = display.getBoundingClientRect();
  const width = Math.max(1,Math.round(bounds.width * window.devicePixelRatio));
  const height = Math.max(1,Math.round(bounds.height * window.devicePixelRatio));
  if (display.width !== width || display.height !== height) {
    display.width = width;
    display.height = height;
  }
  ctx.setTransform(width/128,0,0,height/64,0,0);
  const {page,row} = current();
  const tick = reducedMotion.matches ? 4 : Math.floor(performance.now()/167);
  ctx.clearRect(0,0,128,64);
  ctx.fillStyle = ctx.strokeStyle = ink;
  ctx.imageSmoothingEnabled = false;
  ctx.font = 'bold 10px monospace';
  ctx.textBaseline = 'top';
  if (page === 'home') {
    drawCloseUpHome(ctx, animation ? tick % 16 : 4);
  } else if (page === 'menu') {
    drawLauncher(ctx, menuSelection, reducedMotion.matches ? 0 : performance.now()-selectedSince);
  } else {
    ctx.fillText(titles[page],3,2);
    ctx.fillRect(0,13,128,1);
    ctx.font = 'bold 9px monospace';
    const clock = new Date();
    const lines = {
      apps:['/ext/apps', 'Folder is empty'],
      about:['Eddy Firmware', 'Flipper Zero F7'],
      note:['Hello from Eddy!', 'See you at sea.'],
      passport:['Eddy the dolphin', 'Level 1'],
      clock:[clock.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})],
      locked:['Keypad locked', 'Press Back to exit'],
    };
    if (lists[page]) drawList(page,row);
    else if (page === 'signal') drawMeter(tick);
    else lines[page]?.forEach((line,i) => ctx.fillText(line,5,22+i*14));
  }
  if (page === 'clock' || (!reducedMotion.matches && (page === 'signal' || page === 'menu' || (page === 'home' && animation)))) {
    timer = setTimeout(draw, page === 'clock' ? 1000 : 167);
  }
}

function announce() {
  const {page,row} = current();
  let text = titles[page];
  if (page === 'menu') text += ', ' + launcherApps[menuSelection].name;
  if (page === 'apps') text += '. Apps folder is empty.';
  if (lists[page]) text += ', ' + lists[page][row][0];
  if (page === 'settings') text += animation ? ' on' : ' off';
  if (page === 'home') text += '. Eddy swims in an ocean current. Press OK for the menu.';
  if (page === 'note') text += '. Hello from Eddy! See you at sea.';
  if (page === 'passport') text += '. Eddy the dolphin, level one.';
  if (page === 'clock') text += '. ' + new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  if (page === 'signal') text += '. Simulated signal on 433.92 MHz.';
  status.textContent = text;
}

function press(key) {
  const state = current();
  const rows = lists[state.page];
  let next;
  if (key === 'back') {
    if (history.length > 1) history.pop();
  } else if (state.page === 'home') {
    next = homeKeys[key];
    if (next === 'menu') menuSelection = 0;
  } else if (state.page === 'menu') {
    if (key === 'ok') next = launcherApps[menuSelection].page;
    else if (key === 'up' || key === 'down') menuSelection ^= 1;
    else {
      const step = key === 'left' ? -2 : 2;
      menuSelection = (menuSelection + step + launcherApps.length) % launcherApps.length;
    }
  } else if (rows) {
    if (key === 'up' || key === 'down') {
      state.row = (state.row + (key === 'down' ? 1 : -1) + rows.length) % rows.length;
    } else if (key === 'ok' || key === 'right' || (key === 'left' && state.page === 'settings')) {
      next = rows[state.row][1];
    } else if (key === 'left' && history.length > 1) history.pop();
  }
  if (next === 'toggle') animation = !animation;
  else if (next === 'home') history = [{page:'home',row:0}];
  else if (next) history.push({page:next,row:0});
  if (current().page === 'menu') selectedSince = performance.now();
  draw();
  announce();
}

panel.addEventListener('click', event => {
  const button = event.target.closest('[data-key]');
  if (button) press(button.dataset.key);
});
new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; draw(); }).observe(panel);
new ResizeObserver(draw).observe(display);
window.addEventListener('resize',draw);
launcherArt.addEventListener('load',draw);
document.addEventListener('visibilitychange',draw);
reducedMotion.addEventListener('change',draw);

export function setPreviewVisible(visible) {
  if (visible === !panel.hidden) return;
  panel.hidden = !visible;
  if (visible) announce();
  draw();
}

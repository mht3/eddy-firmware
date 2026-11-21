import {drawLauncher, sections, apps, launcherArt} from './launcher.js';
import {settingsRows, settingsSamples, drawQuick, quickStatus, adjustQuick} from './quick-settings.js';
import {remoteDemo} from './remote-preview.js';
import {powerLists, powerSamples, powerTitles, powerAction} from './power-preview.js';
import {drawCloseUpHome, drawBattery, sampleCharge} from './home-screen.js';

const panel = document.querySelector('#playable');
const display = panel.querySelector('canvas');
const ctx = display.getContext('2d');
const status = document.querySelector('#preview-state');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const ink = '#432a14';
const titles = {
  home:'Home screen', menu:'Launcher', apps:'Apps', settings:'Settings', power:'Power',
  signal:'Sub-GHz', rfid:'RFID', nfc:'NFC', infrared:'Infrared', gpio:'GPIO', ibutton:'iButton',
  pomodoro:'Pomodoro Timer', battery:'Battery info', restart:'Restart?', shutdown:'Power off?',
  off:'Powered off', about:'About', clock:'Clock & Alarm', passport:'Passport', remotes:'My remotes',
  replacePin:'Replace home shortcut?', deleteRemote:'Delete this remote?', tester:'Button tester', detected:'Signal detected', quick:'Quick settings', remote:'Remote', command:'Demo button', editRemote:'Edit remote', learn:'Learn a demo remote', pins:'GPIO pins', uart:'USB to UART',
};
const readerArt = {};
for (const kind of ['card','contact']) {
  const image = new Image();
  image.src = new URL('reader-'+kind+'.png',import.meta.url).href;
  image.addEventListener('load',draw);
  readerArt[kind] = image;
}
const readers = {
  rfid:['card','Hold tag to',"Flipper’s back"],
  nfc:['card','Hold card to',"Flipper’s back"],
  ibutton:['contact','Touch key to','the contacts'],
};
const samples = {
  replacePin:['Left: Cancel','Right: Replace'], deleteRemote:['Left: Cancel','Right: Delete'],
  tester:['Try a demo IR button','OK for a sample signal'], detected:['Sample IR detected','OK to test another'],
  remotes:['No remotes yet'],
  learn:['Point your remote','at the Flipper'], pins:['No module attached'], uart:['Connect via USB'],
  battery:[sampleCharge+'% charged','On battery power'], about:['Eddy Firmware','Flipper Zero F7'],
  passport:['Eddy the dolphin','Level 1'], restart:['OK to restart preview'], shutdown:['OK to power off preview'],
  off:['OK to wake preview'],
};
Object.assign(titles,Object.fromEntries(settingsRows.map(([name,page])=>[page,name])),powerTitles);
Object.assign(samples,settingsSamples,powerSamples);
const lists = {
  menu:sections.map(([name,page])=>[name,page==='settings'?'quick':page]), apps, settings:settingsRows,
  infrared:[['My remotes','remotes'],['Learn a remote','learn'],['Button tester','tester']],
  gpio:[['GPIO pins','pins'],['USB to UART','uart']],
  editRemote:[['Rename remote','rename'],['Delete remote','deleteRemote']],
  ...powerLists,
};
function refreshRemotes() {
  const saved=remoteDemo.rows;
  lists.apps=remoteDemo.pin ? [...apps,[remoteDemo.pin,'remote']] : apps;
  lists.remotes=saved.length ? saved : [['Learn a remote','learn']];
  titles.remotes=saved.length?'My remotes':'No remotes yet';
  delete samples.remotes;
  titles.remote=remoteDemo.active || 'Remote';
  lists.remote=[
    ...remoteDemo.buttons.map(name=>[name,'command']), ['Add button','add'], ['Edit','editRemote'],
    [remoteDemo.pin===remoteDemo.active?'Unpin from Home':'Pin to Home','pin'],
  ];
  samples.learn=['Try a sample TV button','OK to name your remote'];
  samples.command=['Sample TV power button','Back to remote'];
}
refreshRemotes();
let history = [{page:'home',row:0}];
let timer;
let inView = false;
const current = () => history[history.length-1];
const focusMs = 25*60*1000, breakMs = 5*60*1000;
let focus = {rest:false, left:focusMs, deadline:0};

function remaining() {
  const now = Date.now();
  if (focus.deadline && now >= focus.deadline) {
    if (!focus.rest && now < focus.deadline+breakMs) {
      focus = {rest:true,left:breakMs,deadline:focus.deadline+breakMs};
    } else focus = {rest:false,left:focusMs,deadline:0};
  }
  return focus.deadline ? focus.deadline-now : focus.left;
}

function drawPomodoro() {
  const sec = Math.ceil(remaining()/1000);
  ctx.textAlign = 'center';
  ctx.font = '8px sans-serif';
  ctx.fillText(focus.rest ? 'Short break' : 'Focus session',64,2);
  ctx.font = 'bold 24px monospace';
  const clock = Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0');
  ctx.fillText(clock,64,17);
  ctx.font = '8px sans-serif';
  const verb=focus.deadline?'pause':focus.left<(focus.rest?breakMs:focusMs)?'resume':'start';
  ctx.fillText('OK '+verb+'    Left reset',64,52);
  ctx.textAlign = 'start';
}

function drawReader(page) {
  const [kind,first,second] = readers[page];
  const image = readerArt[kind];
  if (image.naturalWidth) ctx.drawImage(image,1,64-image.naturalHeight);
  ctx.font = 'bold 8px sans-serif';
  ctx.fillText('Ready to scan',64,17);
  ctx.font = '8px sans-serif';
  ctx.fillText(first,64,32);
  ctx.fillText(second,64,42);
}

function drawList(page,row) {
  const start=Math.max(0,row-2);
  lists[page].slice(start,start+3).forEach(([label],offset) => {
    const i=start+offset, y=17+15*offset;
    if (i===row) ctx.fillRect(2,y-1,124,13);
    ctx.fillStyle=i===row?'#ffbe70':ink;
    ctx.fillText(label,6,y+1);
    ctx.fillStyle=ink;
  });
}

function drawMeter(tick) {
  ctx.font = '8px monospace';
  ctx.fillText('433.92 MHz', 76, 54);
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
  display.classList.toggle('selectable',['menu','apps','quick'].includes(page));
  const tick = reducedMotion.matches ? 4 : Math.floor(performance.now()/167);
  ctx.clearRect(0,0,128,64);
  ctx.fillStyle = ctx.strokeStyle = ink;
  ctx.imageSmoothingEnabled = false;
  ctx.font = 'bold 10px monospace';
  ctx.textBaseline = 'top';
  if (page === 'home') {
    drawCloseUpHome(ctx,tick % 16);
    ctx.font='bold 7px sans-serif';
    const badge='↓ '+(remoteDemo.pin || 'Apps');
    const badgeWidth=Math.min(86,ctx.measureText(badge).width+5);
    ctx.fillRect(1,54,badgeWidth,10);
    ctx.fillStyle='#ffbe70';
    ctx.fillText(badge,3,55,82);
  } else if (page === 'menu' || page === 'apps') {
    drawLauncher(ctx,page,row,lists.apps);
  } else if (page === 'quick') {
    drawQuick(ctx,row);
  } else if (page === 'pomodoro') {
    drawPomodoro();
  } else {
    if (readers[page]) ctx.font = 'bold 8px monospace';
    ctx.fillText(titles[page],3,readers[page]?0:2,88);
    if (!readers[page]) ctx.fillRect(0,13,128,1);
    ctx.font = 'bold 9px monospace';
    if (readers[page]) drawReader(page);
    else if (lists[page]) drawList(page,row);
    else if (page === 'signal') drawMeter(tick);
    else if (page === 'clock') ctx.fillText(new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}),5,24);
    else samples[page]?.forEach((line,i) => ctx.fillText(line,4,22+i*14));
  }
  if (page !== 'home' && page !== 'off') drawBattery(ctx);
  if (page === 'clock' || (page === 'pomodoro' && focus.deadline)) timer=setTimeout(draw,250);
  else if (!reducedMotion.matches && (page==='signal' || page==='home')) {
    timer=setTimeout(draw,167);
  }
}

function announce() {
  const {page,row} = current();
  let text = titles[page];
  if (readers[page]) text += '. Ready to scan. '+readers[page].slice(1).join(' ');
  if (samples[page]) text += '. '+samples[page].join('. ');
  if (lists[page]) text += ', '+lists[page][row][0];
  if (page==='replacePin' || page==='deleteRemote') text+='. Left to cancel. Right to confirm.';
  if (page==='quick') text+=', '+quickStatus(row);
  if (page==='home' && remoteDemo.pin) text+='. Down opens '+remoteDemo.pin;
  if (page!=='off') text += '. Sample battery '+sampleCharge+'%, not charging.';
  if (page==='home') text += ' Press OK for the launcher or Up for quick settings.';
  if (page==='signal') text+='. Sample signal at 433.92 MHz.';
  if (page==='pomodoro') text += '. '+Math.ceil(remaining()/1000)+' seconds. '+(focus.deadline?'Running':'Paused');
  status.textContent=text;
}

function press(key) {
  const state=current(), page=state.page, rows=lists[page];
  const action=powerAction(page,state.row,key);
  if (action!==undefined) {
    if (action==='back' && history.length>1) history.pop();
    if (['home','off','upgradeMode'].includes(action)) history=[{page:action,row:0}];
  } else if (key==='back') {
    if (history.length>1) history.pop();
  } else if (page==='home') {
    if (key==='down' && remoteDemo.pin) {
      remoteDemo.select(remoteDemo.pin);
      refreshRemotes();
      history.push({page:'remote',row:0});
      draw(); announce(); return;
    }
    const next={ok:'menu',up:'quick',down:'apps',right:'passport',left:'clock'}[key];
    if(next) history.push({page:next,row:0});
  } else if(page==='quick') {
    if(key==='left' || key==='right') state.row=(state.row+(key==='left'?2:1))%3;
    if(key==='up' || key==='down') adjustQuick(state.row,key==='up'?5:-5);
    if(key==='ok' && state.row===2) history.push({page:'settings',row:0});
  } else if((page==='tester' || page==='detected') && key==='ok') {
    state.page=page==='tester'?'detected':'tester';
  } else if(page==='learn' && key==='ok') {
    openRemoteForm('create');
  } else if(page==='replacePin' || page==='deleteRemote') {
    if(key==='left') history.pop();
    if(key==='right') {
      if(page==='replacePin') { remoteDemo.togglePin(); history.pop(); }
      else {
        remoteDemo.remove();
        while(history.length>1 && !['remotes','apps','infrared'].includes(current().page)) history.pop();
      }
      refreshHistory();
    }
  } else if(page==='pomodoro') {
    const left=remaining();
    if(key==='ok') {
      if(focus.deadline) { focus.left=left; focus.deadline=0; }
      else focus.deadline=Date.now()+left;
    }
    if(key==='left') focus={rest:false,left:focusMs,deadline:0};
  } else if(rows) {
    if(key==='ok') {
      const [name,next]=rows[state.row];
      if(next==='pin') {
        if(remoteDemo.pin && remoteDemo.pin!==remoteDemo.active) history.push({page:'replacePin',row:0});
        else remoteDemo.togglePin();
        refreshHistory();
      } else if(next==='rename' || next==='add') openRemoteForm(next);
      else {
        if(next==='remote') { remoteDemo.select(name); refreshRemotes(); }
        if(next==='command') { titles.command=name; samples.command=['Demo button pressed']; }
        history.push({page:next,row:0});
      }
    }
    else if(page==='apps' && (key==='up' || key==='down')) {
      state.row=state.row>=4 ? state.row-4 : Math.min(state.row+4,rows.length-1);
    } else if(page!=='menu' || key==='left' || key==='right') {
      state.row=(state.row+(key==='left'||key==='up'?-1:1)+rows.length)%rows.length;
    }
  }
  draw();
  announce();
}

const nameDialog=document.getElementById('remote-name-dialog');
const nameInput=document.getElementById('remote-name');
const buttonInput=document.getElementById('remote-button');
let formAction;
function openRemoteForm(action) {
  formAction=action;
  nameInput.value=action==='create'?'':remoteDemo.active;
  buttonInput.value=action==='create'?'Power':'';
  for (const [input,label,show] of [[nameInput,'remote-name-label',action!=='add'],[buttonInput,'remote-button-label',action!=='rename']]) {
    input.disabled=input.hidden=!show;
    document.getElementById(label).hidden=!show;
    input.setCustomValidity('');
  }
  nameDialog.showModal();
  (nameInput.disabled?buttonInput:nameInput).focus();
}
function refreshHistory() {
  refreshRemotes();
  for(const entry of history) {
    if(lists[entry.page]) entry.row=Math.min(entry.row,lists[entry.page].length-1);
  }
}
for(const field of [nameInput,buttonInput]) field.addEventListener('input',()=>field.setCustomValidity(''));
document.getElementById('remote-cancel').addEventListener('click',()=>nameDialog.close());
nameDialog.querySelector('form').addEventListener('submit',event=>{
  event.preventDefault();
  const error=remoteDemo.edit(formAction,nameInput.value,buttonInput.value);
  if(error) {
    const field=error.includes('button')?buttonInput:nameInput;
    field.setCustomValidity(error);
    field.reportValidity();
    return;
  }
  nameDialog.close();
  refreshHistory();
  if(formAction==='create') history[history.length-1]={page:'remote',row:0};
  else if(formAction==='rename') history.pop();
  draw();
  announce();
});

display.addEventListener('click', event=>{
  const state=current();
  if (!['menu','apps','quick'].includes(state.page)) return;
  const box=display.getBoundingClientRect();
  const x=(event.clientX-box.left)*128/box.width;
  const y=(event.clientY-box.top)*64/box.height;
  const grid=state.page==='apps';
  if(y>=(grid?48:50) || y<(state.page==='menu'?12:8)) return;
  const index=grid ? Math.floor((y-8)/20)*4+Math.floor(x/32) : Math.min(2,Math.floor(x/42));
  if(grid && index>=lists.apps.length) return;
  state.row=index;
  if(state.page==='quick' && index<2) { draw(); announce(); }
  else press('ok');
});

const backButton=panel.querySelector('[data-key=back]');
let hold;
let heldBack=false;
backButton.addEventListener('pointerdown', event=>{
  heldBack=false;
  if(current().page!=='home') return;
  backButton.setPointerCapture(event.pointerId);
  hold=setTimeout(()=>{
    heldBack=true;
    history.push({page:'shutdown',row:0});
    draw(); announce();
  },650);
});
for(const event of ['pointerup','pointercancel','lostpointercapture']) {
  backButton.addEventListener(event,()=>clearTimeout(hold));
}
panel.addEventListener('click', event => {
  const button = event.target.closest('[data-key]');
  if (button===backButton && heldBack) { heldBack=false; return; }
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

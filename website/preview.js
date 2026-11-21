import {getAppOrder, getSelectedApps, restoreAppOrder} from './app-catalog.js';
import {openSpotifyDemo, drawSpotify, spotifyStatus, spotifyKey} from './spotify-preview.js';
import {openMusicDemo, drawMusic, musicStatus, musicKey} from './music-preview.js';
import {presetButtons, tvPresetRows, tvPadStatus, tvPadKey, drawTvPad, tvPadHit, tvNavigationHit} from './tv-presets.js';
import {openBuilder, builderKey, builderStatus, drawBuilder} from './builder-preview.js';
import {bluetoothKey, bluetoothStatus, drawBluetooth} from './bluetooth-preview.js';
import {focus, remaining, drawPomodoro, pomodoroKey} from './pomodoro.js';
import {drawMetronome, metronomeInput, metronomeStatus} from './metronome.js';
import {drawLauncher, layoutApps, verticalApp, sections, apps, launcherArt} from './launcher.js';
import {settingsRows, settingsSamples, drawQuick, quickStatus, adjustQuick} from './quick-settings.js';
import {listNotes, nameNote} from './observation-preview.js';
import {layoutDemo, remoteDemo} from './remote-preview.js';
import {powerLists, powerSamples, powerTitles, powerAction} from './power-preview.js';
import {drawCloseUpHome, drawBattery, sampleCharge} from './home-screen.js';

const panel = document.querySelector('#playable');
const display = panel.querySelector('canvas');
const ctx = display.getContext('2d');
const status = document.querySelector('#preview-state');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const ink = '#432a14';
const titles = {
  music:'Music', spotify:'Spotify', tvPresets:'Choose your TV', tvPad:'TV remote', builder:'Remotes', btRemote:'Bluetooth Remote', noteList:'Saved observations', noteDetail:'Saved observation',
  home:'Home screen', menu:'Launcher', apps:'Apps', settings:'Settings', power:'Power',
  signal:'Sub-GHz', rfid:'RFID', nfc:'NFC', infrared:'Infrared', gpio:'GPIO', ibutton:'iButton',
  metronome:'Metronome', pomodoro:'Pomodoro Timer', battery:'Battery info', restart:'Restart?', shutdown:'Power off?',
  off:'Powered off', about:'About', clock:'Clock & Alarm', passport:'Passport', remotes:'My remotes',
  savedRemote:'Remote saved', pinsFull:'Apps shortcuts full', pinStorage:'Could not save shortcut', deleteRemote:'Delete this remote?', tester:'Button tester', detected:'Signal detected', quick:'Quick settings', remote:'Remote', editRemote:'Edit remote', learn:'Learn a demo remote', pins:'GPIO pins', uart:'USB to UART',
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
const readerTypes = {rfid:'EM4100', nfc:'ISO 14443-4A', ibutton:'Dallas'};
const meterPresets = [310000,315000,390000,433920,868350,915000];
const meterBands = [[300000,348000],[387000,464000],[779000,928000]];
const meterLabel = khz => (khz/1000).toFixed(3)+' MHz';
const samples = {
  pinStorage:['Check browser storage.','Back to return'], pinsFull:['Unpin another remote.','Back to return'], deleteRemote:['Left: Cancel','Right: Delete'],
  tester:['Try a demo IR button','OK for a sample signal'], detected:['Sample IR detected','OK to test another'],
  remotes:['No remotes yet'],
  learn:['Point your remote','at the Flipper'], pins:['No module attached'], uart:['Connect via USB'],
  battery:[sampleCharge+'% charged','On battery power'], about:['Eddy Firmware','Flipper Zero'],
  passport:['Eddy the dolphin','Level 1'], restart:['OK to restart preview'], shutdown:['OK to power off preview'],
  off:['OK to wake preview'],
};
Object.assign(titles,Object.fromEntries(settingsRows.map(([name,page])=>[page,name])),powerTitles);
Object.assign(samples,settingsSamples,powerSamples);
const lists = {
  tuning:[...meterPresets.map(khz=>[meterLabel(khz)]),...meterBands.map(([lo,hi])=>[`Other: ${lo/1000}–${hi/1000} MHz`])],
  menu:sections.map(([name,page])=>[name,page==='settings'?'quick':page]), apps, settings:settingsRows,
  infrared:[['My remotes','remotes'],['Learn a remote','learn'],['TV presets','tvPresets'],['Button tester','tester']], tvPresets:tvPresetRows,
  gpio:[['GPIO pins','pins'],['USB to UART','uart']],
  editRemote:[['Rename remote','rename'],['Delete remote','deleteRemote']],
  ...powerLists,
};
const previewParams = new URLSearchParams(location.search);
const guideApp = ['music','spotify'].find(id=>id===previewParams.get('demo'));
export const pickerPreview = Boolean(guideApp) || previewParams.has('apps') || previewParams.has('app');
const requestedApps = previewParams.has('apps') ? new Set(previewParams.get('apps').split(',')) : null;
const orderParam = previewParams.get('order')?.split(',');
const requestedOrder = restoreAppOrder(orderParam);
let visibleShortcuts = [];
function refreshRemotes() {
  const saved=remoteDemo.rows;
  const enabled = requestedApps ?? getSelectedApps();
  visibleShortcuts = remoteDemo.shortcuts.filter(([,type])=>enabled.has('builder') || (type==='remote' && enabled.has('infrared')));
  lists.apps=layoutApps([...apps.filter(([,id])=>enabled.has(id)),...visibleShortcuts],requestedOrder ?? getAppOrder());
  lists.remotes=saved.length ? saved : [['Learn a remote','learn']];
  titles.remotes=saved.length?'My remotes':'No remotes yet';
  delete samples.remotes;
  titles.remote=remoteDemo.active || 'Remote';
  lists.remote=[
    ...remoteDemo.buttons.map(name=>[name,'command']), ['Add button','add'], ['Edit','editRemote'],
    [remoteDemo.pins.includes(remoteDemo.active)?'Unpin from Apps':'Pin to Apps','pin'],
  ];
  samples.savedRemote=[remoteDemo.active || '', 'Left: Done', 'Right: Pin to Apps'];
  samples.learn=['Try a sample TV button','OK to name your remote'];
}
refreshRemotes();
let history = [{page:'home',row:0}];
let timer;
let inView = false;
const current = () => history[history.length-1];
function beginNote(page, detail) {
  nameNote(page,detail,note => {
    history.push({page:'noteDetail',row:0,note});
    draw(); announce();
  });
}

function browseNotes(page) {
  let notes = [], message = '';
  try { notes = listNotes(page); }
  catch { message = 'Cannot read saved notes'; }
  history.push({page:'noteList',row:0,notes,message});
}

function drawNote(page,row) {
  ctx.font='8px sans-serif';
  if (page==='noteDetail') {
    const {note}=current();
    ctx.fillText(note.name,3,17,120);
    ctx.fillRect(3,35,122,1);
    ctx.fillText(note.detail,3,41,120);
    return;
  }
  const {notes,message}=current();
  if (!notes.length) { ctx.fillText(message || 'No saved observations',3,26); return; }
  const start=Math.max(0,row-2);
  notes.slice(start,start+3).forEach((note,i) => {
    const y=16+15*i, selected=start+i===row;
    if(selected) ctx.fillRect(2,y,124,13);
    ctx.fillStyle=selected?'#ffbe70':ink;
    ctx.fillText(note.name,5,y+2,117);
    ctx.fillStyle=ink;
  });
}

function drawReader(page) {
  if (current().detected) {
    ctx.font='bold 8px sans-serif';
    ctx.fillText('Type detected',3,16);
    ctx.font='9px sans-serif';
    ctx.fillText(readerTypes[page],3,34);
    ctx.font='8px sans-serif';
    ctx.fillText('‹ Scan',3,54);
    ctx.fillText('OK Save',48,54);
    ctx.fillText('Saved ›',96,54);
    return;
  }
  const [kind,first,second] = readers[page];
  const image = readerArt[kind];
  if (image.naturalWidth) ctx.drawImage(image,1,64-image.naturalHeight);
  ctx.font = 'bold 8px sans-serif';
  ctx.fillText('Ready to scan',64,17);
  ctx.font = '8px sans-serif';
  ctx.fillText(first,64,32);
  ctx.fillText(second,64,42);
  ctx.font='7px sans-serif';
  ctx.fillText('OK sample  ·  Saved ›',64,55,62);
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

let signalDbm;
titles.tuning='Tune receiver';
function tuneMeter(khz) {
  history.pop();
  current().frequency=khz;
  draw();
  announce();
}
function enterFrequency(band) {
  const dialog=document.querySelector('#frequency-dialog');
  const input=dialog.querySelector('input');
  [input.min,input.max]=band;
  dialog.querySelector('label').textContent=`Receive frequency (${input.min}–${input.max} kHz)`;
  input.value='';
  dialog.querySelector('form').onsubmit=event=>{
    event.preventDefault();
    if(!input.reportValidity()) return;
    dialog.close();
    tuneMeter(input.valueAsNumber);
  };
  dialog.querySelector('[type=button]').onclick=()=>dialog.close();
  dialog.showModal();
  input.focus();
}
function drawMeter(tick) {
  ctx.font = '8px monospace';
  ctx.strokeRect(2.5,14.5,123,24);
  for (let x=0; x<120; x++) {
    const t = (x + tick) * 0.11;
    const height = 3 + Math.round(17 * Math.abs(Math.sin(t)*Math.cos(t*.23))**4);
    ctx.fillRect(x+4,38-height,1,height);
    if (x===119) signalDbm = -110+3*height;
  }
  ctx.fillText(signalDbm+' dBm',3,41);
  ctx.fillText(meterLabel(current().frequency ?? 433920),71,41);
  ctx.fillText('◀ Tune',3,54);
  ctx.fillText('Saved ▶',89,54);
  ctx.fillText('OK Save',50,54);
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
  display.classList.toggle('selectable',['menu','apps','quick','tvPad','pomodoro'].includes(page));
  const tick = reducedMotion.matches ? 4 : Math.floor(performance.now()/167);
  ctx.clearRect(0,0,128,64);
  ctx.fillStyle = ctx.strokeStyle = ink;
  ctx.imageSmoothingEnabled = false;
  ctx.font = 'bold 10px monospace';
  ctx.textBaseline = 'top';
  if (page === 'home') {
    drawCloseUpHome(ctx,tick % 16);
  } else if (page === 'menu' || page === 'apps') {
    drawLauncher(ctx,page,row,lists.apps);
  } else if (page === 'quick') {
    drawQuick(ctx,row);
  } else if (page === 'tvPad') {
    const delay=drawTvPad(ctx,current());
    if(delay) timer=setTimeout(draw,delay);
  } else if (page === 'builder') {
    drawBuilder(ctx,current());
  } else if (page === 'btRemote') {
    drawBluetooth(ctx,current());
  } else if (page === 'spotify') {
    if(drawSpotify(ctx,current())) timer=setTimeout(draw,200);
  } else if (page === 'music') {
    if(drawMusic(ctx,current())) timer=setTimeout(draw,500);
  } else if (page === 'metronome') {
    const delay=drawMetronome(ctx,current(),performance.now());
    if (delay) timer=setTimeout(draw,delay);
  } else if (page === 'pomodoro') {
    drawPomodoro(ctx);
  } else {
    if (readers[page]) ctx.font = 'bold 8px monospace';
    const sent = page==='remote' && current().sentUntil > performance.now();
    ctx.fillText(sent?'Button sent':titles[page],3,readers[page]?0:2,88);
    if (sent) timer=setTimeout(draw,Math.ceil(current().sentUntil-performance.now()));
    if (!readers[page]) ctx.fillRect(0,13,128,1);
    ctx.font = 'bold 9px monospace';
    if (page==='noteDetail' || page==='noteList') drawNote(page,row);
    else if (readers[page]) drawReader(page);
    else if (lists[page]) drawList(page,row);
    else if (page === 'signal') drawMeter(tick);
    else if (page === 'savedRemote') {
      ctx.textAlign='center';
      ctx.fillText(remoteDemo.active,64,26,120);
      ctx.textAlign='left';
      ctx.fillText('‹ Done',3,52);
      ctx.textAlign='right';
      ctx.fillText('Pin to Apps ›',125,52);
      ctx.textAlign='left';
    }
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
  if (readers[page]) {
    text += current().detected ? '. Type detected. '+readerTypes[page]+'. OK to name and save, or Left to scan again.' :
      '. Ready to scan. '+readers[page].slice(1).join(' ')+'. OK for a sample.';
    text += ' Right for saved observations.';
  }
  if (page==='noteDetail') text += '. '+current().note.name+'. '+current().note.detail;
  if (page==='noteList') text += '. '+(current().notes[row]?.name || current().message || 'No saved observations');
  if (samples[page]) text += '. '+samples[page].join('. ');
  if (lists[page]) text += ', '+(lists[page][row]?.[0] ?? 'No apps installed');
  if (page==='remote' && current().sentUntil > performance.now()) text += '. Demo button pressed.';
  if (page==='deleteRemote') text+='. Left to cancel. Right to confirm.';
  if (page==='quick') text+=', '+quickStatus(row);
  if (page==='home' && visibleShortcuts.length) text+='. Down opens '+visibleShortcuts.at(-1)[0];
  if (page==='tvPad') text+='. '+tvPadStatus(current());
  if (page==='builder') text+='. '+(current().name || '')+' '+builderStatus(current());
  if (page==='btRemote') text+='. '+bluetoothStatus(current());
  if (page!=='off') text += '. Sample battery '+sampleCharge+'%, not charging.';
  if (page==='home') text += ' Press OK for the launcher or Up for quick settings.';
  if (page==='signal') text+='. Sample signal at '+meterLabel(current().frequency ?? 433920)+'. Left to tune, OK to save this reading, Right for saved readings.';
  if (page==='spotify') text += '. '+spotifyStatus(current());
  if (page==='music') text += '. '+musicStatus(current());
  if (page==='metronome') text += '. '+metronomeStatus(current());
  if (page==='pomodoro') text += '. '+Math.ceil(remaining()/1000)+' seconds. '+(focus.deadline?'Running. OK to pause.':'Paused. Left or Right to adjust by five seconds, OK to start.')+' Up toggles sound. '+(focus.muted?'Muted.':'Sound on.');
  status.textContent=text;
}

function press(key) {
  const state=current(), page=state.page, rows=lists[page];
  if(page==='spotify' && spotifyKey(state,key)) { draw(); announce(); return; }
  if(page==='tvPad' && state.navigation && key==='back') {
    tvPadKey(state,key); draw(); announce(); return;
  }
  if(page==='builder') {
    const handled=builderKey(state,key,()=>{refreshHistory(); draw(); announce();});
    if(state.exit && history.length>1) history.pop();
    if(handled || state.exit) { refreshHistory(); draw(); announce(); return; }
  }
  if(page==='btRemote' && bluetoothKey(state,key,()=>{draw(); announce();})) { draw(); announce(); return; }
  if(page==='remote') state.sentUntil=0;
  const action = page==='menu' && key==='ok' && rows[state.row][1]==='off'
    ? 'off' : powerAction(page,state.row,key);
  if (action!==undefined) {
    if (action==='back' && history.length>1) history.pop();
    if (['home','off','upgradeMode'].includes(action)) history=[{page:action,row:0}];
  } else if (key==='back') {
    if (history.length>1) history.pop();
  } else if (page==='home') {
    if (key==='down' && visibleShortcuts.length) {
      const [name,target]=visibleShortcuts.at(-1);
      if(target==='layout' || (requestedApps ?? getSelectedApps()).has('builder')) history.push(openBuilder(name,target));
      else { remoteDemo.select(name); refreshRemotes(); history.push({page:'remote',row:0}); }
      draw(); announce(); return;
    }
    const next={ok:'menu',up:'quick',down:'apps',right:'passport',left:'clock'}[key];
    if(next) history.push({page:next,row:0});
  } else if(page==='tvPad') {
    tvPadKey(state,key);
  } else if(page==='signal') {
    if(key==='left') history.push({page:'tuning',row:state.tuningRow ?? 3});
    if(key==='ok' && Number.isFinite(signalDbm)) beginNote(page,signalDbm+' dBm at '+meterLabel(state.frequency ?? 433920));
    if(key==='right') browseNotes(page);
  } else if(page==='tuning' && key==='ok') {
    history[history.length-2].tuningRow=state.row;
    if(state.row<meterPresets.length) tuneMeter(meterPresets[state.row]);
    else enterFrequency(meterBands[state.row-meterPresets.length]);
  } else if(readers[page]) {
    if(key==='left') state.detected=false;
    if(key==='right') browseNotes(page);
    if(key==='ok') {
      if(state.detected) beginNote(page,readerTypes[page]);
      else state.detected=true;
    }
  } else if(page==='noteList' && state.notes.length) {
    if(key==='up') state.row=(state.row+state.notes.length-1)%state.notes.length;
    if(key==='down') state.row=(state.row+1)%state.notes.length;
    if(key==='ok') history.push({page:'noteDetail',row:0,note:state.notes[state.row]});
  } else if(page==='quick') {
    if(key==='left' || key==='right') state.row=(state.row+(key==='left'?2:1))%3;
    if(key==='up' || key==='down') adjustQuick(state.row,key==='up'?5:-5);
    if(key==='ok' && state.row===2) history.push({page:'settings',row:0});
  } else if((page==='tester' || page==='detected') && key==='ok') {
    state.page=page==='tester'?'detected':'tester';
  } else if(page==='learn' && key==='ok') {
    openRemoteForm('create');
  } else if(page==='savedRemote') {
    if(key==='left') history.pop();
    if(key==='right') {
      if(remoteDemo.setPinned(true)) history.pop();
      else history.push({page:remoteDemo.pinError==='full'?'pinsFull':'pinStorage',row:0});
      refreshHistory();
    }
  } else if(page==='deleteRemote') {
    if(key==='left') history.pop();
    if(key==='right') {
      remoteDemo.remove();
      while(history.length>1 && !['remotes','apps','infrared'].includes(current().page)) history.pop();
      refreshHistory();
    }
  } else if(page==='music') {
    musicKey(state,key);
  } else if(page==='metronome') {
    metronomeInput(state,key,performance.now());
  } else if(page==='pomodoro') {
    pomodoroKey(key);
  } else if(rows?.length) {
    if(key==='ok') {
      const [name,next]=rows[state.row];
      if(next==='pin') {
        if(!remoteDemo.setPinned(!remoteDemo.pins.includes(remoteDemo.active))) {
          history.push({page:remoteDemo.pinError==='full'?'pinsFull':'pinStorage',row:0});
        }
        refreshHistory();
      } else if(next==='command') {
        state.sentUntil=performance.now()+700;
      } else if(next==='rename' || next==='add') openRemoteForm(next);
      else {
        if(next==='remote') { remoteDemo.select(name); refreshRemotes(); }
        if(page==='apps' && next==='remote' && (requestedApps ?? getSelectedApps()).has('builder')) history.push(openBuilder(name,'remote'));
        else if(next==='layout' || next==='builder') history.push(openBuilder(next==='layout'?name:undefined));
        else if(next==='music') history.push(openMusicDemo());
        else if(next==='spotify') history.push(openSpotifyDemo());
        else if(next==='tvPad') {
          layoutDemo.addPreset(name,presetButtons(state.row));
          history.push({page:next,profile:state.row,row:2});
        }
        else history.push({page:next,row:0});
      }
    }
    else if(page==='apps' && (key==='up' || key==='down')) {
      state.row=verticalApp(rows,state.row,key);
    } else if(page!=='menu' || key==='left' || key==='right') {
      state.row=(state.row+(key==='left'||key==='up'?-1:1)+rows.length)%rows.length;
    }
  }
  draw();
  announce();
}

function showAppPreview(id, standaloneSample = false) {
  const index=lists.apps.findIndex(([,page])=>page===id);
  history=[{page:'home',row:0},{page:'apps',row:Math.max(0,index)}];
  if(index>=0 || standaloneSample) {
    if(id==='builder') history.push(openBuilder());
    else if(id==='music') history.push(openMusicDemo());
    else if(id==='spotify') history.push(openSpotifyDemo());
    else history.push({page:id,row:0});
  }
  draw(); announce();
}

document.querySelector('#try-music').addEventListener('click', () => {
  showAppPreview('music', true);
  panel.querySelector('[data-key=ok]').focus({preventScroll:true});
});
if(pickerPreview) {
  document.documentElement.classList.add('picker-preview');
  const id=guideApp ?? previewParams.get('app');
  showAppPreview(id,Boolean(guideApp));
  const title=(guideApp ? apps : lists.apps).find(([,page])=>page===id)?.[0] ?? 'Your Apps menu';
  document.querySelector('#home-screen h2').textContent=title;
  const guideIntro = {
    spotify:'Browse sample Liked Songs, Playlists, and Albums. Use Up or Down to choose a category and OK to open it.',
    music:'Try a sample track. Press OK to pause or play, Right to skip, and Up or Down for volume.',
  };
  document.querySelector('#preview-intro').textContent=guideIntro[guideApp] ??
    'Use the buttons on the Flipper to try your selection. This preview uses sample data.';
  const back=document.querySelector('#return-to-picker');
  const selection = lists.apps.filter(([,page])=>apps.some(([,id])=>id===page)).map(([,id])=>id);
  const returnTo = selection.includes(id) ? 'try-'+id : 'try-app-menu';
  back.href='update/?'+new URLSearchParams({apps:selection.join(','),order:(requestedOrder ?? getAppOrder()).join(',')})+'#'+returnTo;
  if(guideApp) {
    back.href=guideApp+'/';
    back.textContent='Back to the '+title+' guide';
  }
  back.hidden=false;
}
window.addEventListener('eddy-apps-changed', () => {
  if(requestedApps || guideApp) return;
  refreshHistory();
  const appView=history.findIndex(entry=>entry.page==='apps');
  const open=history[appView+1];
  if(appView>=0 && open && apps.some(([,id])=>id===open.page) &&
      !lists.apps.some(([,id])=>id===open.page)) history.length=appView+1;
  draw(); announce();
});

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
    if(lists[entry.page]) entry.row=Math.max(0,Math.min(entry.row,lists[entry.page].length-1));
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
  if(formAction==='create') {
    history[history.length-1]={page:'remote',row:0};
    history.push({page:'savedRemote',row:0});
  }
  else if(formAction==='rename') history.pop();
  draw();
  announce();
});

display.addEventListener('click', event=>{
  const state=current();
  const box=display.getBoundingClientRect();
  const x=(event.clientX-box.left)*128/box.width;
  const y=(event.clientY-box.top)*64/box.height;
  if(state.page==='tvPad') {
    if(state.navigation) {
      const arrow=tvNavigationHit(x,y);
      if(arrow) press(arrow);
      return;
    }
    const button=tvPadHit(x,y);
    if(button>=0) { state.row=button; press('ok'); }
    return;
  }
  if (state.page==='pomodoro' && y>=52) {
    press(x<64?'up':'ok');
    return;
  }
  if (state.page==='pomodoro' && !focus.deadline && y>=20 && y<=44) {
    if (x<=26) press('left');
    if (x>=102) press('right');
    return;
  }
  if (!['menu','apps','quick'].includes(state.page)) return;
  const grid=state.page==='apps';
  if(y>=(grid?48:50) || y<(state.page==='menu'?12:8)) return;
  let index;
  if(grid) {
    if(!lists.apps.length) return;
    const page=Math.floor(lists.apps[state.row][2]/8);
    const cell=page*8+Math.floor((y-8)/20)*4+Math.floor(x/32);
    index=lists.apps.findIndex(([, ,slot])=>slot===cell);
    if(index<0) return;
  } else index=Math.min(2,Math.floor(x/42));
  state.row=index;
  if(state.page==='quick' && index<2) { draw(); announce(); }
  else press('ok');
});

for (const key of ['left','right']) {
  const button=panel.querySelector('[data-key='+key+']');
  let repeat, repeated=false;
  function stop() { clearTimeout(repeat); }
  function step() {
    if (current().page!=='pomodoro' || focus.deadline) return;
    repeated=true;
    pomodoroKey(key,true);
    draw(); announce();
    repeat=setTimeout(step,200);
  }
  button.addEventListener('pointerdown',event=>{
    repeated=false;
    if (current().page!=='pomodoro' || focus.deadline || event.button!==0) return;
    button.setPointerCapture(event.pointerId);
    repeat=setTimeout(step,500);
  });
  for (const event of ['pointerup','pointercancel','lostpointercapture','blur']) button.addEventListener(event,stop);
  button.addEventListener('click',event=>{
    if (repeated) { repeated=false; event.stopPropagation(); }
  });
}
const upButton=panel.querySelector('[data-key=up]');
let upTimer;
let heldUp=false;
function startSpotifyUpHold() {
  heldUp=false;
  clearTimeout(upTimer);
  const state=current();
  upTimer=setTimeout(()=>{
    if(current()===state) {
      heldUp=true;
      press('holdUp');
    }
  },600);
}
upButton.addEventListener('pointerdown',event=>{
  heldUp=false;
  if(current().page!=='spotify' || event.button!==0) return;
  upButton.setPointerCapture(event.pointerId);
  startSpotifyUpHold();
});
for(const event of ['pointerup','pointercancel','lostpointercapture','blur']) {
  upButton.addEventListener(event,()=>clearTimeout(upTimer));
}
// Let a focused Up button perform both gestures with native button activation keys.
upButton.addEventListener('keydown',event=>{
  if(current().page!=='spotify' || !['Enter',' '].includes(event.key)) return;
  event.preventDefault();
  if(!event.repeat) startSpotifyUpHold();
});
upButton.addEventListener('keyup',event=>{
  if(current().page!=='spotify' || !['Enter',' '].includes(event.key)) return;
  event.preventDefault();
  clearTimeout(upTimer);
  if(!heldUp) press('up');
  heldUp=false;
});
const okButton=panel.querySelector('[data-key=ok]');
let editTimer;
let heldOk=false;
let editKey=null;
let keyHeld=false;
function hasEditGesture(state) {
  return (state.page==='builder' && state.step==='grid') ||
    (state.page==='btRemote' && !state.mode);
}
function startEditHold(fromKeyboard=false) {
  const state=current();
  clearTimeout(editTimer);
  heldOk=false;
  keyHeld=false;
  editTimer=setTimeout(()=>{
    if(current()!==state || !hasEditGesture(state)) return;
    if(fromKeyboard) keyHeld=true;
    else heldOk=true;
    press('hold');
  },600);
}
okButton.addEventListener('pointerdown',event=>{
  heldOk=false;
  if(!hasEditGesture(current()) || event.button!==0) return;
  okButton.setPointerCapture(event.pointerId);
  startEditHold();
});
for(const event of ['pointerup','pointercancel','lostpointercapture']) {
  okButton.addEventListener(event,()=>clearTimeout(editTimer));
}
okButton.addEventListener('keydown',event=>{
  if(!['Enter',' '].includes(event.key) || (!editKey && !hasEditGesture(current()))) return;
  event.preventDefault();
  if(!event.repeat && !editKey) {
    editKey=event.key;
    startEditHold(true);
  }
});
okButton.addEventListener('keyup',event=>{
  if(event.key!==editKey) return;
  event.preventDefault();
  editKey=null;
  clearTimeout(editTimer);
  if(!keyHeld) press('ok');
});
okButton.addEventListener('blur',()=>{
  clearTimeout(editTimer);
  editKey=null;
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
  if (button===upButton && heldUp) { heldUp=false; return; }
  if (button===okButton && heldOk) { heldOk=false; return; }
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

import {drawInfrared, infraredKey, infraredButtonName} from './infrared-preview.js';
import {text as lcdText, button as lcdButton, submenu} from './lcd.js';
import {boxText, frame} from './lcd-widgets.js';
import {editor, editorKey, drawEditor, openEditor} from './lcd-input.js';
import {getAppOrder, getSelectedApps, restoreAppOrder, launcherColumns, launcherPageSize} from './app-catalog.js';
import {previewCommunity,savedCommunity,previewId} from './community-apps.js';
import {openSpotifyDemo, openSpotifyPlayer, drawSpotify, spotifyStatus, spotifyKey, spotifyHit} from './spotify-demo/spotify-preview.js';
import {startSpotifyTour, spotifyTourSteps} from './spotify-demo/spotify-tour.js';
import {openMusicDemo, drawMusic, musicStatus, musicKey} from './music-preview.js';
import {presetButtons, tvPresetRows, tvPadStatus, tvPadKey, drawTvPad, tvPadHit, tvNavigationHit} from './tv-presets.js';
import {openBuilder, builderKey, builderStatus, drawBuilder} from './builder-preview.js';
import {bluetoothKey, bluetoothStatus, drawBluetooth} from './bluetooth-preview.js';
import {focus, remaining, drawPomodoro, pomodoroKey} from './pomodoro.js';
import {drawMetronome, metronomeInput, metronomeStatus} from './metronome.js';
import {drawLauncher, layoutApps, verticalApp, sections, apps, launcherArt} from './launcher.js';
import {settingsRows, drawQuick, quickStatus, adjustQuick} from './quick-settings.js';
import {listNotes, nameNote} from './observation-preview.js';
import {drawGpio, gpioKey, gpioStatus} from './gpio-preview.js';
import {layoutDemo, remoteDemo} from './remote-preview.js';
import {drawSettings,settingsKey,settingsArt,settingsStatus,radioOn,clockOn} from './device-settings.js';
import {powerLists, powerSamples, powerTitles, powerAction} from './power-preview.js';
import {drawHome, ocean, overlayBattery, sampleCharge} from './home-screen.js';

const panel = document.querySelector('#playable');
const display = panel.querySelector('canvas');
const ctx = display.getContext('2d');
const status = document.querySelector('#preview-state');
const presentSample=document.getElementById('present-sample');
const previewIntro = document.querySelector('#preview-intro');
const homeIntro = previewIntro.textContent;
const lessonCard = document.getElementById('spotify-lesson');
const spotifyButtons = document.getElementById('spotify-buttons');
const lessonStart = document.getElementById('lesson-start');
const lessonRetry = document.getElementById('lesson-retry');
const lessonExit = document.getElementById('lesson-exit');
const lessonHint = document.getElementById('lesson-hint');
let guidedDemo, freeDemo;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const ink = '#432a14';
const titles = {
  irRenameButton:'Rename Button', irMoveButton:'Move Button', irDeleteButton:'Delete Button',
  irLearnSuccess:'Signal decoded', music:'Music', spotify:'Spotify', tvPresets:'Choose your TV', tvPad:'TV remote', builder:'Remotes', btRemote:'Bluetooth Remote', noteList:'Saved observations', noteDetail:'Saved observation',
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
  rfid:['card','Hold tag to',"Flipper's back"],
  nfc:['card','Hold card to',"Flipper's back"],
  ibutton:['contact','Touch key to','the contacts'],
};
const readerTypes = {rfid:'EM4100', nfc:'ISO14443-4A', ibutton:'DS1990'};
const meterPresets = [310000,315000,390000,433920,868350,915000];
const meterBands = [[300000,348000],[387000,464000],[779000,928000]];
const meterLabel = khz => (khz/1000).toFixed(3)+' MHz';
const samples = {
  remoteStorage:['Check browser storage.','Back to return.'],
  pinStorage:['Check browser storage.','Back to return'], pinsFull:['Unpin another remote.','Back to return'], deleteRemote:['Left: Cancel','Right: Delete'],
  tester:['Use the sample button beside the device.'], detected:['Sample IR detected','OK to test another'],
  irLearnSuccess:['Left to retry. Right to save.'], remotes:['No remotes yet'],
  learn:['Point your remote','at the Flipper'],
  battery:[sampleCharge+'% charged','On battery power'], about:['Eddy Firmware','Flipper Zero'],
  passport:['Eddy the dolphin','Level 1'], restart:['OK to restart preview'], shutdown:['OK to power off preview'],
  off:['OK to wake preview'],
};
Object.assign(titles,Object.fromEntries(settingsRows.map(([name,page])=>[page,name])),powerTitles);
titles.remoteStorage='Remote change not saved';
Object.assign(samples,powerSamples);
const lists = {
  tuning:[...meterPresets.map(khz=>[meterLabel(khz)]),...meterBands.map(([lo,hi])=>[`Other: ${lo/1000}-${hi/1000} MHz`])],
  menu:sections.map(([name,page])=>[name,page==='settings'?'quick':page]), apps, settings:settingsRows,
  infrared:[['My remotes','remotes'],['Learn a remote','learn'],['TV presets','tvPresets'],['Button tester','tester']], tvPresets:tvPresetRows,
  editRemote:[['Add Button','add'],['Rename Button','irRenameButton'],['Move Button','irMoveButton'],
    ['Delete Button','irDeleteButton'],['Rename Remote','rename'],['Delete Remote','deleteRemote']],
  ...powerLists,
};
const previewParams = new URLSearchParams(location.search);
const guideApp = document.documentElement.dataset.demo ??
  (previewParams.get('demo') === 'music' ? 'music' : undefined);
export const pickerPreview = Boolean(guideApp) || ['apps','app','community'].some(key => previewParams.has(key));
const requestedApps = previewParams.has('apps') ? new Set(previewParams.get('apps').split(',')) : null;
const orderParam = previewParams.get('order')?.split(',');
const requestedOrder = restoreAppOrder(orderParam);
function communitySelection() {
  const ids=previewParams.has('community')?previewParams.get('community').split(','):savedCommunity();
  return previewCommunity(ids);
}
let visibleShortcuts = [];
function refreshRemotes() {
  const saved=remoteDemo.rows;
  const enabled = requestedApps ?? getSelectedApps();
  visibleShortcuts = remoteDemo.shortcuts.filter(([,type])=>enabled.has('builder') || (type==='remote' && enabled.has('infrared')));
  const community = communitySelection().map(app => {
    const id = previewId(app);
    titles[id] = app.name;

    return [app.name,id];
  });
  lists.apps=layoutApps([...apps.filter(([,id])=>enabled.has(id)),...community,...visibleShortcuts],requestedOrder ?? getAppOrder());
  lists.remotes=saved.length ? saved : [['Learn a remote','learn']];
  titles.remotes=saved.length?'My remotes':'No remotes yet';
  delete samples.remotes;
  titles.remote=remoteDemo.active || 'Remote';
  lists.remote=[
    ...remoteDemo.buttons.map(name=>[name,'command']), ['Add button','add'], ['Edit','editRemote'],
    [remoteDemo.pins.includes(remoteDemo.active)?'Unpin from Apps':'Pin to Apps','pin'],
  ];
  samples.savedRemote=[remoteDemo.active || '', 'Left: Done', 'Right: Pin to Apps'];
  samples.learn=['Use the sample button beside the device.'];
}
refreshRemotes();
let history = [{page:'home',row:0}];
let spotifySession;
function enterSpotify() {
  spotifySession=openSpotifyDemo(spotifySession);
  history.push(spotifySession);
}
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

function noteRows(state) {
  if (!state.notes.length) return [['Back to scan','back']];
  const start=(state.offset || 0);
  return [...(start ? [['Previous page','previous']] : []),
    ...state.notes.slice(start,start+8).map(note=>[note.name,note]),
    ...(start+8<state.notes.length ? [['Next page','next']] : [])];
}

function drawNote(page,row) {
  const state=current();
  if (page==='noteList') {
    submenu(ctx,state.notes.length?'Saved readings':'No readings yet',noteRows(state).map(([label])=>label),row);
    return;
  }
  lcdText(ctx,'Saved observation',2,9);
  boxText(ctx,state.note.name,3,12,122,23);
  ctx.fillRect(3,36,122,1);
  boxText(ctx,state.note.detail,3,39,122,22);
}

function drawReader(page) {
  lcdText(ctx,titles[page],2,9,'primary');
  if (current().detected) {
    lcdText(ctx,'Type detected',3,24);
    boxText(ctx,readerTypes[page],3,26,122,25);
    lcdButton(ctx,'left','Scan');
    lcdButton(ctx,'center','Save');
  } else {
    const [kind,first,second]=readers[page], image=readerArt[kind];
    if (image.naturalWidth) ctx.drawImage(image,1,64-image.naturalHeight);
    lcdText(ctx,'Ready to scan',64,24);
    lcdText(ctx,first,64,39);
    lcdText(ctx,second,64,50);
  }
  lcdButton(ctx,'right','Saved');
}

let meterView;
titles.tuning='Tune receiver';
function tuneMeter(khz) {
  history.pop();
  current().frequency=khz;
  draw();
  announce();
}
function enterFrequency(band) {
  openEditor('Receive frequency (kHz)','',6,value=>tuneMeter(Number(value)),band);
}
function drawMeter(now) {
  const state=current();
  if (meterView!==state) {
    state.readings=[];
    state.sampleTime=now;
    meterView=state;
  }
  const count=Math.floor((now-state.sampleTime)/100);
  if (count>0) {
    for (let n=Math.min(count,120)-1;n>=0;n--) {
      const t=(now-n*100)*0.0009;
      state.readings.push(-102+Math.round(8*Math.sin(t)+48*Math.abs(Math.cos(t*.63))**16));
    }
    state.readings=state.readings.slice(-120);
    state.sampleTime+=count*100;
  }
  lcdText(ctx,'Signal Meter',2,10,'primary');
  lcdText(ctx,meterLabel(state.frequency ?? 433920),125,49,'secondary','right');
  frame(ctx,2,13,124,27);
  state.readings.forEach((v,i)=>{
    const height=Math.max(1,Math.min(24,Math.trunc((v+110)/3)));
    ctx.fillRect(i+4,39-height,1,height);
  });
  if(state.readings.length) {
    lcdText(ctx,state.readings.at(-1)+' dBm',3,49);
    lcdButton(ctx,'center','Save');
  }
  lcdButton(ctx,'left','Tune');
  lcdButton(ctx,'right','Saved');
}

function draw() {
  clearTimeout(timer);
  if (panel.hidden || !inView || document.hidden) return;
  // The physical screen always has 128 by 64 dots, at every browser zoom and pixel density.
  ctx.setTransform(1,0,0,1,0,0);
  const {page,row} = current();
  display.classList.toggle('selectable',['menu','apps','quick','tvPad','pomodoro','spotify'].includes(page));
  const tick = reducedMotion.matches ? 4 : Math.floor(performance.now()/167);
  ctx.clearRect(0,0,128,64);
  ctx.fillStyle = ctx.strokeStyle = ink;
  ctx.imageSmoothingEnabled = false;
  if(page!=='signal' || editor) meterView=undefined;
  if (editor) { drawEditor(ctx); overlayBattery(ctx); return; }
  if (page === 'home') {
    drawHome(ctx,tick % 16,false,radioOn(),clockOn());
  } else if (page === 'menu' || page === 'apps') {
    drawLauncher(ctx,page,row,lists.apps);
  } else if (drawSettings(ctx,current(),settingsRows)) {
    // Native device settings screens draw their own header and controls.
  } else if (page === 'quick') {
    drawQuick(ctx,row);
  } else if (page === 'tvPad') {
    const delay=drawTvPad(ctx,current());
    if(delay) timer=setTimeout(draw,delay);
  } else if (page === 'builder') {
    drawBuilder(ctx,current());
  } else if (page === 'btRemote') {
    drawBluetooth(ctx,current());
  } else if (page === 'gpio') {
    drawGpio(ctx,current());
  } else if (page === 'spotify') {
    if(drawSpotify(ctx,current())) timer=setTimeout(draw,70);
  } else if (page === 'music') {
    if(drawMusic(ctx,current())) timer=setTimeout(draw,500);
  } else if (page === 'metronome') {
    const delay=drawMetronome(ctx,current(),performance.now());
    if (delay) timer=setTimeout(draw,delay);
  } else if (page === 'pomodoro') {
    drawPomodoro(ctx);
  } else if (page==='noteDetail' || page==='noteList') {
    drawNote(page,row);
  } else if (readers[page]) {
    drawReader(page);
  } else if (page==='signal') {
    drawMeter(performance.now());
    timer=setTimeout(draw,100);
  } else if (page==='tuning') {
    submenu(ctx,titles.tuning,lists.tuning.map(([label])=>label),row);
  } else {
    if(!drawInfrared(ctx,current(),titles[page],lists[page])) {
      if(lists[page]) submenu(ctx,page==='editRemote'?'':titles[page],lists[page].map(([label])=>label),row);
      else if(page!=='off') {
        lcdText(ctx,titles[page],2,10,'primary');
        const lines=page==='clock' ? [new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})] : (samples[page] ?? []);
        lines.forEach((line,i)=>lcdText(ctx,line,3,29+i*12));
      }
    }
  }
  if (!['home','off','remote'].includes(page)) overlayBattery(ctx);
  if (page === 'clock' || (page === 'pomodoro' && focus.deadline)) timer=setTimeout(draw,250);
  else if (!reducedMotion.matches && page==='home') {
    timer=setTimeout(draw,167);
  }
}

function announce() {
  const {page,row} = current();
  const reader=readers[page] && !current().detected;
  const ir=['learn','tester'].includes(page) || (page==='builder' && current().step==='learn');
  presentSample.hidden=Boolean(editor) || !(reader || ir);
  if(ir) presentSample.textContent='Send sample infrared signal';
  if(reader) presentSample.textContent='Present sample '+({rfid:'tag',nfc:'card',ibutton:'key'}[page]);
  if(editor) {status.textContent=editor.error || editor.label+'. '+editor.value;return;}
  spotifyButtons.hidden = page !== 'spotify';
  if(!pickerPreview) previewIntro.textContent=page==='spotify'
    ? 'Press Right in your library for Now Playing. Back returns you to the same list.'
    : homeIntro;
  let text = titles[page];
  if (readers[page]) {
    text += current().detected ? '. Type detected. '+readerTypes[page]+'. OK to name and save, or Left to scan again.' :
      '. Ready to scan. '+readers[page].slice(1).join(' ')+'. Use the sample button beside the device.';
    text += ' Right for saved observations.';
  }
  if (page==='noteDetail') text += '. '+current().note.name+'. '+current().note.detail;
  if (page==='noteList') text += '. '+(noteRows(current())[row]?.[0] || current().message || 'No saved observations');
  if(['irRenameButton','irMoveButton','irDeleteButton'].includes(page)) text+=' '+(current().notice || remoteDemo.buttons[row] || '');
  if (samples[page]) text += '. '+samples[page].join('. ');
  if (lists[page]) text += ', '+(lists[page][row]?.[0] ?? 'No apps installed');
  if (page==='remote' && current().sentUntil > performance.now()) text += '. Demo button pressed.';
  if (page==='deleteRemote') text+='. Left to cancel. Right to confirm.';
  if (page==='quick') text+=', '+quickStatus(row);
  if (page==='home' && visibleShortcuts.length) text+='. Down opens '+visibleShortcuts.at(-1)[0];
  if (page==='tvPad') text+='. '+tvPadStatus(current());
  if (page==='builder') text+='. '+(current().name || '')+' '+builderStatus(current());
  if (page==='btRemote') text+='. '+bluetoothStatus(current());
  if (page==='gpio') text=gpioStatus(current());
  if (page!=='off') text += '. Sample battery '+sampleCharge+'%, not charging.';
  if (page==='home') text += ' Press OK for the launcher or Up for quick settings.';
  if (page==='signal') text+='. Sample signal at '+meterLabel(current().frequency ?? 433920)+'. Left to tune, OK to save this reading, Right for saved readings.';
  if (page==='spotify') text += ' '+spotifyStatus(current());
  if (page==='music') text += '. '+musicStatus(current());
  if (page==='metronome') text += '. '+metronomeStatus(current());
  if (page==='pomodoro') text += '. '+Math.ceil(remaining()/1000)+' seconds. '+(focus.deadline?'Running. OK to pause.':'Paused. Left or Right for minutes, Up cycles seconds in five-second steps, OK to start.')+' Down toggles sound. '+(focus.muted?'Muted.':'Sound on.');
  const setting=settingsStatus(current());
  if(setting) text += '. '+setting;
  if(current().notice) text += '. '+current().notice;
  status.textContent=text;
}

function press(key) {
  const state=current(), page=state.page, rows=lists[page];
  document.getElementById('device-preview-notice').textContent='';
  if(editor) {editorKey(key);draw();announce();return;}
  if (infraredKey(state,key,(destination='remote')=>{
    if(current()!==state) return;
    while(history.length>1 && current().page!==destination) history.pop();
    refreshHistory();draw();announce();
  })) {draw();announce();return;}
  if(page==='irLearnSuccess' && key==='right') {
    openRemoteForm(state.adding?'add':'create');return;
  }
  if(page==='gpio' && gpioKey(state,key)) { draw(); announce(); return; }
  if (guidedDemo && state === guidedDemo.state) {
    if (guidedDemo.complete || key !== guidedDemo.step.key) {
      lessonHint.textContent = guidedDemo.complete ? 'Choose Explore freely to keep playing.' :
        guidedDemo.step.hold ? 'Keep the highlighted button pressed for a moment.' : 'Tap the highlighted Flipper button.';
      return;
    }
    spotifyKey(state, key);
    if (guidedDemo.observe(key)) {
      renderLesson();
    } else {
      guidedDemo.retry();
      lessonHint.textContent = 'The sample player moved on. Try that button again.';
    }
    draw();
    announce();
    return;
  }
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
  if(settingsKey(state,key)) { draw(); announce(); return; }
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
    if(key==='ok' && state.readings?.length) beginNote(page,state.readings.at(-1)+' dBm at '+meterLabel(state.frequency ?? 433920));
    if(key==='right') browseNotes(page);
  } else if(page==='tuning' && key==='ok') {
    history[history.length-2].tuningRow=state.row;
    if(state.row<meterPresets.length) tuneMeter(meterPresets[state.row]);
    else enterFrequency(meterBands[state.row-meterPresets.length]);
  } else if(readers[page]) {
    if(key==='left') state.detected=false;
    if(key==='right') browseNotes(page);
    if(key==='ok' && state.detected) beginNote(page,readerTypes[page]);
  } else if(page==='noteList') {
    const items=noteRows(state);
    if(key==='up' || key==='down') state.row=(state.row+(key==='up'?-1:1)+items.length)%items.length;
    if(key==='ok') {
      const [,action]=items[state.row];
      if(action==='back') history.pop();
      else if(action==='previous' || action==='next') {state.offset=(state.offset || 0)+(action==='next'?8:-8);state.row=0;}
      else history.push({page:'noteDetail',row:0,note:action});
    }
  } else if(page==='quick') {
    if(key==='left' || key==='right') state.row=(state.row+(key==='left'?2:1))%3;
    if(key==='up' || key==='down') adjustQuick(state.row,key==='up'?5:-5);
    if(key==='ok' && state.row===2) history.push({page:'settings',row:0});
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
      if(remoteDemo.remove()) {
        while(history.length>1 && !['remotes','apps','infrared'].includes(current().page)) history.pop();
      } else history.push({page:'remoteStorage',row:0});
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
      } else if(next==='rename') openRemoteForm('rename');
      else if(next==='add') history.push({page:'learn',row:0,adding:true});
      else if(next?.startsWith('lab:')) showCommunityNotice(name);
      else {
        if(next==='remote') { remoteDemo.select(name); refreshRemotes(); }
        if(page==='apps' && next==='remote' && (requestedApps ?? getSelectedApps()).has('builder')) history.push(openBuilder(name,'remote'));
        else if(next==='layout' || next==='builder') history.push(openBuilder(next==='layout'?name:undefined));
        else if(next==='music') history.push(openMusicDemo());
        else if(next==='spotify') enterSpotify();
        else if(next==='tvPad') {
          const saved=layoutDemo.addPreset(name,presetButtons(state.row));
          history.push({page:next,profile:state.row,row:2});
          if(!saved) history.push({page:'remoteStorage',row:0});
        }
        else history.push({page:next,row:0});
      }
    }
    else if(page==='apps' && (key==='up' || key==='down')) {
      state.row=verticalApp(rows,state.row,key);
    } else if ((page==='menu' || page==='apps') ? ['left','right'].includes(key) : ['up','down'].includes(key)) {
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
    if(id?.startsWith('lab:')) showCommunityNotice(titles[id]);
    else if(id==='builder') history.push(openBuilder());
    else if(id==='music') history.push(openMusicDemo());
    else if(id==='spotify') enterSpotify();
    else history.push({page:id,row:0});
  }
  draw(); announce();
}

function renderLesson() {
  const step = guidedDemo?.step;
  const complete = guidedDemo?.complete;
  lessonCard.hidden = !guidedDemo;
  lessonStart.hidden = guideApp !== 'spotify' || Boolean(guidedDemo);
  previewIntro.hidden = Boolean(guidedDemo);
  document.documentElement.classList.toggle('guided-preview', Boolean(guidedDemo));
  let cue;
  for (const button of panel.querySelectorAll('[data-key]')) {
    const active = Boolean(step && button.dataset.key === step.key.replace(/^hold/, '').toLowerCase());
    button.classList.toggle('tour-cue', active);
    if (active) {
      cue = button;
      button.setAttribute('aria-describedby', 'lesson-instruction');
    } else button.removeAttribute('aria-describedby');
  }
  if (!guidedDemo) return;
  lessonHint.textContent = '';
  const progress = document.getElementById('lesson-progress');
  progress.max = spotifyTourSteps.length;
  progress.value = guidedDemo.index;
  document.getElementById('lesson-step').textContent = complete ? 'Tour complete' :
    'Step ' + (guidedDemo.index + 1) + ' of ' + spotifyTourSteps.length;
  document.getElementById('lesson-title').textContent = complete ? 'On the Coast is playing.' : step.title;
  document.getElementById('lesson-instruction').textContent = complete ?
    'Explore your own demo library, or take the tour again.' : step.instruction;
  lessonRetry.textContent = complete ? 'Restart tour' : 'Repeat step';
  if (panel.contains(document.activeElement) && document.activeElement.matches(':focus-visible')) {
    (cue ?? lessonExit).focus({preventScroll:true});
  }
}
function beginLessons() {
  if (current().page !== 'spotify') showAppPreview('spotify', true);
  freeDemo = current();
  guidedDemo = startSpotifyTour();
  history[history.length - 1] = guidedDemo.state;
  renderLesson();
  draw();
  announce();
}
lessonStart.addEventListener('click', beginLessons);
lessonRetry.addEventListener('click', () => {
  if (guidedDemo.complete) guidedDemo.restart();
  else guidedDemo.retry();
  renderLesson();
  draw();
  announce();
});
lessonExit.addEventListener('click', () => {
  guidedDemo.exit();
  history[history.length - 1] = freeDemo;
  guidedDemo = freeDemo = null;
  renderLesson();
  draw();
  announce();
  lessonStart.focus({preventScroll:true});
});
if(pickerPreview) {
  document.documentElement.classList.add('picker-preview');
  const requestedApp = guideApp ?? previewParams.get('app');
  // Older links used the bundled Calendar's bare alias.
  const id = requestedApp === 'techart_calendar' ? 'lab:techart_calendar' : requestedApp;
  showAppPreview(id,Boolean(guideApp));
  if (guideApp === 'spotify' && previewParams.get('view') === 'now-playing') {
    openSpotifyPlayer(current());
    draw();
    announce();
  }
  const title=(guideApp ? apps : lists.apps).find(([,page])=>page===id)?.[0] ?? 'Your Apps menu';
  document.querySelector('#home-screen h2').textContent=title;
  const guideIntro = {
    spotify:previewParams.get('view') === 'now-playing'
      ? 'Dolphin Days is playing. Press Down to add it to a playlist.'
      : 'Browse your playlists and saved music. Press Right to open the current song.',
    music:'Try a sample track. Press OK to pause or play, Right to skip, and Up or Down for volume.',
  };
  document.querySelector('#preview-intro').textContent=guideIntro[guideApp] ??
    'Use the buttons on the Flipper to try your selection. This preview uses sample data.';
  const back=document.querySelector('#return-to-picker');
  const selection = lists.apps.filter(([,page])=>apps.some(([,id])=>id===page)).map(([,id])=>id);
  const returnTo = selection.includes(id) ? 'try-'+id : 'try-app-menu';
  back.href='update/?'+new URLSearchParams({apps:selection.join(','),community:communitySelection().map(app=>app.id).join(','),order:(requestedOrder ?? getAppOrder()).join(',')})+'#'+returnTo;
  if (guideApp === 'spotify') {
    back.href = 'spotify/';
    back.textContent = 'Back to Spotify setup';
    if (['library','now-playing'].includes(previewParams.get('view'))) renderLesson();
    else beginLessons();
  } else if (guideApp === 'music') {
    back.href = 'update/#try-music';
    back.textContent = 'Back to app selection';
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

function openRemoteForm(action) {
  const learning=current();
  const save=(name,button)=>{
    const error=remoteDemo.edit(action,name,button);
    if(error) return error;
    refreshHistory();
    if(action==='create') {
      history[history.length-1]={page:'remote',row:0};
      history.push({page:'savedRemote',row:0});
    } else if(action==='add') {
      while(history.length>1 && current().page!=='remote') history.pop();
    } else if(action==='rename') history.pop();
    draw();announce();
  };
  const buttonForm=name=>openEditor('Name the button',infraredButtonName(learning),22,button=>save(name,button));
  if(action==='rename') openEditor('Name the remote',remoteDemo.active,22,name=>save(name,''));
  else if(action==='add') buttonForm(remoteDemo.active);
  else {
    let name='TV';
    const used=new Set(remoteDemo.rows.map(([value])=>value.toLowerCase()));
    for(let i=1;used.has(name.toLowerCase());i++) name='TV'+i;
    openEditor('Name your remote',name,22,value=>{
      if(used.has(value.toLowerCase())) return 'Name already exists';
      buttonForm(value);
    });
  }
}

function showCommunityNotice(name) {
  document.getElementById('device-preview-notice').textContent=name+' opens on your Flipper. This website previews the built-in apps.';
}
function refreshHistory() {
  refreshRemotes();
  for(const entry of history) {
    if(lists[entry.page]) entry.row=Math.max(0,Math.min(entry.row,lists[entry.page].length-1));
  }
}
function lcdPoint(event) {
  const box=display.getBoundingClientRect();
  return [(event.clientX-box.left)*128/box.width,(event.clientY-box.top)*64/box.height];
}

display.addEventListener('click', event=>{
  if (editor) return;
  if (guidedDemo) {
    lessonHint.textContent = guidedDemo.complete ? 'Choose Explore freely to keep playing.' : 'Use the highlighted button on the Flipper.';
    return;
  }
  const state=current();
  const [x,y]=lcdPoint(event);
  if(state.page==='spotify') {
    if(spotifyHit(state,x,y)) { draw(); announce(); }
    return;
  }
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
    press(x<64?'down':'ok');
    return;
  }
  if (state.page==='pomodoro' && !focus.deadline && y>=44 && y<52) { press('up'); return; }
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
    const page=Math.floor(lists.apps[state.row][2]/launcherPageSize);
    const cell=page*launcherPageSize+Math.floor((y-8)/20)*launcherColumns+Math.min(launcherColumns-1,Math.floor(x/42));
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
    pomodoroKey(key);
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
// Delay long-press actions until the threshold and consume the following click.
function holdAction(key, state) {
  if(editor) return key==='ok' ? ()=>press('holdOk') : undefined;
  if (state.page === 'spotify' && key !== 'back') {
    return () => press('hold' + key[0].toUpperCase() + key.slice(1));
  }
  if (key === 'ok' && ((state.page === 'builder' && state.step === 'grid') ||
      (state.page === 'btRemote' && !state.mode))) return () => press('hold');
  if (key === 'back' && state.page === 'home') return () => {
    history.push({page:'shutdown',row:0});
    draw();
    announce();
  };
}

for (const button of panel.querySelectorAll('[data-key]')) {
  const key = button.dataset.key;
  let timer, held = false, activationKey = null;
  function start(action) {
    clearTimeout(timer);
    held = false;
    const state = current();
    timer = setTimeout(() => {
      if (current() !== state || panel.hidden) return;
      held = true;
      action();
    }, 600);
  }
  function cancel() {
    clearTimeout(timer);
    activationKey = null;
  }
  button.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    held = false;
    const action = holdAction(key, current());
    if (!action) return;
    button.setPointerCapture(event.pointerId);
    start(action);
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) {
    button.addEventListener(event, cancel);
  }
  button.addEventListener('contextmenu', event => {
    if (current().page === 'spotify') event.preventDefault();
  });
  button.addEventListener('click', event => {
    if (held) {
      held = false;
      event.stopPropagation();
    }
  });
  button.addEventListener('keydown', event => {
    if (!['Enter',' '].includes(event.key)) return;
    const action = holdAction(key, current());
    if (!action && !activationKey) return;
    event.preventDefault();
    if (!event.repeat && !activationKey) {
      activationKey = event.key;
      start(action);
    }
  });
  button.addEventListener('keyup', event => {
    if (event.key !== activationKey) return;
    event.preventDefault();
    cancel();
    if (!held) press(key);
    held = false;
  });
}
panel.addEventListener('click', event => {
  const button = event.target.closest('[data-key]');
  if (button) press(button.dataset.key);
});
new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; draw(); }).observe(panel);
new ResizeObserver(draw).observe(display);
window.addEventListener('resize',draw);
for(const art of [launcherArt,settingsArt,ocean]) art.addEventListener('load',draw);
document.addEventListener('visibilitychange',draw);
reducedMotion.addEventListener('change',draw);

export function setPreviewVisible(visible) {
  if (visible === !panel.hidden) return;
  panel.hidden = !visible;
  if (visible) announce();
  draw();
}

document.addEventListener('eddy-preview-notice',event=>{
  document.getElementById('device-preview-notice').textContent=event.detail;
});
document.addEventListener('eddy-editor-change',()=>{draw();announce();});
presentSample.addEventListener('click',()=>{
  if(editor) return;
  if(readers[current().page]) {current().detected=true;draw();announce();}
  else press('sample');
});

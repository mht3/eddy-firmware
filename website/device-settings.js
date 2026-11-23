import {text, button, submenu, rounded} from './lcd.js';
import {quickPercent, adjustQuick} from './quick-settings.js';
import {powerValues} from './power-preview.js';

const percent=Array.from({length:21},(_,i)=>i*5+'%');
const onOff=['OFF','ON'];
const panels={
  bluetooth:[['Bluetooth',onOff],['Unpair All Devices']],
  notifications:[
    ['LCD Contrast',Array.from({length:29},(_,i)=>i>10?'+'+(i-10):String(i-10)),10],
    ['LCD Backlight',percent,20], ['Backlight Time',['Always ON','1s','5s','10s','15s','30s','60s','90s','120s','5min','10min','30min'],5],
    ['LED Brightness',percent,20],['Volume',percent,20],['Vibro',onOff,1],
  ],
  desktop:[['PIN Setup'],['Keybinds Setup'],['Reset Keybinds to Default'],['Auto Lock Time',['OFF','10s','15s','30s','60s','90s','2min','5min','10min']],['Show Clock',onOff],['Happy Mode']],
  system:[['Hand Orient',['Righty','Lefty']],['Units',['Metric','Imperial']],['Time Format',['24h','12h']],['Date Format',['D/M/Y','M/D/Y','Y/M/D']],
    ['Log Level',['Default','None','Error','Warning','Info','Debug','Trace']],['Log Device',['USART','LPUART','None']],['Log Baud Rate',['9600','38400','57600','115200','230400','460800','921600','1843200'],3],['Debug',onOff],['Heap Trace',['None','Main','Tree','All']],['Sleep Method',['Default','Legacy']],['File Naming',['Time','Random']]],
  expansion:[['Listen UART',['USART','LPUART','None']]],
  input:[['Buttons Vibro',['OFF','1','2','3','4','5','6','7','8','9']],['Vibro Trigger',['Press','Release','Both']]],
};
const storageItems=['About Internal Storage','About SD Card','Unmount SD Card','Format SD Card','Benchmark SD Card','Factory Reset','Wipe Device'];
const choices = new Map();
const desktopMenus={
  pin:['PIN Code Settings',['Set PIN']],
  type:['Keybind type:',['Press','Hold']],
  key:['Keybind key:',['Up','Down','Right','Left']],
  action:['Keybind action:',['Main App','External App','File / Directory (right btn)','More Actions','Remove Keybind']],
};
function menuRows(state) {
  const [title,labels]=desktopMenus[state.detail];
  const rows=labels.slice();
  if(state.detail==='key' && !state.held) rows[1]='Down: Home shortcut';
  return [title,rows];
}
function desktopDetail(ctx,state) {
  const detail=state.detail;
  if(desktopMenus[detail]) {
    const [title,rows]=menuRows(state);
    submenu(ctx,title,rows,state.index??0);
  } else if(detail==='reset') dialog(ctx,'Reset Desktop Keybinds?',['Your edits will be lost!'],'Cancel','Reset');
  else if(detail==='happy') dialog(ctx,'Happy Mode',['I will never get angry at you','for not spending time with me','as long as this mode is enabled'],state.happy?'Disable':'Go back',state.happy?'Keep enabled':'Enable');
}
function value(page,row) {
  if(page==='notifications' && [1,4].includes(row)) return quickPercent(row===1?0:1)/5;
  return choices.get(page+row) ?? panels[page][row][2] ?? 0;
}
export const radioOn = () => Boolean(value('bluetooth',0));
export const clockOn = () => Boolean(value('desktop',4));
export const settingsArt=new Image();
settingsArt.src=new URL('settings-sprites.png',import.meta.url).href;
const sprites=[[128,64],[46,49],[52,28],[29,14],[16,16],[16,16],[16,16],[16,16],[103,56],[46,33],[121,41],[124,47],[33,32],[98,41]];
function sprite(ctx,index,x,y) {
  if(!settingsArt.naturalWidth) return;
  const [w,h]=sprites[index];
  const top=sprites.slice(0,index).reduce((sum,entry)=>sum+entry[1],0);
  ctx.clearRect(x,y,w,h);
  ctx.drawImage(settingsArt,0,top,w,h,x,y,w,h);
}

function variableList(ctx,rows,selected) {
  const first=Math.max(0,Math.min(selected-1,rows.length-3));
  rows.slice(first,first+3).forEach(([label,values,idx],i)=>{
    const y=16+i*16;
    ctx.save();
    if(first+i===selected) {
      rounded(ctx,0,y+1,123,14,1,true);
      ctx.globalCompositeOperation='destination-out';
    }
    const current=values?.[idx] ?? '';
    const valueX=current.length<4?80:73;
    ctx.save();
    ctx.beginPath(); ctx.rect(6,y,values?(current.length<4?71:66):109,16); ctx.clip();
    text(ctx,label,6,y+12);
    ctx.restore();
    if(values) {
      if(idx>0) text(ctx,'<',valueX,y+12);
      if(idx<values.length-1) text(ctx,'>',115,y+12);
      text(ctx,current,Math.floor((115+valueX)/2)+1,y+12,'secondary','center');
    }
    ctx.restore();
  });
  if(rows.length>3) {
    for(let y=16;y<64;y+=2) ctx.fillRect(126,y,1,1);
    const height=Math.max(3,Math.floor(48/rows.length));
    ctx.fillRect(125,16+Math.round(selected*(48-height)/(rows.length-1)),3,height);
  }
}

function lines(ctx,labels,x,y,font='secondary',align='left') {
  labels.forEach((label,i)=>text(ctx,label,x,y+i*(font==='primary'?12:10),font,align));
}
function dialog(ctx,title,description,left,right) {
  text(ctx,title,64,12,'primary','center');
  lines(ctx,description,64,28,'secondary','center');
  if(left) button(ctx,'left',left);
  if(right) button(ctx,'right',right);
}
const storagePrompts=[
  ['About Internal Storage',['Name: Eddy','Type: Virtual (/.int on SD)']],
  ['About SD Card',['Label: EDDY','Type: FAT32','Total: 16.00 GiB','Free: 12.00 GiB']],
  ['Unmount SD Card?',['Disconnect SD card','from the system?'],'Unmount'],
  ['Format SD Card?',['All data will be lost!'],'Format'],
  ['Benchmark SD Card?',['SD will be tested in SPI','mode. Learn more:','r.flipper.net/sd_test'],'Benchmark'],
  ['Confirm Factory Reset?',['Internal storage will be erased','data and settings will be lost!'],'Erase'],
  ['Confirm full Wipe',['Everything will be erased','Data and settings will be lost!'],'Erase'],
];
const aboutPages=[
  [['Product: Flipper Zero','Model: FZ.1'],['FCC ID: 2A2V6-FZ','IC: 27624-FZ']],
  [['Hardware Info:'],['Name: Eddy','Model: FZ.1']],
  [['Firmware Info:'],['Eddy Firmware','mht3.github.io/','eddy-firmware/']],
  [[],['For all compliance','certificates, please visit:','www.flipp.dev/compliance']],
  [[],['Flipper Devices Inc.','Suite B #551, 2803','Philadelphia Pike, Claymont','DE, USA 19703']],
];
const certPositions=[[13,0],[15,10],[3,3],[3,3],[3,10],[17,4]];
function about(ctx,row) {
  if(row<aboutPages.length) {
    const [header,body]=aboutPages[row];
    lines(ctx,header,0,9,'primary');
    lines(ctx,body,0,header.length*13+7);
  } else {
    const i=row-aboutPages.length;
    sprite(ctx,i+8,...certPositions[i]);
    if(i===1) text(ctx,'210-175991',63,30);
    if(i===3) text(ctx,'2023DJ16420',55,11);
    if(i===4) text(ctx,'CCAJ23LP34D0T3',39,30);
  }
  if(row>0) button(ctx,'left','Prev.');
  if(row<aboutPages.length+certPositions.length-1) button(ctx,'right','Next');
}
function clock(ctx,state) {
  const now = new Date(Date.now()+(state.offset ?? 0));
  const parts=[[now.getHours(),now.getMinutes(),now.getSeconds()],[now.getDate(),now.getMonth()+1,now.getFullYear()],state.alarm ?? [0,0,0]];
  const xs=[[32,66,100],[44,71,98],[58,81,106]], widths=[[28,28,28],[17,17,30],[17,17,22]];
  const ys=[4,30,48], heights=[20,12,12];
  for(let r=0;r<3;r++) {
    const y=ys[r],h=heights[r];
    text(ctx,['Time','Date','Alarm'][r],0,y+(r===0?15:9),'primary');
    parts[r].forEach((n,c)=>{
      const x=xs[r][c], w=widths[r][c], active=state.row===r && (state.col??0)===c;
      ctx.save();
      rounded(ctx,x,y,w,h,1,active);
      if(active)ctx.globalCompositeOperation='destination-out';
      const label=r===2&&c===2?(n?'On':'Off'):String(n).padStart(2,'0');
      text(ctx,label,x+Math.floor(w/2),y+(r===0?17:10),r===0?'big':'primary','center');
      ctx.restore();
      if(active&&state.editing) {
        for(const [ay,sign] of [[y-5,1],[y+h+3,-1]]) {
          ctx.fillRect(x+Math.floor(w/2),ay,1,1); ctx.fillRect(x+Math.floor(w/2)-1,ay+sign,3,1);
        }
      }
    });
  }
  for(const [x,y] of [[62,11],[62,17],[96,11],[96,17],[65,38],[92,38],[77,52],[77,56]])ctx.fillRect(x,y,2,2);
}

export function drawSettings(ctx,state,settingsRows) {
  const {page,row}=state;
  if(page==='settings') submenu(ctx,'Settings',settingsRows.map(([name])=>name),row);
  else if(page==='storage') {
    if(state.detail) { const [title,body,action]=storagePrompts[row]; dialog(ctx,title,body,action?'Cancel':null,action); }
    else submenu(ctx,'Storage',storageItems,row);
  } else if(panels[page]) {
    if(page==='bluetooth' && state.detail) dialog(ctx,'Unpair All Devices?',['All previous pairings','will be lost!'],'Cancel','Unpair');
    else if(page==='desktop' && state.detail) desktopDetail(ctx,state);
    else variableList(ctx,panels[page].map(([label,options],i)=>[label,options,value(page,i)]),row);
  } else if(page==='power') variableList(ctx,powerValues(),row);
  else if(page==='restartOptions') submenu(ctx,'Restart',['Restart device','Firmware upgrade mode'],row);
  else if(page==='shutdown') {
    text(ctx,'Power off?',64,26,'primary','center');
    button(ctx,'left','Cancel'); button(ctx,'right','Power off');
  }
  else if(['shutdown','restart','confirmUpgrade'].includes(page)) {
    const shuttingDown=page==='shutdown', upgrade=page==='confirmUpgrade';
    text(ctx,shuttingDown?'Power off?':upgrade?'Enter upgrade mode?':'Restart device?',64,shuttingDown?26:18,'primary','center');
    if(upgrade) {
      text(ctx,'Needed for device maintenance',64,30,'secondary','center');
      text(ctx,'or firmware upgrades',64,41,'secondary','center');
    }
    button(ctx,'left','Cancel');
    button(ctx,'right',shuttingDown?'Power off':'Restart');
  }
  else if(page==='passport') {
    sprite(ctx,0,0,0); sprite(ctx,1,11,2);
    for(const [y,label] of [[10,'Eddy'],[22,'Mood: Happy'],[34,'Level: 1']]) text(ctx,label,59,y);
    text(ctx,state.total?'0/9999':'0/100',59,42,'tiny');
    ctx.clearRect(59,45,65,5);
  } else if(page==='battery') {
    sprite(ctx,2,0,10);sprite(ctx,3,16,17);
    rounded(ctx,53,0,71,39,4);
    for(const [label,y] of [['Om-nom-nom!',15],['Consumption is',27],['23 mA',39]])text(ctx,label,92,y,'secondary','center');
    ['84%','25 C','4.0 V','100%'].forEach((label,i)=>{
      const x=8+32*i;
      ctx.fillRect(x-7,49,30,1);ctx.fillRect(x-7,61,30,1);
      ctx.fillRect(x-7,49,1,13);ctx.fillRect(x+22,49,1,13);
      sprite(ctx,i+4,x,42);ctx.clearRect(x-4,58,24,6);
      text(ctx,label,x+8,64,'tiny','center');
    });
  } else if(page==='about') about(ctx,row);
  else if(page==='clock') clock(ctx,state);
  else if(page!=='off') return false;
  return true;
}

export function settingsKey(state,key) {
  const {page,row}=state;
  if(page==='settings' || page==='restartOptions') return ['left','right'].includes(key);
  if(page==='passport' && key==='ok') { state.total=!state.total; return true; }
  if(page==='about') {
    if(key==='left'||key==='right') state.row=Math.max(0,Math.min(aboutPages.length+certPositions.length-1,row+(key==='right'?1:-1)));
    return key!=='back';
  }
  if(page==='clock') {
    if(key==='back') { if(!state.editing) return false; state.editing=false; return true; }
    if(key==='ok') state.editing=!state.editing;
    const d=(key==='up'||key==='right')?1:-1;
    if(key==='left'||key==='right') state.col=Math.max(0,Math.min(2,(state.col??0)+d));
    if(key==='up'||key==='down') {
      if(!state.editing)state.row=Math.max(0,Math.min(2,row-d));
      else {
        const col=state.col??0,now=new Date(Date.now()+(state.offset??0));
        if(row===2) {
          state.alarm??=[0,0,0];
          const max=[24,60,2][col]; state.alarm[col]=(state.alarm[col]+d+max)%max;
        } else {
          const methods=[['Hours','Minutes','Seconds'],['Date','Month','FullYear']];
          const unit=methods[row][col]; now['set'+unit](now['get'+unit]()+d);
          state.offset=now.getTime()-Date.now();
        }
      }
    }
    return true;
  }
  const rows=panels[page] ?? (page==='storage'?storageItems:null);
  if(!rows) return false;
  state.notice='';
  if(page==='desktop' && state.detail && desktopMenus[state.detail]) {
    const [title,options]=menuRows(state);
    if(key==='up'||key==='down') state.index=((state.index??0)+options.length+(key==='down'?1:-1))%options.length;
    if(key==='back') {
      state.detail=({action:'key',key:'type'})[state.detail] ?? null;
      state.index=0;
    } else if(key==='ok') {
      if(state.detail==='type') { state.held=state.index===1; state.detail='key'; state.index=0; }
      else if(state.detail==='key' && (state.held || state.index!==1)) { state.detail='action'; state.index=0; }
      else state.notice=title==='Keybind key:'?'Down opens Apps or your pinned remote.':'Continue this setup on your Flipper.';
    }
    if(state.notice) document.dispatchEvent(new CustomEvent('eddy-preview-notice',{detail:state.notice}));
    return true;
  }
  if(state.detail) {
    if(page==='desktop' && state.detail==='happy' && (key==='left'||key==='right')) state.happy=key==='right';
    if(page==='storage' && key==='right' && row>=2) state.notice=storageItems[row]+' runs on the physical device.';
    if(page==='bluetooth' && key==='right' && state.detail) state.notice='Unpairing devices is available on your Flipper.';
    if(state.notice) document.dispatchEvent(new CustomEvent('eddy-preview-notice',{detail:state.notice}));
    if(['back','left','right','ok'].includes(key)) state.detail=false;
    return true;
  }
  if(key==='back') return false;
  if(key==='up'||key==='down')state.row=(row+rows.length+(key==='down'?1:-1))%rows.length;
  else if(key==='ok' && page==='desktop' && [0,1,2,5].includes(row)) {
    state.detail=({0:'pin',1:'type',2:'reset',5:'happy'})[row];
    state.index=0;
  } else if(key==='ok' && (page==='storage'||page==='bluetooth'&&row===1)) state.detail=true;
  else if(key==='left'||key==='right') {
    const opts=panels[page]?.[row]?.[1];
    if(opts) {
      const d=key==='right'?1:-1;
      if(page==='notifications'&&[1,4].includes(row))adjustQuick(row===1?0:1,5*d);
      else choices.set(page+row,Math.max(0,Math.min(opts.length-1,value(page,row)+d)));
    }
  }
  return true;
}

export function settingsStatus(state) {
  const {page,row}=state;
  if(panels[page]) {
    const [name,options]=panels[page][row];
    return state.detail && desktopMenus[state.detail] ? menuRows(state)[1][state.index??0] :
      name+(options?', '+options[value(page,row)]:'');
  }
  if(page==='storage')return storageItems[row];
  return '';
}

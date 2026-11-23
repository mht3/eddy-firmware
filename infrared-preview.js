import {button,text,textWidth,submenu} from './lcd.js';
import {bitmap} from './lcd-widgets.js';
import {box,inverted} from './utility-pixels.js';
import {remoteDemo,layoutDemo} from './remote-preview.js';

import {askName} from './preview-name.js';

const buttonNames=['Power','Vol_up','Vol_dn','Mute','Ch_up','Ch_dn','Ok','Up','Down','Left','Right','Menu','Back','Play','Pause','Stop','Next','Prev','FF','Rew','Input','Exit','Eject','Subtitle'];
const decodeModes=['Auto','Decode','RAW'];
let easy=true, decode=0;

export function infraredButtonName(s) {
  return easy?buttonNames[s.skip || 0]:decode===2?'RAW_67':'NEC_10';
}

function remoteGrid(ctx,s,rows) {
  // ButtonMenu uses ViewOrientationVertical (U8G2_R3): turn the display anti-clockwise.
  ctx.save();
  ctx.transform(0,-1,1,0,0,64);
  const first=Math.floor(s.row/6)*6;
  if(first) bitmap(ctx,'InfraredArrowUp',28,1);
  if(first+6<rows.length) bitmap(ctx,'InfraredArrowDown',28,123);
  ctx.save();
  ctx.beginPath();ctx.rect(3,2,57,13);ctx.clip();
  const name=remoteDemo.active || '';
  if(textWidth(name)>=56) text(ctx,name,3,13);
  else text(ctx,name,32,13,'secondary','center');
  ctx.restore();
  rows.slice(first,first+6).forEach(([label,action],i)=>{
    const lit=first+i===s.row, y=17+18*i, control=action!=='command';
    if(!control || lit) box(ctx,0,y,64,14,control?1:5,lit);
    ctx.save();
    ctx.beginPath();ctx.rect(3,y,58,14);ctx.clip();
    inverted(ctx,lit,()=>text(ctx,label,32,y+10,'secondary','center'));
    ctx.restore();
  });
  ctx.restore();
}

function drawMove(ctx,s) {
  const names=s.draft || remoteDemo.buttons;
  text(ctx,'Select a Button to Move',64,9,'primary','center');
  const first=Math.max(0,Math.min(s.row-1,names.length-4));
  names.slice(first,first+4).forEach((label,i)=>{
    const lit=s.row===first+i, x=lit && s.draft?5:0;
    const y=12+13*i;
    if(lit) box(ctx,x,y,(names.length>4?122:127)-x,13,1,true);
    inverted(ctx,lit,()=>text(ctx,label,x+3,y+10));
  });
  if(names.length>4) {
    for(let y=12;y<64;y+=2) ctx.fillRect(126,y,1,1);
    ctx.fillRect(125,12+Math.floor(52*s.row/names.length),3,Math.max(1,Math.floor(52/names.length)));
  }
}

function commitButtons(names) {
  return layoutDemo.update(remoteDemo.active,names.map(name=>({name})),'remote');
}

function finishEdit(s,message,finish) {
  s.notice=message;
  s.timer=setTimeout(finish,1500);
}

function editKey(s,key,finish) {
  const names=remoteDemo.buttons;
  const move=s.page==='irMoveButton';
  if(s.notice) {
    if(key==='ok' || key==='back') {clearTimeout(s.timer); finish();}
    return true;
  }
  if(s.confirm) {
    if(key==='back' || key==='left') s.confirm=false;
    if(key==='right') {
      if(commitButtons(names.filter((_,i)=>i!==s.row))) finishEdit(s,'Deleted',finish);
      else s.notice='Could not save';
    }
    return true;
  }
  if(key==='back') {
    if(s.draft && !commitButtons(s.draft)) {s.notice='Could not save';return true;}
    return false;
  }
  if(!names.length) return true;
  if(key==='up' || key==='down') {
    const previous=s.row;
    s.row=(previous+names.length+(key==='up'?-1:1))%names.length;
    if(s.draft) [s.draft[previous],s.draft[s.row]]=[s.draft[s.row],s.draft[previous]];
  } else if(key==='ok') {
    if(move) {
      if(s.draft) {
        if(!commitButtons(s.draft)) s.notice='Could not save';
        delete s.draft;
      } else s.draft=names.slice();
    } else if(s.page==='irDeleteButton') s.confirm=true;
    else askName('Name the button',names[s.row],22,value=>{
      if(names.some((name,i)=>i!==s.row && name===value)) return 'Button already exists';
      const updated=names.slice();
      updated[s.row]=value;
      if(!commitButtons(updated)) return 'Could not save';
      finishEdit(s,'Saved',finish); return '';
    });
  }
  return true;
}

export function drawInfrared(ctx,s,title,rows=[]) {
  switch(s.page) {
    case 'irRenameButton': case 'irDeleteButton': case 'irMoveButton':
      if(s.notice==='Saved') {
        bitmap(ctx,'DolphinSaved',0,5); text(ctx,'Saved',125,30,'primary','right');
      } else if(s.notice==='Deleted') {
        bitmap(ctx,'DolphinMafia',0,2); text(ctx,'Deleted',80,19,'primary');
      } else if(s.notice) {
        text(ctx,s.notice,64,32,'primary','center'); button(ctx,'center','OK');
      } else if(s.confirm) {
        text(ctx,'Delete Button?',2,11,'primary');
        text(ctx,remoteDemo.buttons[s.row],64,24,'secondary','center');
        text(ctx,'NEC',64,34,'secondary','center');
        text(ctx,'A=0x20 C=0x10',64,44,'secondary','center');
        button(ctx,'left','Cancel'); button(ctx,'right','Delete');
      } else if(s.page==='irMoveButton') drawMove(ctx,s);
      else submenu(ctx,s.page==='irRenameButton'?'Rename Button:':'Delete Button:',remoteDemo.buttons,s.row);
      return true;
    case 'editRemote':
      submenu(ctx,'',rows.map(([label])=>label),s.row); return true;
    case 'irConfirmRetry': case 'irConfirmExit':
      text(ctx,s.page==='irConfirmRetry'?'Retry Reading?':s.adding?'Exit to Remote Menu?':'Exit to Infrared Menu?',64,20,'primary','center');
      text(ctx,'All unsaved data',64,32,'secondary','center');
      text(ctx,'will be lost!',64,43,'secondary','center');
      button(ctx,'left','Exit');button(ctx,'right','Stay');return true;
    case 'remote':
      remoteGrid(ctx,s,rows); return true;
    case 'tester': case 'detected':
      text(ctx,s.page==='tester'?'Button tester':'Signal detected',2,11,'primary');
      if(s.page==='tester') {
        text(ctx,'Point your remote here',64,30,'secondary','center');
        text(ctx,'and press a button.',64,40,'secondary','center');
      } else {
        text(ctx,'Your remote sent infrared.',64,33,'secondary','center');
        button(ctx,'center','Test another');
      }
      return true;
    case 'learn':
      bitmap(ctx,'InfraredLearnShort',0,22);
      text(ctx,'Aim at IR port.',3,8);
      text(ctx,easy?'Press button:':'Press a remote button.',3,18);
      if(easy) {
        text(ctx,infraredButtonName(s),64,20,'primary');
        if((s.skip || 0)<buttonNames.length-1) button(ctx,'center','Skip');
      }
      button(ctx,'left',easy?'Easy':'Manual'); button(ctx,'right',decodeModes[decode]);
      return true;
    case 'irLearnSuccess':
      bitmap(ctx,'DolphinReadingSuccess',0,1);
      if(decode===2) {
        text(ctx,'Raw signal',94,22,'primary','center');
        text(ctx,'67 samples',94,37,'secondary','center');
      } else {
        text(ctx,'NEC',94,21,'primary','center');
        text(ctx,'A: 0x20',78,32); text(ctx,'C: 0x10',78,42);
      }
      button(ctx,'left','Retry'); button(ctx,'center','Send'); button(ctx,'right','Save'); return true;
    case 'savedRemote': {
      const name=remoteDemo.active || '';
      text(ctx,'Remote saved',64,23,'primary','center');
      if(name.length<=13) text(ctx,name,64,38,'secondary','center');
      else {
        const split=Math.floor(name.length/2);
        text(ctx,name.slice(0,split),64,33,'secondary','center');
        text(ctx,name.slice(split),64,43,'secondary','center');
      }
      button(ctx,'left','Done'); button(ctx,'right','Pin to Apps'); return true;
    }
    case 'deleteRemote':
      text(ctx,'Delete Remote?',2,11,'primary');
      text(ctx,remoteDemo.active,64,29,'secondary','center');
      text(ctx,' with '+remoteDemo.buttons.length+' buttons',64,39,'secondary','center');
      button(ctx,'left','Cancel'); button(ctx,'right','Delete'); return true;
    default: return false;
  }
}

export function infraredKey(s,key,finish) {
  if(['irRenameButton','irMoveButton','irDeleteButton'].includes(s.page)) return editKey(s,key,finish);

  if(s.page==='learn') {
    if(key==='left') easy=!easy;
    else if(key==='right') decode=(decode+1)%decodeModes.length;
    else if(key==='ok' && easy) s.skip=Math.min((s.skip || 0)+1,buttonNames.length-1);
    else if(key==='sample') s.page='irLearnSuccess';
    else if(key==='back') return false;
    return true;
  }
  if(s.page==='irLearnSuccess') {
    if(key==='left') s.page='irConfirmRetry';
    else if(key==='back') s.page='irConfirmExit';
    else if(key==='right') return false; // Save opens the native text editor.
    return true;
  }
  if(s.page==='irConfirmRetry' || s.page==='irConfirmExit') {
    if(key==='right') s.page='irLearnSuccess';
    if(key==='left') {
      if(s.page==='irConfirmRetry') s.page='learn';
      else finish(s.adding?'remote':'infrared');
    }
    return true;
  }
  if(s.page==='tester' || s.page==='detected') {
    if(s.page==='tester' && key==='sample') s.page='detected';
    else if(s.page==='detected' && key==='ok') s.page='tester';
    return key!=='back';
  }
  if(s.page==='remote' && ['left','right','up','down'].includes(key)) {
    const count=remoteDemo.buttons.length+3;
    if(key==='left') s.row=(s.row+count-1)%count;
    if(key==='right') s.row=(s.row+1)%count;
    if(count>6 && key==='up') s.row=(Math.floor(s.row/6)*6+6)% (Math.ceil(count/6)*6);
    if(count>6 && key==='down') s.row=(Math.floor(s.row/6)+Math.ceil(count/6)-1)%Math.ceil(count/6)*6;
    return true;
  }
  return false;
}

import {text,button} from './lcd.js';
import {box,inverted} from './utility-pixels.js';
import {bitmap} from './lcd-widgets.js';
const pins = ['PA7','PA6','PA4','PB3','PB2','PC3','PC1','PC0','ALL'];
const menu = ['USB-UART Bridge','GPIO Manual Control','5V on GPIO','I2C-Scanner','I2C-SFP'];
const views = ['uart','pins',null,'scanner','sfp'];
const settings = [
  ['USB Channel',['0 (CLI)','1']],
  ['Baudrate',['Host','1200','2400','4800','9600','19200','28800','38400','57600','115200','230400','460800','921600']],
  ['UART Pins',['13,14','15,16']],
  ['RTS/DTR Pins',['None','2,3','6,7','16,15']],
  ['DE/RE Pin',['None','4']],
];
const headings = {uart:'USB Serial', pins:'GPIO output', scanner:'I2C scanner', sfp:'SFP module', config:'Bridge settings'};

function rows(state) {
  if(state.view==='config') return settings.map(([label,values],i)=>label+'  '+values[state.values[i]]);
  return menu.map((label,i)=>i===2 ? label+'  '+(state.otg?'ON':'OFF') : label);
}

function details(state) {
  switch(state.view) {
    case 'pins': return ['‹  '+pins[state.pin ?? 0]+'  ›','Hold OK to drive high',''];
    case 'uart': return ['TX: 0 B     RX: 0 B','Pins '+settings[2][1][state.values[2]],'‹ Config'];
    case 'scanner': return ['SDA 15    SCL 16',state.scanned?'No devices found.':'Connect an I2C device.','OK Scan'];
    case 'sfp': return [state.scanned?'No module data. Check pins.':'Connect an SFP module.','Pin 15: SDA   Pin 16: SCL','OK Read'];
    default: return null;
  }
}

export function gpioKey(state,key) {
  state.values ??= settings.map(()=>0);
  if(state.view==='exitUart') {
    if(key==='left') {state.view=null;state.values=settings.map(()=>0);}
    else if(key==='right' || key==='back') state.view='uart';
  } else if(key==='back') {
    if(!state.view) return false;
    state.view=state.view==='config'?'uart':state.view==='uart'?'exitUart':null;
  } else if(!state.view || state.view==='config') {
    const config=state.view==='config';
    const index=config?(state.setting ?? 0):state.row;
    if(key==='up' || key==='down') {
      const count=config?settings.length:menu.length;
      state[config?'setting':'row']=(index+(key==='up'?-1:1)+count)%count;
    } else if(key==='left' || key==='right') {
      if(config) {
        const count=index===3 && state.values[2]?3:settings[index][1].length;
        state.values[index]=Math.max(0,Math.min(count-1,state.values[index]+(key==='left'?-1:1)));
        if(state.values[2] && state.values[3]===3) state.values[3]=0;
      }
      else if(index===2) state.otg=key==='right';
    } else if(key==='ok' && !config && views[index]) {
      state.view=views[index];
      state.scanned=false;
    }
  } else if(state.view==='pins') {
    if(key==='left' || key==='right') state.pin=Math.max(0,Math.min(pins.length-1,(state.pin ?? 0)+(key==='right'?1:-1)));
  } else if(state.view==='uart' && key==='left') {
    state.view='config';
  } else if(['scanner','sfp'].includes(state.view) && key==='ok') {
    state.scanned=true;
  }
  return true;
}

export function gpioStatus(state) {
  if(state.view==='exitUart') return 'Exit USB-UART? Left exits. Right stays.';
  const lines=details(state);
  return (headings[state.view] || 'GPIO')+'. '+(lines?lines.filter(Boolean).join('. '):rows(state)[state.view==='config'?(state.setting ?? 0):state.row]);
}

export function drawGpio(ctx,state) {
  const values=state.values || settings.map(()=>0);
  if(state.view==='exitUart') {
    text(ctx,'Exit USB-UART?',22,21,'primary');
    button(ctx,'left','Exit'); button(ctx,'right','Stay'); return;
  }
  if(state.view==='uart') {
    text(ctx,'USB Serial',2,9,'primary');
    ctx.fillRect(2,10,124,1); ctx.fillRect(44,52,80,1);
    text(ctx,'COM '+values[0],91,8,'secondary','right');
    ['TX:','RX:'].forEach((name,i)=>{
      text(ctx,name,3,25+17*i,'primary');
      text(ctx,'Pin '+(13+values[2]*2+i),22,25+17*i);
      text(ctx,'B.',127,24+17*i,'secondary','right');
      text(ctx,'0',116,24+17*i,'keyboard','right');
      ctx.save();
      if(i) ctx.transform(-1,0,0,-1,62,49);
      bitmap(ctx,'ArrowUpEmpty',i?0:48,i?0:14);
      ctx.restore();
    });
    text(ctx,'Baud: '+(values[1]?settings[1][1][values[1]]:'????'),45,62);
    button(ctx,'left','Config'); return;
  }
  if(state.view && state.view!=='config') {
    text(ctx,headings[state.view],2,9,'primary');
    if(state.view==='pins') {
      text(ctx,'Press < or > to change pin',64,23,'secondary','center');
      text(ctx,pins[state.pin || 0],64,39,'secondary','center');
      text(ctx,'Hold OK to drive high',64,61,'secondary','center');
    } else if(state.view==='scanner') {
      text(ctx,'SDA 15   SCL 16',2,21);
      if(state.scanned) text(ctx,'0 found',126,21,'secondary','right');
      text(ctx,state.scanned?'No devices found.':'Connect an I2C device.',2,40);
      button(ctx,'center','Scan');
    } else {
      text(ctx,state.scanned?'No module data. Check pins.':'Connect an SFP module.',2,27);
      text(ctx,'Pin 15: SDA   Pin 16: SCL',2,42); button(ctx,'center','Read');
    }
    return;
  }
  const config=state.view==='config', selected=(config?state.setting:state.row) || 0;
  const labels=config?settings.map(([label])=>label):menu;
  const start=Math.max(0,Math.min(selected-1,labels.length-3));
  labels.slice(start,start+3).forEach((label,i)=>{
    const index=start+i, y=16+i*16, lit=index===selected;
    const options=config?settings[index][1]:index===2?['OFF','ON']:[];
    const value=config?values[index]:Number(Boolean(state.otg));
    if(lit) box(ctx,0,y+1,123,14,2,true);
    inverted(ctx,lit,()=>{
      text(ctx,label,6,y+12);
      if(!options.length) return;
      const x=options[value].length<4?80:73;
      if(value>0) text(ctx,'<',x,y+12);
      text(ctx,options[value],1+Math.floor((115+x)/2),y+12,'secondary','center');
      const count=config && index===3 && values[2]?3:options.length;
      if(value<count-1) text(ctx,'>',115,y+12);
    });
  });
  for(let y=16;y<64;y+=2) ctx.fillRect(126,y,1,1);
  ctx.fillRect(125,16+Math.floor(48*selected/labels.length),3,Math.floor(48/labels.length));
}

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
    case 'pins': return ['‹  '+pins[state.pin ?? 0]+'  ›','OK to pulse output',state.pulsed?'Pulse sent':''];
    case 'uart': return ['TX: 0 B     RX: 0 B','Pins '+settings[2][1][state.values[2]],'‹ Config'];
    case 'scanner': return ['SDA 15    SCL 16',state.scanned?'No devices found.':'Connect an I2C device.','OK Scan'];
    case 'sfp': return [state.scanned?'No module data. Check pins.':'Connect an SFP module.','Pin 15: SDA   Pin 16: SCL','OK Read'];
    default: return null;
  }
}

export function gpioKey(state,key) {
  state.values ??= settings.map(()=>0);
  if(key==='back') {
    if(!state.view) return false;
    state.view=state.view==='config'?'uart':null;
  } else if(!state.view || state.view==='config') {
    const config=state.view==='config';
    const index=config?(state.setting ?? 0):state.row;
    if(key==='up' || key==='down') {
      const count=config?settings.length:menu.length;
      state[config?'setting':'row']=(index+(key==='up'?-1:1)+count)%count;
    } else if(key==='left' || key==='right') {
      if(config) state.values[index]=Math.max(0,Math.min(settings[index][1].length-1,state.values[index]+(key==='left'?-1:1)));
      else if(index===2) state.otg=key==='right';
    } else if(key==='ok' && !config && views[index]) {
      state.view=views[index];
      state.scanned=false;
      state.pulsed=false;
    }
  } else if(state.view==='pins') {
    state.pulsed=key==='ok';
    if(key==='left' || key==='right') state.pin=Math.max(0,Math.min(pins.length-1,(state.pin ?? 0)+(key==='right'?1:-1)));
  } else if(state.view==='uart' && key==='left') {
    state.view='config';
  } else if(['scanner','sfp'].includes(state.view) && key==='ok') {
    state.scanned=true;
  }
  return true;
}

export function gpioStatus(state) {
  const lines=details(state);
  return (headings[state.view] || 'GPIO')+'. '+(lines?lines.filter(Boolean).join('. '):rows(state)[state.view==='config'?(state.setting ?? 0):state.row]);
}

export function drawGpio(ctx,state) {
  ctx.font='bold 9px monospace';
  ctx.fillText(headings[state.view] || 'GPIO',3,2,87);
  ctx.fillRect(0,13,128,1);
  ctx.font='9px sans-serif';
  const lines=details(state);
  if(lines) {
    lines.forEach((label,i)=>ctx.fillText(label,4,18+15*i,119));
    return;
  }
  const selected=state.view==='config'?(state.setting ?? 0):state.row;
  const labels=rows(state), start=Math.max(0,selected-2);
  labels.slice(start,start+3).forEach((label,i)=>{
    const y=17+15*i;
    if(start+i===selected) {
      ctx.fillRect(2,y-1,124,13);
      ctx.fillStyle='#ffbe70';
    }
    ctx.fillText(label,5,y+1,118);
    ctx.fillStyle='#432a14';
  });
}

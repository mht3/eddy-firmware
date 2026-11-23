import {icons} from './lcd-icons.js';
import {text, textWidth, glyphAdvance} from './lcd.js';

export function bitmap(ctx, name, x, y) {
  const [width, data] = icons[name];
  const stride = Math.ceil(width / 8);
  for (let offset=0; offset<data.length; offset+=2) {
    const byte=parseInt(data.slice(offset,offset+2),16);
    const index=offset/2;
    for (let bit=0; bit<8; bit++) {
      if (byte & (1 << bit)) ctx.fillRect(x+index%stride*8+bit,y+Math.floor(index/stride),1,1);
    }
  }
}

export function frame(ctx,x,y,w,h,rounded=false) {
  const inset=rounded ? 1 : 0;
  ctx.fillRect(x+inset,y,w-2*inset,1);
  ctx.fillRect(x+inset,y+h-1,w-2*inset,1);
  ctx.fillRect(x,y+1,1,h-2);
  ctx.fillRect(x+w-1,y+1,1,h-2);
}

// elements_text_box uses the glyph advance for wrapping and the stock secondary
// font's minimum/default leading of 9/11 pixels to fit the available height.
export function boxText(ctx,value,x,y,width,height) {
  const lines=[];
  let line='', used=0;
  const limit=Math.floor(height/9);
  if(!limit) return;
  for(const char of value) {
    const advance=glyphAdvance(char);
    if(char==='\n' || used+advance>width) {
      lines.push(line);
      line=''; used=0;
      if(lines.length===limit) break;
    }
    if(char!=='\n') {line+=char; used+=advance;}
  }
  if(lines.length<limit) lines.push(line);
  const roomy=11*lines.length<height;
  const baseline=y+7+(roomy?Math.floor((height-11*lines.length)/2):0);
  const spacing=roomy?11:10;
  const ellipsisWidth=textWidth('...');
  lines.forEach((label,index)=>{
    if(index===lines.length-1) {
      let used=0;
      for(let i=0;i<label.length;i++) {
        used+=glyphAdvance(label[i]);
        if(used+ellipsisWidth>width) {label=label.slice(0,i)+'...'; break;}
      }
    }
    text(ctx,label,x,baseline+spacing*index);
  });
}

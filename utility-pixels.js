import {rounded} from './lcd.js';

// Match the integer line and midpoint-circle rasterization used by u8g2.
export function line(ctx,x,y,endX,endY) {
  const steep=Math.abs(endY-y)>Math.abs(endX-x);
  if(steep) { [x,y]=[y,x]; [endX,endY]=[endY,endX]; }
  if(x>endX) { [x,endX]=[endX,x]; [y,endY]=[endY,y]; }
  const dx=endX-x, dy=Math.abs(endY-y), step=y<endY?1:-1;
  let error=Math.floor(dx/2);
  for(;x<=endX;x++) {
    ctx.fillRect(steep?y:x,steep?x:y,1,1);
    error-=dy;
    if(error<0) { y+=step; error+=dx; }
  }
}

export function circle(ctx,x,y,r) {
  rounded(ctx,x-r,y-r,2*r+1,2*r+1,r);
}

export function box(ctx,x,y,w,h,r=0,filled=false) {
  rounded(ctx,x,y,w,h,r,filled);
}

export function inverted(ctx,selected,render) {
  ctx.save();
  if(selected) ctx.globalCompositeOperation='destination-out';
  render();
  ctx.restore();
}

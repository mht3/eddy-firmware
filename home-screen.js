export const sampleCharge = 84;

export function drawBattery(ctx, charging = false) {
  ctx.save();
  ctx.fillStyle = ctx.strokeStyle = '#432a14';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(99.5,1.5,23,7,1.5);
  ctx.stroke();
  ctx.fillRect(124,4,1,2);
  const fill = Math.round(22*sampleCharge/100);
  ctx.fillRect(100,2,fill,6);
  ctx.font = 'bold 7px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = sampleCharge+'%';
  ctx.fillText(label,111,5.3);
  ctx.save();
  ctx.beginPath();
  ctx.rect(100,2,fill,6);
  ctx.clip();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillText(label,111,5.3);
  ctx.restore();
  if (charging) {
    ctx.beginPath();
    ctx.moveTo(97.5,1.5); ctx.lineTo(94.5,5.5); ctx.lineTo(97.5,5.5); ctx.lineTo(95.5,8.5);
    ctx.stroke();
  }
  ctx.restore();
}

// The same 16-frame animation shipped on Eddy's microSD image.
export const ocean = new Image();
ocean.src = new URL('eddy-ocean.png', import.meta.url).href;

export function drawHome(ctx, frame, charging = false) {
  ctx.fillStyle = '#432a14';
  ctx.font = 'bold 8px monospace';
  ctx.textBaseline = 'top';
  ctx.fillText('EDDY', 5, 2);
  ctx.fillRect(0, 11, 128, 1);
  drawBattery(ctx, charging);
  if (ocean.naturalWidth) {
    ctx.drawImage(ocean, frame * 128, 0, 128, 50, 0, 14, 128, 50);
  }
}

// Continuous outlines of the same dolphin pose for the enlarged browser display.
// All coordinates are in LCD units. The caller supplies a display-density transform.
const face = new Path2D('M46 44 Q48 42 52 39 L53 34 C50 32 46 29 45.7 24 C45 20 46.7 16.8 50 16.5 Q52.5 16.1 56 17.1 C57.5 10 61 5 68.7 2.8 Q76.7 .5 83 3.4 C91 6.9 95.9 12.4 97 19.6 Q99 29.9 98 41 L99 42.2 Q84 45.3 67 44.7 Z');
const smile = new Path2D('M46.8 23.2 Q51.3 20.9 55 23.6 C61 27.1 65.4 31.6 69.2 33.3 Q76.1 35.2 77.6 29.6 M55.6 17.2 Q60 19.5 68.4 23.8 M52.9 32.9 Q57.3 38 66.8 39.5 M70.6 39.1 Q73.6 36.9 74.6 40.1');
const eye = new Path2D('M73.7 25.8 Q74.7 24.7 75 23.9 C74.2 17.6 77.6 13.8 82.2 14.6 C86.3 14.7 88.9 18.8 88.1 23.6 Q87.8 26.6 84.7 28.7 Q84.3 24.3 80.3 24.2 Q76.2 23.8 73.7 25.8 Z');
const fin = new Path2D('M29.7 41.9 C27.6 39.2 29.7 33.2 32.8 32.9 Q35.2 32.2 37 33.1 Q35.9 28.2 38.1 27.6 Q41.6 26 41.4 30.7 L41.5 37.7 Q43.7 40.1 46.8 42.8 M37 33 Q40.4 36.9 35.5 42.8');
const ripples = new Path2D('M0 15.5 Q10.5 13.7 17.5 15.6 M19.5 11.4 Q27.2 9.5 36.5 11.5 M97.4 12.5 Q102 12.2 106.5 13.6 M117 17.5 Q124 16 128 16.6 M7.4 6.5 Q9.5 6.4 11.6 8.4 Q13.4 6.5 15.5 6.3 M104.5 4.6 Q106.6 4.7 108.5 6.6 Q110.5 4.7 112.5 4.5');

export function drawCloseUpHome(ctx, frame, charging = false) {
  const ink = '#432a14';
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = ink;
  ctx.font = 'bold 8px monospace';
  ctx.textBaseline = 'top';
  ctx.fillText('EDDY',5,1);
  ctx.fillRect(0,11,128,0.8);
  drawBattery(ctx, charging);
  ctx.translate(0,14);
  ctx.lineWidth = .86;
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.stroke(ripples);
  const phase = frame*Math.PI/8;
  for (const [radius,height] of [[64,13.6],[51,10.5],[37,7.4],[24,4.5]]) {
    ctx.beginPath();
    const drift = Math.sin(phase+radius)*.075;
    for (const [from,to] of [[.14,2.27],[2.77,4.56],[5.08,5.84]]) {
      ctx.moveTo(64+radius*Math.cos(from+drift),34+height*Math.sin(from+drift));
      ctx.ellipse(64,34,radius,height,0,from+drift,to+drift);
    }
    ctx.stroke();
  }
  ctx.translate((Math.cos(phase)-1)*2.4,Math.sin(phase)*.9);
  // Clear the water behind the character, leaving the model's amber LCD visible.
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fill(face);
  ctx.fill(fin);
  ctx.globalCompositeOperation = 'source-over';
  ctx.stroke(face);
  ctx.stroke(smile);
  ctx.stroke(fin);
  if (frame === 11) {
    ctx.stroke(new Path2D('M75.5 23.6 Q81.6 17.3 87.8 22.6'));
  } else {
    ctx.stroke(eye);
    ctx.fill(new Path2D('M77.3 24.1 C76.2 19.9 78.7 16.3 82.2 16.7 C87.1 16.9 88.3 23.5 85.3 27.8 Q83 23.3 77.3 24.1 Z'));
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();ctx.arc(79.9,19.9,1.75,0,2*Math.PI);ctx.fill();
  }
  ctx.restore();
}

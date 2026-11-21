// The same 16-frame animation shipped on Eddy's microSD image.
export const ocean = new Image();
ocean.src = new URL('eddy-ocean.png', import.meta.url).href;

export function drawHome(ctx, frame) {
  ctx.fillStyle = '#432a14';
  ctx.font = 'bold 8px monospace';
  ctx.textBaseline = 'top';
  ctx.fillText('EDDY', 5, 2);
  ctx.fillRect(0, 11, 128, 1);
  ctx.fillRect(106, 2, 17, 7);
  ctx.clearRect(107, 3, 15, 5);
  ctx.fillRect(108, 4, 12, 3);
  ctx.fillRect(123, 4, 2, 3);
  if (ocean.naturalWidth) {
    ctx.drawImage(ocean, frame * 128, 0, 128, 50, 0, 14, 128, 50);
  }
}

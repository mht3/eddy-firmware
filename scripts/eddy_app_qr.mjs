import {writeFileSync} from 'node:fs';
import qrcode from './vendor/qrcode-generator-2.0.4.mjs';

function appBitmap(url) {
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  const modules = qr.getModuleCount();
  const size = 64;
  const origin = Math.floor((size - modules) / 2);
  if (origin < 4) throw Error('The Eddy app QR code does not fit the Flipper screen.');
  const bytes = new Uint8Array(size * size / 8);
  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (qr.isDark(row, col)) {
        const bit = (origin + row) * size + origin + col;
        bytes[bit >> 3] |= 1 << (bit & 7);
      }
    }
  }
  return bytes;
}

const resource = new URL('../applications/main/eddy_spotify/assets/iphone_app.xbm', import.meta.url);
writeFileSync(resource, appBitmap('https://mht3.github.io/eddy-firmware/app/?open=1'));

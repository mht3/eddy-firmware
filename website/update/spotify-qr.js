import qrcode from './vendor/qrcode-generator-2.0.4.js';

// The fragment stays on the scanning phone. The firmware displays this XBM without resizing it.
export function spotifySignInBitmap(clientId) {
  if (!/^[a-f0-9]{32}$/i.test(clientId)) throw Error('Invalid Spotify Client ID.');
  const qr = qrcode(0, 'M');
  qr.addData('https://mht3.github.io/eddy-firmware/s/#' + clientId);
  qr.make();
  const modules = qr.getModuleCount();
  const size = 64;
  const origin = Math.floor((size - modules) / 2);
  if (origin < 4) throw Error('The Spotify sign-in code does not fit the Flipper screen.');
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

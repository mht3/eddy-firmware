import {scanQr} from '../spotify/session.js';

function signIn() {
  scanQr().catch(error => {
    document.getElementById('status').textContent = error.name === 'SecurityError' || error.name === 'QuotaExceededError' ?
      'Allow session storage in this browser and scan your Flipper’s QR code again.' : error.message;
  });
}

const id = location.hash.slice(1);
const applePhone = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (applePhone && !navigator.bluetooth?.requestDevice && /^[a-f0-9]{32}$/i.test(id)) {
  document.getElementById('status').textContent =
    'Open the installed Eddy iPhone prototype to link Spotify and use your Flipper over Bluetooth.';
  document.getElementById('open-eddy').href = 'eddyspotify://setup?client_id=' + id;
  document.getElementById('iphone-actions').hidden = false;
  document.getElementById('browser-signin').onclick = signIn;
} else signIn();

import {scanQr} from '../spotify/session.js';

scanQr().catch(error => {
  document.getElementById('status').textContent = error.name === 'SecurityError' || error.name === 'QuotaExceededError' ?
    'Allow session storage in this browser and scan the QR again.' : error.message;
});

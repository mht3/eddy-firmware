import {spotifyClientId, spotifyConfigured} from './config.js';

const availability = document.getElementById('bridge-availability');
const scanned = location.hash === '#link';
const callback = new URLSearchParams(location.search);
if (scanned || callback.has('code') || callback.has('error')) {
  const library = document.getElementById('personal-library');
  document.querySelector('.music .intro').after(library);
  library.scrollIntoView({behavior: 'instant'});
}
if (!spotifyConfigured) {
  availability.textContent = 'Account linking is currently unavailable on this site. Try the sample library above.';
} else if (!window.isSecureContext || !navigator.bluetooth) {
  availability.textContent = 'This browser cannot connect the Spotify library to your Flipper. Open this page in Chrome on a Mac, PC or Android phone, then choose Link Spotify. Your iPhone can still play the music.';
} else {
  availability.textContent = 'Account linking is available to the developer and invited testers. Keep this tab open while browsing on your Flipper.';
  const {startBridge} = await import('./bridge.js');
  await startBridge(spotifyClientId, scanned);
}

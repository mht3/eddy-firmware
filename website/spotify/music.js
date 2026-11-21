import {spotifyClientId, spotifyConfigured} from './config.js';

const availability = document.getElementById('bridge-availability');
if (!spotifyConfigured) {
  availability.textContent = 'Account linking is currently unavailable on this site. Try the sample library above.';
} else if (!window.isSecureContext || !navigator.bluetooth) {
  availability.textContent = 'To link your Flipper, open this page in Chrome on a Mac, PC or Android phone. You can still play the music on your iPhone.';
} else {
  availability.textContent = 'Account linking is available to invited testers. Keep this tab open while browsing on your Flipper.';
  const {startBridge} = await import('./bridge.js');
  await startBridge(spotifyClientId);
}

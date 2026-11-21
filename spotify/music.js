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

const forkInput=document.querySelector('#setup-fork');
const siteField=document.querySelector('#setup-site');
const callbackField=document.querySelector('#setup-callback');
const variablesLink=document.querySelector('#setup-variables');
const exampleSite=siteField.textContent;
const forkNote=document.querySelector('#fork-note');
const emptyNote=forkNote.textContent;
function updateFork() {
  const value=forkInput.value.trim().replace(/\.git\/?$/i,'');
  const match=/^(?:https:\/\/github\.com\/|github\.com\/)?([a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38})\/([a-z\d_.-]{1,100})\/?$/i.exec(value);
  const valid=match && !['.','..'].includes(match[2]);
  let site=exampleSite;
  if(valid) {
    const host=match[1].toLowerCase()+'.github.io';
    site='https://'+host+'/'+(match[2].toLowerCase()===host?'':match[2]+'/');
    variablesLink.href='https://github.com/'+match[1]+'/'+match[2]+'/settings/variables/actions';
  } else variablesLink.removeAttribute('href');
  variablesLink.hidden=!valid;
  siteField.textContent=site;
  callbackField.textContent=site+'spotify/';
  forkNote.textContent=valid?'Your setup addresses are ready below.':value?'Enter a GitHub project as username/repository.':emptyNote;
}
document.querySelector('#fork-helper').hidden=false;
forkInput.addEventListener('input',updateFork);

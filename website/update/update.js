import {catalog,defaultAppOrder,getAppOrder,getSelectedApps} from '../app-catalog.js';
import {prepareInstall,makeDownload} from './package.js';
import {getCommunitySelection,setCommunityRelease} from '../community-apps.js';
import {FlipperUpdater} from './flipper.js';

const root = new URL('../firmware/',import.meta.url);
const action = document.querySelector('#action');
const connection = document.querySelector('#connection');
const progress = document.querySelector('#progress');
const picker = document.querySelector('#app-picker');
const download = document.querySelector('#download');
const lab = document.querySelector('#lab');
const spotifySettings = document.querySelector('#spotify-settings');
const spotifyClientId = document.querySelector('#spotify-client-id');
let build;
let flipper;
let operation = null;

function updateControls() {
  const busy = Boolean(operation);
  spotifySettings.hidden = !getSelectedApps().has('spotify');
  spotifyClientId.disabled = busy || spotifySettings.hidden;
  picker.disabled = busy;
  action.disabled = busy || !build || !isSecureContext || !navigator.serial;
  download.disabled = busy || !build;
  const stockLayout = getAppOrder().every((id,i)=>id===defaultAppOrder[i]);
  lab.hidden = busy || !lab.hasAttribute('href') || getSelectedApps().size !== catalog.length || !stockLayout || getCommunitySelection().length>0 || Boolean(spotifyClientId.value.trim());
}
window.addEventListener('eddy-apps-changed', updateControls);
spotifyClientId.addEventListener('input', updateControls);

function selectedClientId() {
  return getSelectedApps().has('spotify') ? spotifyClientId.value.trim() : '';
}

function validSpotifySetting() {
  spotifyClientId.value = spotifyClientId.value.trim();
  return spotifyClientId.reportValidity();
}

async function checkedFetch(url,options) {
  const response = await fetch(url,options);
  if (!response.ok) throw Error('The build could not be downloaded. Refresh to try again.');
  return response;
}

function link(selector,url) {
  const a = document.querySelector(selector);
  a.href = url;
  a.hidden = false;
  return a;
}

async function loadBuild() {
  const status = document.querySelector('#build-status');
  try {
    const data = await (await checkedFetch(new URL('main.json',root),{cache:'no-cache'})).json();
    if (!data) {
      status.textContent = 'The first Eddy main build has not been published yet.';
      return;
    }
    if (!/^eddy-[\w.-]+$/.test(data.version) || data.target !== 'f7' ||
        data.file !== 'flipper-z-f7-update-'+data.version+'.tgz') throw Error('This package is not a valid Flipper Zero update.');
    const archive = new URL(data.file,root);
    await checkedFetch(archive,{method:'HEAD'});
    status.textContent = data.version;
    if (/^[a-f0-9]{40}$/.test(data.commit)) link('#source','https://github.com/mht3/eddy-firmware/tree/'+data.commit);
    if (!Array.isArray(data.parts) || !data.parts.some(p=>p.name === 'update.fuf') ||
        data.parts.some(p=> !/^[\w-]+(?:\.[\w-]+)+$/.test(p.name) || !Number.isSafeInteger(p.size) ||
          p.size<=0 || !/^[a-f0-9]{64}$/.test(p.sha256) || !/^[a-f0-9]{32}$/.test(p.md5)) ||
        new Set(data.parts.map(p=>p.name)).size !== data.parts.length) throw Error('This release is missing verified update components.');
    if (!catalog.every(app=>data.resourceIndex?.apps?.[app.appId]) ||
        !Number.isSafeInteger(data.resourceIndex?.launcherOrder)) throw Error('Refresh for a release with an editable app layout.');
    if (!window.CompressionStream || !window.DecompressionStream || !crypto.subtle) {
      throw Error('Open this page in a current browser over HTTPS to prepare your selection.');
    }
    if (location.protocol === 'https:') {
      const labUrl = new URL('https://lab.flipper.net/');
      labUrl.search = new URLSearchParams({url:archive.href,target:'f7',channel:'release-cfw',version:data.version});
      lab.href = labUrl;
    }
    build = data;
    setCommunityRelease(data.communityApps);
    download.hidden = false;
    connection.textContent = navigator.serial && isSecureContext ? 'No device connected.' :
      'For USB installation, open this page in desktop Chrome or Edge. You can also download your selection for qFlipper.';
    updateControls();
  } catch (error) {
    connection.textContent = error.message;
    status.textContent = 'Release unavailable.';
  }
}

async function install() {
  const files = await prepareInstall(build,getSelectedApps(),name=>{
    connection.textContent = 'Verifying '+name+'…';
  },getAppOrder(),getCommunitySelection(),selectedClientId());
  const resources = files.find(({part})=>part.name==='resources.tar.gz');
  const folder = '/ext/update/f7-update-'+build.version+'-'+resources.part.sha256.slice(0,12);
  await flipper.mkdir('/ext/update');
  await flipper.mkdir(folder);
  progress.max = files.reduce((sum,f)=>sum+f.bytes.length,0);
  progress.value = 0;
  progress.hidden = false;
  let sent = 0;
  for (const {part,bytes} of files) {
    connection.textContent = 'Copying '+part.name+' to the microSD card…';
    await flipper.upload(folder+'/'+part.name,bytes,part.md5,n=>{progress.value=sent+n;});
    sent += bytes.length;
  }
  connection.textContent = 'Checking the package on your Flipper…';
  await flipper.install(folder);
}

async function releasePort() {
  const session = flipper;
  flipper = null;
  if (session) await session.close();
}

action.addEventListener('click',async () => {
  if (operation || !build) return;
  if (flipper && !validSpotifySetting()) return;
  operation = 'usb';
  updateControls();
  try {
    if (flipper) {
      await install();
      connection.textContent = 'Your Flipper accepted the update. Keep it connected and follow the progress on its screen through the restart.';
      action.textContent = 'Reconnect Flipper Zero';
      await releasePort();
    } else {
      progress.hidden = true;
      const port = await navigator.serial.requestPort({filters:[{usbVendorId:0x0483,usbProductId:0x5740}]});
      flipper = new FlipperUpdater(port);
      connection.textContent = 'Checking the device and microSD card…';
      await flipper.open();
      connection.textContent = 'Flipper Zero connected. Return to its home screen before installing.';
      action.textContent = 'Install '+build.version;
    }
  } catch (error) {
    await releasePort();
    action.textContent = 'Connect Flipper Zero';
    connection.textContent = error.name === 'NotFoundError' ? 'No device selected.' : error.message;
    progress.hidden = true;
  } finally {
    operation = null;
    updateControls();
  }
});

download.addEventListener('click', async () => {
  if (operation || !build) return;
  if (!validSpotifySetting()) return;
  operation = 'download';
  updateControls();
  try {
    const files=await prepareInstall(build,getSelectedApps(),name=>{
      connection.textContent='Verifying '+name+'…';
    },getAppOrder(),getCommunitySelection(),selectedClientId());
    const blob=await makeDownload(build,files);
    const url=URL.createObjectURL(blob);
    const digest=files.find(({part})=>part.name==='resources.tar.gz').part.sha256;
    const anchor=document.createElement('a');
    anchor.href=url;
    anchor.download=build.version+'-'+digest.slice(0,12)+'.tgz';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    connection.textContent='Your package is ready. In qFlipper, choose Install from file and select the downloaded TGZ.';
  } catch(error) {
    connection.textContent=error.message;
  } finally {
    operation = null;
    updateControls();
  }
});

navigator.serial?.addEventListener('disconnect',async event => {
  if (operation === 'usb' || event.target !== flipper?.port) return;
  // The independent qFlipper download can finish after a USB cable is unplugged.
  await releasePort();
  action.textContent = 'Connect Flipper Zero';
  if (!operation) connection.textContent = 'Device disconnected.';
});
loadBuild();

import {FlipperUpdater} from './flipper.js';

const root = new URL('../firmware/',import.meta.url);
const action = document.querySelector('#action');
const connection = document.querySelector('#connection');
const progress = document.querySelector('#progress');
let build;
let flipper;
let busy = false;

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
        data.file !== 'flipper-z-f7-update-'+data.version+'.tgz') throw Error('Invalid F7 release.');
    const archive = new URL(data.file,root);
    await checkedFetch(archive,{method:'HEAD'});
    status.textContent = data.version;
    link('#download',archive).download = data.file;
    if (/^[a-f0-9]{40}$/.test(data.commit)) link('#source','https://github.com/mht3/eddy-firmware/tree/'+data.commit);
    if (!isSecureContext || !navigator.serial) {
      connection.textContent = 'For USB installation, open this page in desktop Chrome or Edge over HTTPS, or use the qFlipper download.';
      return;
    }
    if (location.protocol === 'https:') {
      const lab = new URL('https://lab.flipper.net/');
      lab.search = new URLSearchParams({url:archive.href,target:'f7',channel:'release-cfw',version:data.version});
      link('#lab',lab);
    }
    if (!Array.isArray(data.parts) || !data.parts.some(p=>p.name === 'update.fuf') ||
        data.parts.some(p=> !/^[\w-]+(?:\.[\w-]+)+$/.test(p.name) || !Number.isSafeInteger(p.size) ||
          p.size<=0 || !/^[a-f0-9]{64}$/.test(p.sha256) || !/^[a-f0-9]{32}$/.test(p.md5)) ||
        new Set(data.parts.map(p=>p.name)).size !== data.parts.length) throw Error('USB installation components are unavailable. Use the qFlipper download.');
    build = data;
    connection.textContent = 'No device connected.';
    action.disabled = false;
  } catch (error) {
    connection.textContent = error.message;
    if (!document.querySelector('#download').href) status.textContent = 'Release unavailable.';
  }
}

async function install() {
  const folder = '/ext/update/f7-update-'+build.version;
  const files = [];
  connection.textContent = 'Verifying the main build…';
  for (const part of build.parts) {
    const response = await checkedFetch(new URL(build.version+'/'+part.name,root));
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
    const hex = Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');
    if (hex !== part.sha256 || bytes.length !== part.size) throw Error('The download failed verification.');
    files.push({part,bytes});
  }
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
  if (busy || !build) return;
  busy = true;
  action.disabled = true;
  let accepted = false;
  try {
    if (flipper) {
      await install();
      accepted = true;
      connection.textContent = 'Your Flipper accepted the update. Keep it connected and follow the progress on its screen through the restart.';
      action.textContent = 'Update started';
      await releasePort();
    } else {
      progress.hidden = true;
      const port = await navigator.serial.requestPort({filters:[{usbVendorId:0x0483,usbProductId:0x5740}]});
      flipper = new FlipperUpdater(port);
      connection.textContent = 'Checking the device and microSD card…';
      await flipper.open();
      connection.textContent = 'Flipper Zero F7 connected. Return to its home screen before installing.';
      action.textContent = 'Install '+build.version;
    }
  } catch (error) {
    await releasePort();
    action.textContent = 'Connect Flipper Zero';
    connection.textContent = error.name === 'NotFoundError' ? 'No device selected.' : error.message;
    progress.hidden = true;
  } finally {
    busy = false;
    action.disabled = accepted;
  }
});

navigator.serial?.addEventListener('disconnect',async event => {
  if (busy || event.target !== flipper?.port) return;
  await releasePort();
  action.textContent = 'Connect Flipper Zero';
  connection.textContent = 'Device disconnected.';
});
loadBuild();

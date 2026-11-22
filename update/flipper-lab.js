import {verifyCatalogFap} from './fap.js';

const firmwareRoot = new URL('../firmware/', import.meta.url);
const catalogRoot = 'https://catalog.flipperzero.one/api/v0';
const aliasPattern = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const versionPattern = /^[0-9a-f]{24}$/;
const apiPattern = /^(\d+)\.(\d+)$/;
const maxFapSize = 16 * 1024 * 1024;
const snapshots = new Map();

export class LabFileRequired extends Error {
  constructor(appName, downloadUrl) {
    super('Download ' + appName + ' from Flipper Lab, then choose the downloaded .fap file here.');
    this.name = 'LabFileRequired';
    this.appName = appName;
    this.downloadUrl = downloadUrl;
  }
}

function compatibleSdk(api, targetApi) {
  const build = apiPattern.exec(api), firmware = apiPattern.exec(targetApi);
  return build && firmware && build[1] === firmware[1] && Number(build[2]) <= Number(firmware[2]);
}

async function readSnapshot(indexUrl) {
  const response = await fetch(indexUrl, {cache:'no-cache', redirect:'error'});
  if (!response.ok) throw Error('The Flipper Lab app list could not be loaded. Try again.');
  const snapshot = await response.json();
  if (!snapshot.apps || typeof snapshot.apps !== 'object' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.date)) {
    throw Error('The Flipper Lab app list is incomplete. Refresh the installer.');
  }
  return snapshot;
}

async function readMirror(url, message) {
  const response = await fetch(url, {redirect:'error'});
  if (!response.ok) throw Error(message);
  return response;
}

async function checkDigest(bytes, expected) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hex = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  if (hex !== expected) throw Error('This file differs from the official Flipper Lab package. Download the listed version and try again.');
}

// Flipper Lab grants browser CORS access to its own site. Read the public catalog
// snapshot from this Eddy release, then verify each mirror or user-chosen package.
export async function fetchLabApp(alias, compatibility, file) {
  if (typeof alias !== 'string' || !aliasPattern.test(alias)) throw Error('Use the link from a Flipper Lab app page.');
  if (!compatibility || compatibility.target !== 'f7' || !apiPattern.test(compatibility.api) ||
      !/^eddy-[\w.-]+\/lab\/index\.json$/.test(compatibility.catalog)) {
    throw Error('Refresh for an Eddy release that supports Flipper Lab imports.');
  }
  const indexUrl = new URL(compatibility.catalog, firmwareRoot);
  if (!snapshots.has(indexUrl.href)) {
    snapshots.set(indexUrl.href, readSnapshot(indexUrl).catch(error => {
      snapshots.delete(indexUrl.href);
      throw error;
    }));
  }
  const snapshot = await snapshots.get(indexUrl.href);
  if (snapshot.target !== compatibility.target || snapshot.api !== compatibility.api) {
    throw Error('This Flipper Lab app list belongs to a different release. Refresh the installer.');
  }
  const record = Object.hasOwn(snapshot.apps, alias) && snapshot.apps[alias];
  if (!record) throw Error('This link is missing from the Flipper Lab list updated ' + snapshot.date + '. Check the app link or try a newer Eddy release.');
  const {name, description, versionId, api, sha256, mirrored} = record;
  if (!versionPattern.test(versionId) || typeof name !== 'string' || !name.trim()) {
    throw Error('The catalog entry is missing its app details.');
  }
  if (!compatibleSdk(api, compatibility.api) || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw Error('Flipper Lab has no compatible Flipper Zero build of ' + name + ' for this Eddy release.');
  }
  const versionUrl = catalogRoot + '/1/application/version/' + versionId;
  const downloadUrl = versionUrl + '/build/f7/' + api;
  const sourceUrl = mirrored ? new URL(alias + '.source.zip', indexUrl).href :
    catalogRoot + '/application/version/' + versionId + '/bundle';
  if (!mirrored && !file) throw new LabFileRequired(name, downloadUrl);

  let data;
  if (file instanceof Uint8Array) {
    data = file;
  } else {
    if (!file) {
      const res = await readMirror(new URL(alias + '.fap', indexUrl), 'The app download failed. Try again.');
      file = await res.blob();
    }
    if (!(file instanceof Blob) || file.size > maxFapSize) throw Error('Choose a Flipper app package under 16 MB.');
    data = new Uint8Array(await file.arrayBuffer());
  }
  if (!data.length || data.length > maxFapSize) throw Error('Choose a Flipper app package under 16 MB.');
  await checkDigest(data, sha256);
  const {iconHex} = verifyCatalogFap(data, compatibility);
  let license;
  if (mirrored) {
    const notice = await readMirror(new URL(alias + '.LICENSE.txt', indexUrl), 'The app license could not be downloaded. Try again.');
    license = await notice.text();
    if (!license.trim()) throw Error('This app is missing its license notice.');
    license += '\nCorresponding source: ' + sourceUrl + '\n';
  }
  return {id:alias, name, description:typeof description === 'string' ? description : '', data, sha256, license, sourceUrl, iconHex};
}

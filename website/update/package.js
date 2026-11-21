import {catalog,defaultAppOrder,getAppOrder,validAppOrder} from '../app-catalog.js';
import {md5} from './md5.js';

const firmwareRoot = new URL('../firmware/',import.meta.url);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const block = 512;

async function sha256(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  return Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');
}

function gzip(blob) {
  return new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob();
}

function finalizeHeader(header,size) {
  // POSIX tar checksums include the header with the checksum field filled with spaces.
  header.set(encoder.encode(size.toString(8).padStart(11,'0')+'\0'),124);
  header.fill(32,148,156);
  const checksum = header.reduce((sum,b)=>sum+b,0);
  header.set(encoder.encode(checksum.toString(8).padStart(6,'0')+'\0 '),148);
  return header;
}

function padding(size) {
  return new Uint8Array((block-size%block)%block);
}

function locateEntry(tar,offset,name) {
  if (!Number.isSafeInteger(offset) || offset<0 || offset%block || offset+block>tar.length) {
    throw Error('Invalid app index in this release.');
  }
  const header = tar.subarray(offset,offset+block);
  const headerName = decoder.decode(header.subarray(0,100)).split('\0')[0];
  const octal = decoder.decode(header.subarray(124,136)).replace(/[\0 ]+$/,'');
  if (headerName!==name || !/^[0-7]+$/.test(octal) || (header[156]!==48 && header[156]!==0)) {
    throw Error('The release app index does not match its resource archive.');
  }
  const size = parseInt(octal,8), dataStart=offset+block;
  const end = dataStart+Math.ceil(size/block)*block;
  if (end>tar.length) throw Error('Incomplete resource archive.');
  return {offset,end,header,data:tar.subarray(dataStart,dataStart+size)};
}

function replaceEntry(entry,data) {
  return {...entry,replacement:[finalizeHeader(entry.header.slice(),data.length),data,padding(data.length)]};
}

async function filterResources(bytes,index,excluded,order) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const tar = new Uint8Array(await new Response(stream).arrayBuffer());
  const manifest = locateEntry(tar,index.manifest,'Manifest');
  const edits = [], omit = new Set();
  for (const {appId} of excluded) {
    const record = index.apps[appId];
    edits.push(locateEntry(tar,record.offset,record.name));
    omit.add(record.name);
  }
  const layoutPath = 'eddy/launcher_order.txt';
  const layout = locateEntry(tar,index.launcherOrder,layoutPath);
  const layoutData = encoder.encode(order.join('\n')+'\n');
  edits.push(replaceEntry(layout,layoutData));
  const keep = [];
  let hasLayout = false;
  for(const line of decoder.decode(manifest.data).split('\n')) {
    const row = /^F:[a-f0-9]{32}:\d+:(.+?)\r?$/.exec(line);
    if (row && omit.delete(row[1])) continue;
    if (row && row[1]===layoutPath) {
      if(hasLayout) throw Error('Duplicate launcher layout in this release.');
      hasLayout = true;
      keep.push('F:'+md5(layoutData)+':'+layoutData.length+':'+layoutPath);
    } else keep.push(line);
  }
  if (!hasLayout) throw Error('The launcher layout is missing from the resource manifest.');
  if (omit.size) throw Error('The installed-app manifest is incomplete.');
  const updated = encoder.encode(keep.join('\n'));
  edits.push(replaceEntry(manifest,updated));
  const pieces = [];
  let cursor=0;
  for (const edit of edits.sort((a,b)=>a.offset-b.offset)) {
    if (edit.offset<cursor) throw Error('Overlapping resource entries.');
    pieces.push(tar.subarray(cursor,edit.offset));
    if (edit.replacement) pieces.push(...edit.replacement);
    cursor=edit.end;
  }
  pieces.push(tar.subarray(cursor));
  const compressed = await gzip(new Blob(pieces));
  return new Uint8Array(await compressed.arrayBuffer());
}

export async function prepareInstall(build,selectedIds,onPart,order=getAppOrder()) {
  if (!build.resourceIndex?.apps || !Number.isSafeInteger(build.resourceIndex.launcherOrder) ||
      !build.parts.some(part=>part.name==='resources.tar.gz')) {
    throw Error('This release does not include an editable launcher. Refresh for the latest build.');
  }
  for (const {appId} of catalog) {
    const path = build.resourceIndex.apps[appId]?.name;
    if (typeof path!=='string' || !path.startsWith('apps/') || !path.endsWith('/'+appId+'.fap')) {
      throw Error('The release is missing an app from the catalog.');
    }
  }
  const selected = new Set(selectedIds);
  if ([...selected].some(id=>!catalog.some(app=>app.id===id))) throw Error('Unknown app selection.');
  if (!validAppOrder(order)) throw Error('Invalid app order. Reload the installer to try again.');
  const excluded = catalog.filter(app=>!selected.has(app.id));
  const files = [];
  for (const part of build.parts) {
    onPart?.(part.name);
    const response = await fetch(new URL(build.version+'/'+part.name,firmwareRoot));
    if (!response.ok) throw Error('The build could not be downloaded. Try again.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length!==part.size || await sha256(bytes)!==part.sha256) {
      throw Error('The download failed verification.');
    }
    files.push({part,bytes});
  }
  if (excluded.length || order.some((id,i)=>id!==defaultAppOrder[i])) {
    const resources = files.find(({part})=>part.name==='resources.tar.gz');
    const bytes = await filterResources(resources.bytes,build.resourceIndex,excluded,order);
    resources.bytes=bytes;
    resources.part={...resources.part,size:bytes.length,sha256:await sha256(bytes),md5:md5(bytes)};
  }
  return files;
}

function packageHeader(name,size,directory=false) {
  const header = new Uint8Array(block);
  const path = encoder.encode(name);
  if (path.length>100) throw Error('The package name is too long.');
  header.set(path);
  header.set(encoder.encode(directory?'0000755\0':'0000644\0'),100);
  header.set(encoder.encode('0000000\0'+'0000000\0'),108);
  header.set(encoder.encode('00000000000\0'),136);
  header[156]=directory?53:48;
  header.set(encoder.encode('ustar\0'+'00'),257);
  return finalizeHeader(header,size);
}

export async function makeDownload(build,files) {
  const digest = files.find(({part})=>part.name==='resources.tar.gz').part.sha256;
  const folder = 'f7-update-'+build.version+'-'+digest.slice(0,12);
  const parts = [packageHeader(folder+'/',0,true)];
  for (const {part,bytes} of files) {
    parts.push(packageHeader(folder+'/'+part.name,bytes.length),bytes,padding(bytes.length));
  }
  parts.push(new Uint8Array(2*block));
  return new Blob([await gzip(new Blob(parts))],{type:'application/gzip'});
}

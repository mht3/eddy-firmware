import {authorize, callback, libraryPage, linked, pageSize, PlaybackError, playLibraryItem, unlink} from './spotify.js';

const uuid = n => 'efdd000' + n + '-5a34-4a32-9fab-1f72e60d00ed';
const get = id => document.getElementById(id);
const categories = new Map([[0x10, 'track'], [0x18, 'playlist'], [0x19, 'album']]);
const next = 0x11, previous = 0x12, hello = 0x15, dismiss = 0x16, playRow = 0x20;

function decodeCommand(value) {
  if (value?.byteLength !== 5) return;
  const op = value.getUint8(0), token = value.getUint16(1, true), base = value.getUint16(3, true);
  const standalone = categories.has(op) || op === hello || op === dismiss;
  if (!token || (standalone ? base !== 0 : !base)) return;
  if (standalone || op === next || op === previous || (op >= playRow && op < playRow + pageSize)) {
    return {op, token, base};
  }
}

function showLibraryLinks(rows = []) {
  const list = get('library-links');
  const items = [];
  for (const {label, href} of rows) {
    if (!href) continue;
    const link = document.createElement('a');
    link.href = href;
    link.textContent = label;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const item = document.createElement('li');
    item.append(link);
    items.push(item);
  }
  list.replaceChildren(...items);
  list.hidden = !items.length;
}

function packet(op, token, ...data) {
  return Uint8Array.of(op, token & 255, token >>> 8, ...data);
}

function pagePackets(page, token) {
  const packets = [packet(0x10, token)];
  for (const [row, song] of page.rows.entries()) {
    const text = new Uint8Array(80);
    const {written} = new TextEncoder().encodeInto(song.label.replace(/[\x00-\x1f\x7f]/g, ' '), text);
    for (let i = 0; i < written; i += 16) {
      packets.push(packet(0x11, token, row, ...text.subarray(i, Math.min(i + 16, written))));
    }
  }
  const offset = new Uint8Array(4);
  new DataView(offset.buffer).setUint32(0, page.offset, true);
  packets.push(packet(0x12, token, page.rows.length, Number(page.hasPrev), Number(page.hasNext), ...offset));
  return packets;
}

async function connect(device, onCommand, onDrop) {
  device ??= await navigator.bluetooth.requestDevice({
    filters: [0x3080, 0x3081, 0x3082, 0x3083].map(service => ({services: [service]})),
    optionalServices: [uuid(1)],
  });
  let controls;
  function notification(event) {
    const command = decodeCommand(event.target.value);
    if (command) onCommand(command);
  }
  function detach() {
    controls?.removeEventListener('characteristicvaluechanged', notification);
    device.removeEventListener('gattserverdisconnected', dropped);
  }
  function dropped() { detach(); onDrop(); }
  try {
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(uuid(1));
    const state = await service.getCharacteristic(uuid(2));
    controls = await service.getCharacteristic(uuid(3));
    controls.addEventListener('characteristicvaluechanged', notification);
    await controls.startNotifications();
    if (!device.gatt.connected) throw new Error('Disconnected while pairing.');
    device.addEventListener('gattserverdisconnected', dropped);
    let lastWrite = Promise.resolve();
    return {
      grantedDevice: device,
      name: device.name || 'Flipper',
      write(bytes, stillActive = () => true) {
        // Web Bluetooth permits a single in-flight GATT operation, including hello.
        const operation = lastWrite.then(() => {
          if (stillActive()) return state.writeValueWithResponse(bytes);
        });
        lastWrite = operation.catch(() => {});
        return operation;
      },
      close() { detach(); if (device.gatt.connected) device.gatt.disconnect(); },
    };
  } catch (error) {
    detach();
    if (device.gatt.connected) device.gatt.disconnect();
    throw error;
  }
}

export async function startBridge(id) {
  let session, lastDevice, pending = false, cooldown = 0;
  let attempt = 0;
  const droppedMessage = 'Bluetooth disconnected. Open Apps → Spotify on your Flipper, then select Reconnect Flipper here.';
  const notice = text => { get('notice').textContent = text; };
  function render() {
    const ready = linked(id);
    get('link').hidden = ready;
    get('pair').hidden = !ready || Boolean(session);
    get('pair').textContent = lastDevice ? 'Reconnect Flipper' : 'Choose Flipper';
    get('unlink').hidden = !ready;
    get('disconnect').hidden = !session;
    get('pair').disabled = get('link').disabled = get('unlink').disabled = get('disconnect').disabled = pending;
  }
  async function disconnect(message, goodbye = false) {
    showLibraryLinks();
    if (session) {
      const old = session;
      session = null;
      clearTimeout(old.timer);
      old.controller?.abort();
      if (goodbye) {
        pending = true;
        render();
        // A sleeping or unplugged device must not block local sign-out.
        let timeout;
        try {
          await Promise.race([old.device.write(Uint8Array.of(0x16)),
            new Promise(resolve => { timeout = setTimeout(resolve, 1000); })]);
        } catch {} finally { clearTimeout(timeout); }
        pending = false;
      }
      old.device.close();
    }
    render();
    notice(message);
  }
  function forgetPage(current) {
    current.controller?.abort();
    current.active = current.waiting = current.page = null;
    showLibraryLinks();
  }
  function heartbeat(current) {
    current.timer = setTimeout(async () => {
      if (current !== session) return;
      // Background tabs can be suspended past the firmware's bridge timeout.
      const op = Date.now() - current.lastSeen >= 40000 ? 0x15 : 0x17;
      if (op === hello) forgetPage(current);
      try { await current.device.write(Uint8Array.of(op), () => session === current); }
      catch { if (session === current) disconnect(droppedMessage); return; }
      if (session === current) {
        current.lastSeen = Date.now();
        heartbeat(current);
      }
    }, 10000);
  }

  // The Flipper permits one outstanding transaction. Starting the app again sends a
  // fresh first-page command and invalidates the previous foreground app's request.
  async function respond(current, request) {
    if (session !== current || !current.device) return;
    const {op, token, base} = request;
    if (op === dismiss) { forgetPage(current); return; }
    if (op === hello) {
      forgetPage(current);
      try { await current.device.write(Uint8Array.of(hello), () => session === current); }
      catch { if (session === current) disconnect(droppedMessage); }
      return;
    }
    const first = categories.has(op);
    if (current.active?.token === token) return;
    if (first) {
      forgetPage(current);
    } else if (current.active) {
      // A selection can arrive while the last GATT write response is still in flight.
      current.waiting = request;
      return;
    }
    current.waiting = null;
    current.active = request;
    const controller = new AbortController();
    current.controller = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
    const active = () => session === current && current.active === request;
    let writing = false;
    async function send(bytes) {
      if (!active()) return;
      writing = true;
      await current.device.write(bytes, active);
      writing = false;
    }
    try {
      if (!first && current.page?.token !== base) {
        throw new PlaybackError(3, 'The displayed page changed. Reopen the library section and try again.');
      }
      if (Date.now() < cooldown) throw new PlaybackError(4, 'Spotify is busy. Wait a moment before retrying.');
      if (op >= playRow) {
        const row = op - playRow;
        // A retransmitted acknowledgement must not start the song a second time.
        if (current.page.lastPlay !== token) {
          await playLibraryItem(id, current.page, row, signal);
          if (!active()) return;
          current.page.lastPlay = token;
        }
        await send(packet(0x14, token, row));
        if (active()) notice('Playback requested on your active Spotify device.');
      } else {
        showLibraryLinks();
        if ((op === next && !current.page.hasNext) || (op === previous && !current.page.hasPrev)) {
          throw new PlaybackError(3, 'The library has no page in that direction.');
        }
        const offset = first ? 0 : current.page.offset + (op === next ? pageSize : -pageSize);
        const kind = first ? categories.get(op) : current.page.kind;
        const page = await libraryPage(id, kind, offset, signal);
        for (const bytes of pagePackets(page, token)) {
          if (!active()) return;
          await send(bytes);
        }
        if (!active()) return;
        current.page = {...page, token};
        showLibraryLinks(page.rows);
        notice(page.rows.length ? 'Your library page is ready on the Flipper.' : 'This section of your library is empty.');
      }
    } catch (error) {
      if (!active()) return;
      showLibraryLinks();
      if (writing) { disconnect(droppedMessage); return; }
      const issue = error instanceof PlaybackError ? error : new PlaybackError(2, 'Connection interrupted. Retry on your Flipper.');
      if (issue.retryMs) cooldown = Date.now() + issue.retryMs;
      notice(issue.message);
      try { await send(packet(0x13, token, issue.code)); }
      catch { if (active()) disconnect(droppedMessage); return; }
      if (active() && issue.code === 1) { lastDevice = null; unlink(); disconnect(issue.message); }
    } finally {
      if (active()) {
        current.active = null;
        if (current.waiting) respond(current, current.waiting);
      }
    }
  }

  get('link').onclick = async () => {
    pending = true;
    render();
    try { await authorize(id); }
    catch { pending = false; render(); notice('Allow session storage in this tab and try linking Spotify again.'); }
  };
  get('pair').onclick = async () => {
    pending = true;
    render();
    notice(lastDevice ? 'Reconnecting to your Flipper…' : 'Choose your Flipper and leave Apps → Spotify open.');
    const current = {};
    const sequence = ++attempt;
    try {
      current.device = await connect(lastDevice, request => respond(current, request), () => {
        if (session === current) disconnect(droppedMessage);
      });
      if (sequence !== attempt || !linked(id)) { current.device.close(); return; }
      session = current;
      lastDevice = current.device.grantedDevice;
      notice('Connected to ' + current.device.name + '. Open Apps → Spotify to browse your library.');
      await current.device.write(Uint8Array.of(0x15));
      if (session === current) {
        current.lastSeen = Date.now();
        heartbeat(current);
      }
    } catch (error) {
      if (sequence !== attempt) return;
      // Allow a fresh chooser after a failed reconnect (for example, a forgotten OS pairing).
      lastDevice = null;
      const message = error.name === 'NotFoundError' ? 'No Flipper selected. You can choose again.' :
        'Pairing did not finish. Open Apps → Spotify, check Bluetooth and try again.';
      if (session === current) disconnect(message);
      else notice(message);
    } finally { pending = false; render(); }
  };
  get('disconnect').onclick = () => { lastDevice = null; return disconnect('Flipper disconnected.', true); };
  get('unlink').onclick = () => { ++attempt; lastDevice = null; unlink(); return disconnect('Spotify unlinked from this tab.', true); };
  window.addEventListener('pagehide', () => { ++attempt; lastDevice = null; disconnect(''); });
  get('bridge').hidden = false;
  pending = true;
  render();
  try { await callback(id); }
  catch (error) { notice(error.message); }
  pending = false;
  render();
}

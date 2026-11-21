import {addTrack, authorize, callback, controlPlayer, libraryPage, linked, pageSize, PlaybackError, playLibraryItem, queueTrack, selectedRow, unlink} from './spotify.js';

const uuid = n => 'efdd000' + n + '-5a34-4a32-9fab-1f72e60d00ed';
const get = id => document.getElementById(id);
const categories = new Map([[0x10, 'track'], [0x18, 'playlist'], [0x19, 'album'], [0x1a, 'track'], [0x1b, 'artist'], [0x1c, 'now'], [0x1e, 'queue']]);
const next = 0x11, previous = 0x12, hello = 0x15, dismiss = 0x16, parent = 0x1d;
const playRow = 0x20, artistRow = 0x24, queueRow = 0x28, chooseRow = 0x30, addRow = 0x34, collectionRow = 0x38;
const rowOperations = [playRow, artistRow, queueRow, chooseRow, addRow, collectionRow];

function decodeCommand(value) {
  if (!value || value.byteLength < 5 || value.byteLength > 20) return;
  const op = value.getUint8(0), token = value.getUint16(1, true), base = value.getUint16(3, true);
  const control = op >= 0x40 && op <= 0x42;
  const standalone = control || categories.has(op) || op === hello || op === dismiss;
  let query;
  if (op === 0x1a || op === 0x1b) {
    try {
      const bytes = new Uint8Array(value.buffer, value.byteOffset + 5, value.byteLength - 5);
      query = new TextDecoder('utf-8', {fatal:true}).decode(bytes).trim();
    } catch { return; }
    if (!query || /[\x00-\x1f\x7f]/.test(query)) return;
  } else if (value.byteLength !== 5) return;
  if (!token || (standalone ? base !== 0 : !base)) return;
  const action = rowOperations.find(start => op >= start && op < start + pageSize);
  if (standalone || op === next || op === previous || op === parent || action !== undefined) {
    return {op, token, base, query, control, action, row:op - action};
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
  const packets = [page.playState === undefined ? packet(0x10, token) : packet(0x10, token, page.playState)];
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

export async function startBridge(id, scanned = false) {
  let session, lastDevice, pending = false, cooldown = 0;
  let attempt = 0, retryTimer, retryIndex = 0;
  const retryDelays = [1000, 3000, 6000, 12000, 24000, 30000];
  const droppedMessage = 'Waiting for your Flipper. Leave this tab open and turn your Flipper back on.';
  const notice = text => { get('notice').textContent = text; };
  function render() {
    const ready = linked(id);
    get('link').hidden = ready;
    get('pair').hidden = !ready || Boolean(session);
    get('pair').textContent = lastDevice ? 'Reconnect Flipper' : 'Choose Flipper';
    get('unlink').hidden = !ready;
    get('disconnect').hidden = !session && !retryIndex;
    get('disconnect').textContent = session ? 'Disconnect Flipper' : 'Stop reconnecting';
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
  function cancelReconnect() {
    clearTimeout(retryTimer);
    retryIndex = 0;
  }
  function scheduleReconnect() {
    if (!lastDevice || !linked(id)) return;
    if (retryIndex === retryDelays.length) {
      cancelReconnect();
      render();
      notice('Open Apps → Spotify on your Flipper, then select Reconnect Flipper here.');
      return;
    }
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      if (lastDevice && !session && !pending && linked(id)) pair(true);
    }, retryDelays[retryIndex++]);
    render();
  }
  function lostConnection() {
    disconnect(droppedMessage);
    scheduleReconnect();
  }
  function forgetPage(current) {
    current.controller?.abort();
    current.active = current.waiting = current.page = current.now = null;
    showLibraryLinks();
  }
  function heartbeat(current) {
    current.timer = setTimeout(async () => {
      if (current !== session) return;
      // Background tabs can be suspended past the firmware's bridge timeout.
      const op = Date.now() - current.lastSeen >= 40000 ? 0x15 : 0x17;
      if (op === hello) forgetPage(current);
      try { await current.device.write(Uint8Array.of(op), () => session === current); }
      catch { if (session === current) lostConnection(); return; }
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
      current.controls = null;
      forgetPage(current);
      try { await current.device.write(Uint8Array.of(hello), () => session === current); }
      catch { if (session === current) lostConnection(); }
      return;
    }
    const status = op === 0x1c;
    const first = categories.has(op);
    if (current.active?.token === token) return;
    if (current.active?.op === 0x1c && !status) {
      current.controller.abort();
      current.active = current.waiting = null;
    }
    if (first && !status) {
      const now = current.now;
      forgetPage(current);
      current.now = now;
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
      if (!first && !request.control && current.page?.token !== base) {
        throw new PlaybackError(3, 'The displayed page changed. Reopen the library section and try again.');
      }
      if (Date.now() < cooldown) throw new PlaybackError(4, 'Spotify is busy. Wait a moment before retrying.');
      const {action, row} = request;
      if (request.control) {
        current.controls ??= new Map();
        if (current.controls.has(token) && current.controls.get(token) !== op)
          throw new PlaybackError(3, 'Try the player control again.');
        if (!current.controls.has(token)) {
          await controlPlayer(id, op, signal);
          if (!active()) return;
          if (current.controls.size >= 32) current.controls.delete(current.controls.keys().next().value);
          current.controls.set(token, op);
          current.now = null;
        }
        await send(packet(0x14, token, 0));
      } else if (action === playRow || action === queueRow || action === addRow) {
        const page = current.page;
        if (page.source.destinationFor && action !== addRow)
          throw new PlaybackError(3, 'Choose a playlist to add the song.');
        // A delayed or repeated BLE acknowledgement must never enqueue/add the song twice.
        page.actions ??= new Map();
        const earlier = page.actions.get(token);
        if (earlier !== undefined && earlier !== op)
          throw new PlaybackError(3, 'Reopen the selected song and try again.');
        if (earlier === undefined) {
          const execute = action === playRow ? playLibraryItem : action === queueRow ? queueTrack : addTrack;
          await execute(id, page, row, signal);
          if (!active()) return;
          page.actions.set(token, op);
          if (action === playRow) current.now = null;
        }
        await send(packet(0x14, token, row));
        if (active()) notice(action === queueRow ? 'Added to your Spotify queue.' :
          action === addRow ? 'Song added to your playlist.' : 'Playback requested on your active Spotify device.');
      } else {
        if (!status) showLibraryLinks();
        if ((op === next && !current.page.hasNext) || (op === previous && !current.page.hasPrev))
          throw new PlaybackError(3, 'There are no more items in that direction.');
        const displayed = current.page;
        if (op === parent && !displayed?.parent)
          throw new PlaybackError(3, 'Open your library to choose another item.');
        let source = displayed?.source;
        let offset = 0;
        if (first) source = {kind:categories.get(op), query:request.query};
        else if (action === artistRow) {
          const artist = selectedRow(current.page, row, 'artist');
          source = {kind:'track', artist:artist.uri, query:'artist:"' + artist.name.replace(/"/g, ' ') + '"'};
        } else if (action === collectionRow) {
          if (displayed.source.destinationFor || !['album', 'playlist'].includes(displayed.kind))
            throw new PlaybackError(3, 'Choose an album or playlist to see its songs.');
          source = {kind:'track', collection:selectedRow(displayed, row).uri};
        } else if (action === chooseRow) {
          source = {kind:'playlist', destinationFor:selectedRow(current.page, row, 'track').uri};
        } else if (op !== parent) {
          offset = current.page.offset + (op === next ? pageSize : -pageSize);
        }
        let page;
        if (op === parent) page = displayed.parent;
        else if (status && current.now && Date.now() - current.now.at < 5000) page = current.now.page;
        else page = await libraryPage(id, source, offset, signal);
        if (action === artistRow || action === chooseRow || action === collectionRow) page.parent = displayed;
        else if (!first && op !== parent) page.parent = displayed.parent;
        for (const bytes of pagePackets(page, token)) {
          if (!active()) return;
          await send(bytes);
        }
        if (!active()) return;
        if (status) {
          if (current.now?.page !== page) current.now = {at:Date.now(), page};
          showLibraryLinks([...(current.page?.rows || []), ...page.rows]);
          return;
        }
        current.page = {...page, token};
        showLibraryLinks([...page.rows, ...(current.now?.page.rows || [])]);
        if (!page.rows.length && page.hasNext) notice('Press Right on your Flipper to look for more matches.');
        else if (source.query && !page.rows.length) notice('No matches. Try another search on your Flipper.');
        else notice(page.rows.length ? 'Your library page is ready on the Flipper.' : 'This section of your library is empty.');
      }
    } catch (error) {
      if (!active()) return;
      if (status) {
        current.now = null;
        showLibraryLinks(current.page?.rows);
      } else showLibraryLinks();
      if (writing) { lostConnection(); return; }
      const issue = error instanceof PlaybackError ? error : new PlaybackError(2, 'Connection interrupted. Retry on your Flipper.');
      if (issue.retryMs) cooldown = Date.now() + issue.retryMs;
      notice(issue.message);
      try { await send(packet(0x13, token, issue.code)); }
      catch { if (active()) lostConnection(); return; }
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
  async function pair(recovering = false) {
    if (!recovering) cancelReconnect();
    pending = true;
    render();
    notice(lastDevice ? 'Reconnecting to your Flipper…' : 'Choose your Flipper and leave Apps → Spotify open.');
    const current = {};
    const sequence = ++attempt;
    try {
      current.device = await connect(lastDevice, request => respond(current, request), () => {
        if (session === current) lostConnection();
      });
      if (sequence !== attempt || !linked(id)) { current.device.close(); return; }
      session = current;
      lastDevice = current.device.grantedDevice;
      notice('Connected to ' + current.device.name + '. Open Apps → Spotify to browse your library.');
      await current.device.write(Uint8Array.of(0x15));
      if (session === current) {
        cancelReconnect();
        current.lastSeen = Date.now();
        heartbeat(current);
      }
    } catch (error) {
      if (sequence !== attempt) return;
      if (recovering && lastDevice && linked(id)) {
        if (session === current) disconnect(droppedMessage);
        else notice(droppedMessage);
        scheduleReconnect();
        return;
      }
      // Allow a fresh chooser after a failed reconnect (for example, a forgotten OS pairing).
      lastDevice = null;
      const message = error.name === 'NotFoundError' ? 'No Flipper selected. You can choose again.' :
        'Pairing did not finish. Open Apps → Spotify, check Bluetooth and try again.';
      if (session === current) disconnect(message);
      else notice(message);
    } finally { pending = false; render(); }
  }
  get('pair').onclick = () => pair();
  get('disconnect').onclick = () => { cancelReconnect(); lastDevice = null; return disconnect('Flipper disconnected.', true); };
  get('unlink').onclick = () => { cancelReconnect(); ++attempt; lastDevice = null; unlink(); return disconnect('Spotify unlinked from this tab.', true); };
  window.addEventListener('pagehide', () => { cancelReconnect(); ++attempt; lastDevice = null; disconnect(''); });
  get('bridge').hidden = false;
  pending = true;
  render();
  try {
    await callback(id);
    if (scanned) {
      // Consume the scan before leaving, so Back or a canceled grant never loops.
      history.replaceState(null, '', location.pathname);
      if (!linked(id)) {
        notice('Opening Spotify for permission…');
        await authorize(id);
      } else {
        notice('Spotify is linked. Choose your Flipper to show your library.');
      }
    }
  }
  catch (error) { notice(error.message); }
  pending = false;
  render();
}

import {addTrack, authorize, controlPlayer, holdPlaylistShortcut, libraryPage, linked, pageSize, PlaybackError, playLibraryItem, playShortcut, queueTrack, selectedRow, sessionMarker, setPlayerVolume, setShortcut, shortcutPage, unlink} from './spotify.js';

const uuid = n => 'efdd000' + n + '-5a34-4a32-9fab-1f72e60d00ed';
const get = id => document.getElementById(id);
const categories = new Map([[0x10, 'track'], [0x18, 'playlist'], [0x19, 'album'], [0x1c, 'now'], [0x1e, 'queue']]);
const next = 0x11, previous = 0x12, hello = 0x15, dismiss = 0x16, parent = 0x1d;
const playRow = 0x20, queueRow = 0x28, chooseRow = 0x30, addRow = 0x34, collectionRow = 0x38;
const rowOperations = [playRow, queueRow, chooseRow, addRow, collectionRow];

function decodeCommand(value) {
  if (!value || value.byteLength < 5 || value.byteLength > 20) return;
  const op = value.getUint8(0), token = value.getUint16(1, true), base = value.getUint16(3, true);
  const assign = op >= 0x50 && op < 0x60;
  const hold = op >= 0x70 && op < 0x80;
  const playPreset = op >= 0x60 && op < 0x64;
  const clearPreset = op >= 0x68 && op < 0x6c;
  const control = (op >= 0x40 && op <= 0x43) || op === 0x45 || playPreset || clearPreset;
  const standalone = control || op === 0x64 || op === 0x46 || categories.has(op) || op === hello || op === dismiss;
  let volume;
  if (op === 0x43) {
    if (value.byteLength !== 6) return;
    volume = value.getUint8(5);
    if (volume > 100) return;
  } else if (value.byteLength !== 5) return;
  if (!token || (standalone ? base !== 0 : !base)) return;
  const action = rowOperations.find(start => op >= start && op < start + pageSize);
  if (assign || hold || standalone || op === next || op === previous || op === parent || action !== undefined) {
    return {op, token, base, volume, control, action, assign, hold, playPreset, clearPreset, row:assign || hold ? (op & 3) : op - action};
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

function labelBytes(label) {
  const bytes = new Uint8Array(80);
  const {written} = new TextEncoder().encodeInto(label.replace(/[\x00-\x1f\x7f]/g, ' '), bytes);
  return bytes.subarray(0, written);
}

function pagePackets(page, token) {
  let header = packet(0x10, token);
  if (page.playState !== undefined) {
    const timing = new Uint8Array(8);
    const view = new DataView(timing.buffer);
    const duration = Number.isSafeInteger(page.durationMs) ? Math.max(0, Math.min(0xffffffff, page.durationMs)) : 0;
    const elapsed = page.playState === 1 ? Math.max(0, Date.now() - page.sampledAt) : 0;
    const progress = Number.isSafeInteger(page.progressMs) ? Math.max(0, Math.min(duration, page.progressMs + elapsed)) : 0;
    view.setUint32(0, progress, true);
    view.setUint32(4, duration, true);
    header = packet(0x10, token, page.playState, ...timing, labelBytes(page.rows[0]?.name || '').length, page.volume ?? 255);
  }
  const packets = [header];
  for (const [row, song] of page.rows.entries()) {
    const text = labelBytes(song.label);
    for (let i = 0; i < text.length; i += 16) {
      packets.push(packet(0x11, token, row, ...text.subarray(i, i + 16)));
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

export async function startBridge(id, initialMessage) {
  let session, lastDevice, pending = false, cooldown;
  let attempt = 0, retryTimer, retryIndex = 0;
  const retryDelays = [1000, 3000, 6000, 12000, 24000, 30000];
  const droppedMessage = 'Waiting for your Flipper. Leave this tab open and turn your Flipper back on.';
  const notice = text => { get('notice').textContent = text; };
  function render() {
    const ready = linked(id);
    get('link').hidden = ready;
    get('pair').hidden = !ready || Boolean(session) || !navigator.bluetooth?.requestDevice;
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
    if (sessionMarker(id) !== current.grant) {
      await disconnect('Spotify account changed. Reconnect the Flipper to use this account.', true);
      return;
    }
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
    const active = () => session === current && current.active === request && sessionMarker(id) === current.grant;
    let writing = false;
    async function send(bytes) {
      if (!active()) return;
      writing = true;
      await current.device.write(bytes, active);
      writing = false;
    }
    try {
      if (!first && !request.control && op !== 0x64 && op !== 0x46 && current.page?.token !== base) {
        throw new PlaybackError(3, 'The displayed page changed. Reopen the library section and try again.');
      }
      if (cooldown && Date.now() < cooldown.until) throw new PlaybackError(4, cooldown.message);
      const {action, row} = request;
      if (request.control || request.assign || request.hold) {
        current.controls ??= new Map();
        const commandKey = (op << 8) | (request.volume ?? 0);
        const earlier = current.controls.get(token);
        if (earlier && (earlier.commandKey !== commandKey || earlier.base !== base))
          throw new PlaybackError(3, 'Try the player control again.');
        let ack = earlier?.ack ?? (request.assign || request.hold ? row : 0);
        if (!earlier) {
          if (request.hold) {
            const played = await holdPlaylistShortcut(id, (op - 0x70) >> 2, current.page, row, signal);
            if (played) ack += pageSize;
          } else if (request.assign) {
            await setShortcut(id, (op - 0x50) >> 2, current.page, row, signal);
          } else if (request.playPreset) {
            await playShortcut(id, op - 0x60, signal);
          } else if (request.clearPreset) {
            await setShortcut(id, op - 0x68, null, 0, signal);
          } else if (op === 0x43) {
            await setPlayerVolume(id, current.now?.page, request.volume, signal);
          } else if (op === 0x45) {
            await queueTrack(id, current.now?.page, 0, signal);
          } else {
            await controlPlayer(id, op, signal);
          }
          if (!active()) return;
          if (current.controls.size >= 32) current.controls.delete(current.controls.keys().next().value);
          current.controls.set(token, {commandKey, base, ack});
          if (op !== 0x45 && !request.clearPreset && !request.assign && (!request.hold || ack >= pageSize)) current.now = null;
        }
        await send(packet(0x14, token, ack));
      } else if (op === 0x64) {
        const shortcuts = await shortcutPage(id, signal);
        for (const bytes of pagePackets(shortcuts, token)) await send(bytes);
        if (active()) showLibraryLinks([...shortcuts.rows, ...(current.page?.rows || [])]);
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
        if (first) source = {kind:categories.get(op)};
        else if (op === 0x46) {
          source = {kind:'playlist', destinationFor:selectedRow(current.now?.page, 0, 'track').uri};
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
        if (op === 0x46 || action === chooseRow || action === collectionRow) page.parent = displayed;
        else if (!first && op !== parent) page.parent = displayed.parent;
        // A player can report volume support and then reject the write. Refresh other
        // metadata normally and briefly disable that player’s slider after a refusal.
        if (status && current.volumeDenied?.key === page.deviceKey && Date.now() < current.volumeDenied.until)
          page = {...page, volume:null};
        for (const bytes of pagePackets(page, token)) {
          if (!active()) return;
          await send(bytes);
        }
        if (!active()) return;
        if (status) {
          if (current.now?.page !== page) current.now = {at:page.sampledAt, page};
          showLibraryLinks([...(current.page?.rows || []), ...page.rows]);
          return;
        }
        current.page = {...page, token};
        showLibraryLinks([...page.rows, ...(current.now?.page.rows || [])]);
        if (!page.rows.length && page.hasNext) notice('Press Right on your Flipper to look for more matches.');
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
      if (op === 0x43) {
        if (issue.code === 5 && current.now?.page) {
          current.volumeDenied = {key:current.now.page.deviceKey, until:Date.now() + 30000};
        }
        current.now = null;
      }
      if (issue.retryMs) cooldown = {until: Date.now() + issue.retryMs, message: issue.message};
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
    const current = {grant:sessionMarker(id)};
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
  render();
  if (initialMessage) notice(initialMessage);
  else if (linked(id)) notice(navigator.bluetooth?.requestDevice ?
    'Spotify is linked. Open Apps → Spotify on your Flipper, then choose it below.' :
    'Spotify is linked in this tab. This browser cannot send your library to the Flipper over Bluetooth. Scan the QR in Chrome on Android, or open the same QR link in desktop Chrome or Edge and link there.');
  else notice('Link Spotify to continue with the app registered on your Flipper.');
}

import {authorize, callback, command, linked, playback, PlaybackError, unlink} from "./spotify.js";

const uuid = n => "efdd000" + n + "-5a34-4a32-9fab-1f72e60d00ed";
const get = id => document.getElementById(id);

function textPackets(tag, text) {
  const bytes = new Uint8Array(95);
  const {written} = new TextEncoder().encodeInto(text, bytes);
  const result = [];
  for (let i = 0; i < written; i += 19) result.push(Uint8Array.of(tag, ...bytes.subarray(i, Math.min(written, i + 19))));
  return result;
}

export function trackPackets(player) {
  const commit = new Uint8Array(10);
  const timing = new DataView(commit.buffer);
  commit.set([4, Number(player.is_playing)]);
  const duration = Math.max(0, Math.min(0xffffffff, player.item.duration_ms || 0));
  timing.setUint32(2, Math.max(0, Math.min(duration, player.progress_ms || 0)), true);
  timing.setUint32(6, duration, true);
  const artist = player.item.artists?.map(item => item.name).join(", ") || "";
  return [Uint8Array.of(1), ...textPackets(2, player.item.name || ""), ...textPackets(3, artist), commit];
}

function displayTrack(player) {
  const item = player.item;
  get("title").textContent = item.name;
  get("artist").textContent = item.artists?.map(a => a.name).join(", ") || "";
  const external = item.external_urls?.spotify || "";
  get("song").href = /^https:\/\/open\.spotify\.com\/track\//.test(external) ? external : "https://open.spotify.com/";
  const clock = ms => {
    const seconds = Math.floor(Math.max(0, ms || 0) / 1000);
    return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
  };
  get("times").textContent = clock(player.progress_ms) + " / " + clock(item.duration_ms);
  get("track").hidden = false;
}

async function connect(onCommand, onDrop) {
  const device = await navigator.bluetooth.requestDevice({
    filters: [0x3080, 0x3081, 0x3082, 0x3083].map(service => ({services: [service]})),
    optionalServices: [uuid(1)],
  });
  let controls;
  function notification(event) {
    const bytes = event.target.value;
    if (bytes?.byteLength === 1 && [1, 2, 3].includes(bytes.getUint8(0))) onCommand(bytes.getUint8(0));
  }
  function detach() {
    device.removeEventListener("gattserverdisconnected", dropped);
    controls?.removeEventListener("characteristicvaluechanged", notification);
  }
  function dropped() {
    detach();
    onDrop();
  }
  try {
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(uuid(1));
    const state = await service.getCharacteristic(uuid(2));
    controls = await service.getCharacteristic(uuid(3));
    controls.addEventListener("characteristicvaluechanged", notification);
    await controls.startNotifications();
    if (!device.gatt.connected) throw new Error("Disconnected while pairing.");
    device.addEventListener("gattserverdisconnected", dropped);
    return {
      name: device.name || "Flipper",
      write: packet => state.writeValueWithResponse(packet),
      close() {
        detach();
        if (device.gatt.connected) device.gatt.disconnect();
      },
    };
  } catch (error) {
    detach();
    if (device.gatt.connected) device.gatt.disconnect();
    throw error;
  }
}

export async function startBridge(id) {
  let remote, pending = false, cooldown = 0;
  const notice = text => { get("notice").textContent = text; };
  const render = () => {
    const ready = linked(id);
    get("link").hidden = ready;
    get("pair").hidden = !ready || Boolean(remote);
    get("unlink").hidden = !ready;
    get("disconnect").hidden = !remote;
    get("pair").disabled = get("link").disabled = get("unlink").disabled = pending;
    if (!remote) get("track").hidden = true;
  };
  const disconnect = text => {
    if (remote) {
      clearTimeout(remote.timer);
      remote.abort.abort();
      remote.device.close();
      remote = null;
    }
    render();
    notice(text);
  };

  // Each session owns its poll, write queue and abort signal. Disconnect drops queued input.
  async function sync(session, controlCode = 0) {
    if (remote !== session) return;
    if (session.busy) {
      if (controlCode && !session.queued) session.queued = controlCode;
      return;
    }
    clearTimeout(session.timer);
    if (Date.now() < cooldown) {
      session.timer = setTimeout(() => sync(session), cooldown - Date.now());
      return;
    }
    session.busy = true;
    let wait = 5000;
    const signal = AbortSignal.any([session.abort.signal, AbortSignal.timeout(12000)]);
    try {
      const player = await playback(id, signal);
      if (remote !== session) return;
      if (controlCode) {
        await command(id, controlCode, player, signal);
        wait = 550;
      } else {
        for (const packet of trackPackets(player)) {
          if (remote !== session) return;
          await session.device.write(packet);
        }
        if (remote !== session) return;
        displayTrack(player);
        notice((player.is_playing ? "Playing on " : "Paused on ") + (player.device.name || "Spotify"));
      }
    } catch (error) {
      if (remote !== session) return;
      const issue = error instanceof PlaybackError ? error : new PlaybackError(2, "Connection interrupted. Eddy will retry.");
      notice(issue.message);
      get("track").hidden = true;
      wait = issue.retryMs;
      if (issue.code === 4) cooldown = Date.now() + wait;
      try { await session.device.write(Uint8Array.of(5, issue.code)); }
      catch {
        if (remote === session) disconnect("Bluetooth disconnected. Choose your Flipper to reconnect.");
        return;
      }
      if (issue.code === 1 && remote === session) {
        unlink();
        disconnect(issue.message);
        return;
      }
    } finally {
      session.busy = false;
      if (remote === session) {
        const next = session.queued;
        session.queued = 0;
        session.timer = setTimeout(() => sync(session, next), next ? 0 : wait);
      }
    }
  }

  get("link").onclick = async () => {
    pending = true;
    render();
    try { await authorize(id); }
    catch {
      pending = false;
      render();
      notice("Allow this tab to use session storage and try linking Spotify again.");
    }
  };
  get("pair").onclick = async () => {
    pending = true;
    render();
    notice("Choose your paired Flipper in the browser’s device list.");
    try {
      const device = await connect(
        code => { if (remote) sync(remote, code); },
        () => disconnect("Bluetooth disconnected. Choose your Flipper to reconnect."),
      );
      remote = {device, abort: new AbortController(), timer: null, queued: 0, busy: false};
      notice("Connected to " + device.name + ".");
      sync(remote);
    } catch (error) {
      notice(error.name === "NotFoundError" ? "No Flipper selected. You can choose again." :
        "Pairing didn’t finish. Leave Apps → Spotify open, turn on Bluetooth and try again.");
    } finally {
      pending = false;
      render();
    }
  };
  get("disconnect").onclick = () => disconnect("Flipper disconnected.");
  get("unlink").onclick = () => {
    unlink();
    disconnect("Spotify unlinked from this tab.");
  };
  window.addEventListener("pagehide", () => disconnect(""));
  get("android-mode").textContent = "Standard Android pairing provides playback buttons. Link this tab below to add the song, artist and playback clock.";
  get("bridge").hidden = false;
  pending = true;
  render();
  try { await callback(id); }
  catch (error) { notice(error.message); }
  pending = false;
  render();
}

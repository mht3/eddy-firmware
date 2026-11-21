const pendingKey = "eddy.music.pkce", accountKey = "eddy.music.session";
const scopes = ["user-read-playback-state", "user-modify-playback-state"];
const redirect = new URL("./", location.href).href;

export class PlaybackError extends Error {
  constructor(code, message, retryMs = 6500) {
    super(message);
    this.code = code;
    this.retryMs = retryMs;
  }
}

function read(key) {
  try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; }
}

export function linked(id) {
  return read(accountKey)?.id === id;
}

export function unlink() {
  sessionStorage.removeItem(accountKey);
  sessionStorage.removeItem(pendingKey);
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function authorize(id) {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  sessionStorage.setItem(pendingKey, JSON.stringify({id, state, verifier, redirect, issued: Date.now()}));
  const args = new URLSearchParams({
    client_id: id, response_type: "code", scope: scopes.join(" "), redirect_uri: redirect,
    state, code_challenge_method: "S256", code_challenge: base64url(new Uint8Array(digest)),
  });
  location.assign("https://accounts.spotify.com/authorize?" + args);
}

function rateLimit(response) {
  const seconds = Number(response.headers.get("Retry-After"));
  return new PlaybackError(4, "Spotify is busy. Eddy will retry automatically.", seconds > 0 ? Math.max(1000, seconds * 1000) : 30000);
}

async function exchange(params, signal) {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST", body: new URLSearchParams(params), credentials: "omit", cache: "no-store", signal,
  });
  if (response.status === 429) throw rateLimit(response);
  if (response.status === 400 || response.status === 401) throw new PlaybackError(1, "Your Spotify session expired. Link Spotify again.");
  if (!response.ok) throw new PlaybackError(2, "Spotify sign-in is unavailable. Please try again.");
  const token = await response.json();
  if (typeof token.access_token !== "string" || !(token.expires_in > 0)) throw new PlaybackError(1, "Link Spotify again to start a new session.");
  if (token.scope && !scopes.every(scope => token.scope.split(" ").includes(scope))) throw new PlaybackError(1, "Grant both playback permissions when linking Spotify.");
  return token;
}

function store(id, token, previousRefresh) {
  const refresh = token.refresh_token || previousRefresh;
  if (!refresh) throw new PlaybackError(1, "Link Spotify again to start a renewable session.");
  const account = {id, refresh, token: token.access_token, expires: Date.now() + 1000 * token.expires_in};
  sessionStorage.setItem(accountKey, JSON.stringify(account));
  return account;
}

export async function callback(id) {
  const query = new URLSearchParams(location.search);
  if (!query.has("code") && !query.has("error")) return;
  history.replaceState(null, "", location.pathname);
  const pending = read(pendingKey);
  sessionStorage.removeItem(pendingKey);
  if (!pending || pending.id !== id || query.get("state") !== pending.state || Date.now() - pending.issued > 600000) {
    throw new Error("This link expired or came from another tab. Start again here.");
  }
  if (query.has("error")) throw new Error("Spotify linking was canceled. You can try again.");
  const token = await exchange({grant_type: "authorization_code", client_id: id, code_verifier: pending.verifier,
    code: query.get("code"), redirect_uri: pending.redirect || new URL("../music/", location.href).href}, AbortSignal.timeout(12000));
  store(id, token);
}

async function request(id, path, method, signal, refresh = false) {
  let account = read(accountKey);
  if (account?.id !== id) throw new PlaybackError(1, "Link Spotify to continue.");
  if (refresh || account.expires - Date.now() < 60000) {
    const token = await exchange({grant_type: "refresh_token", refresh_token: account.refresh, client_id: id}, signal);
    signal.throwIfAborted();
    account = store(id, token, account.refresh);
  }
  const response = await fetch("https://api.spotify.com/v1/me/player" + path, {
    method, credentials: "omit", cache: "no-store", signal, headers: {Authorization: "Bearer " + account.token},
  });
  if (response.status === 401 && !refresh) return request(id, path, method, signal, true);
  if (response.status === 401) throw new PlaybackError(1, "Your Spotify session expired. Link Spotify again.");
  if (response.status === 403) throw new PlaybackError(3, "Spotify declined access. Check that this account is eligible for playback control.", 15000);
  if (response.status === 404) throw new PlaybackError(0, "Open Spotify and start a song.");
  if (response.status === 429) throw rateLimit(response);
  if (!response.ok) throw new PlaybackError(2, "Spotify is unreachable. Eddy will retry.");
  return method === "GET" && response.status !== 204 ? response.json() : null;
}

export async function playback(id, signal) {
  const player = await request(id, "", "GET", signal);
  if (!player?.device) throw new PlaybackError(0, "Open Spotify and start a song.");
  if (player.device.is_private_session || player.device.is_restricted) throw new PlaybackError(3, "Choose a playback device that allows remote control and exit Private Session.");
  if (player.currently_playing_type !== "track" || !player.item) throw new PlaybackError(0, "Waiting for a music track in Spotify.");
  return player;
}

export async function command(id, code, player, signal) {
  const query = new URLSearchParams();
  if (player.device.id) query.set("device_id", player.device.id);
  let path, method = "PUT", restriction;
  switch (code) {
    case 1:
      if (Number.isFinite(player.progress_ms) && player.progress_ms >= 3000) {
        path = "seek";
        query.set("position_ms", "0");
        restriction = "seeking";
      } else {
        path = "previous";
        method = "POST";
        restriction = "skipping_prev";
      }
      break;
    case 2:
      path = player.is_playing ? "pause" : "play";
      restriction = player.is_playing ? "pausing" : "resuming";
      break;
    case 3:
      path = "next";
      method = "POST";
      restriction = "skipping_next";
      break;
    case 4:
    case 5: {
      const volume = player.device.volume_percent;
      if (player.device.supports_volume === false || !Number.isInteger(volume) || volume < 0 || volume > 100) {
        throw new PlaybackError(3, "This playback device handles volume on its own.");
      }
      const next = Math.max(0, Math.min(100, volume + (code === 4 ? 5 : -5)));
      if (volume === next) return;
      path = "volume";
      query.set("volume_percent", String(next));
      break;
    }
    default:
      throw new Error("Unknown playback control.");
  }
  if (restriction && player.actions?.disallows?.[restriction]) {
    throw new PlaybackError(3, "Spotify has disabled that control for this track.");
  }
  const params = query.toString();
  await request(id, "/" + path + (params ? "?" + params : ""), method, signal);
}

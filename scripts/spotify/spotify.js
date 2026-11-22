const pendingKey = 'eddy.spotify.library.pkce';
const accountKey = 'eddy.spotify.library.session';
const scopes = ['user-library-read', 'playlist-read-private', 'playlist-read-collaborative', 'user-modify-playback-state',
  'user-read-currently-playing', 'user-read-playback-state', 'playlist-modify-private', 'playlist-modify-public'];
const redirect = new URL('./', location.href).href;
export const pageSize = 4;

export class PlaybackError extends Error {
  constructor(code, message, retryMs = 0) {
    super(message);
    this.code = code;
    this.retryMs = retryMs;
  }
}

function read(key) {
  try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; }
}

function hasScopes(scope) {
  return typeof scope === 'string' && scopes.every(value => scope.split(' ').includes(value));
}

export function linked(id) {
  const account = read(accountKey);
  return account?.id === id && hasScopes(account.scope);
}

export function sessionMarker(id) {
  const account = read(accountKey);
  if (account?.id !== id || !hasScopes(account.scope)) return null;
  if (!account.grant) {
    account.grant = base64url(crypto.getRandomValues(new Uint8Array(16)));
    sessionStorage.setItem(accountKey, JSON.stringify(account));
  }
  return account.grant;
}

export function unlink() {
  const key = read(accountKey)?.shortcuts;
  if (key) for (let i = 0; i < 4; i++) {
    try { localStorage.removeItem(key + '.' + i); } catch {}
  }
  sessionStorage.removeItem(accountKey);
  sessionStorage.removeItem(pendingKey);
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function authorize(id) {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  sessionStorage.setItem(pendingKey, JSON.stringify({id, state, verifier, redirect, issued: Date.now()}));
  const args = new URLSearchParams({
    client_id: id, response_type: 'code', scope: scopes.join(' '), redirect_uri: redirect,
    state, code_challenge_method: 'S256', code_challenge: base64url(new Uint8Array(digest)),
    show_dialog: 'true',
  });
  location.assign('https://accounts.spotify.com/authorize?' + args);
}

async function rateLimit(response) {
  const seconds = Number(response.headers.get('Retry-After'));
  const body = await response.json().catch(() => null);
  const quota = body?.error?.reason === 'QUOTA_EXCEEDED';
  const message = quota ? 'Your Spotify developer account has reached its request quota. Wait for it to reset before trying again.' :
    'Spotify is receiving too many requests. Wait a moment before trying again.';
  return new PlaybackError(4, message, seconds > 0 ? seconds * 1000 : quota ? 600000 : 30000);
}

async function exchange(params, signal) {
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST', body: new URLSearchParams(params), credentials: 'omit', cache: 'no-store', signal,
  });
  if (response.status === 429) throw await rateLimit(response);
  if (response.status === 400 || response.status === 401) {
    const issue = await response.json().catch(() => null);
    if (issue?.error === 'invalid_client') {
      throw new PlaybackError(1, 'Spotify did not recognize your app. Check its Client ID in the Developer Dashboard and restart the companion with --change-client-id.');
    }
    if (params.grant_type === 'authorization_code') {
      throw new PlaybackError(1, 'Spotify could not finish sign-in. Check your app’s registered redirect URI, then choose Link Spotify again in this tab.');
    }
    throw new PlaybackError(1, 'Spotify sign-in expired or access was removed. Choose Link Spotify again.');
  }
  if (!response.ok) throw new PlaybackError(2, 'Spotify sign-in is unavailable. Please try again.');
  const token = await response.json();
  if (!token.access_token || !(token.expires_in > 0)) throw new PlaybackError(1, 'Link Spotify again to start a new session.');
  if (token.scope !== undefined && !hasScopes(token.scope)) {
    throw new PlaybackError(1, 'Link Spotify again and grant access to your library, playlists and playback.');
  }
  return token;
}

function store(id, token, previous) {
  const refresh = token.refresh_token || previous?.refresh;
  if (!refresh) throw new PlaybackError(1, 'Link Spotify again to start a renewable session.');
  const account = {id, refresh, token: token.access_token, expires: Date.now() + 1000 * token.expires_in,
    scope: token.scope ?? previous?.scope ?? scopes.join(' '), shortcuts: previous?.shortcuts, grant: previous?.grant || base64url(crypto.getRandomValues(new Uint8Array(16)))};
  sessionStorage.setItem(accountKey, JSON.stringify(account));
  return account;
}

export async function callback(id) {
  const query = new URLSearchParams(location.search);
  if (!query.has('code') && !query.has('error')) return;
  history.replaceState(null, '', location.pathname);
  const pending = read(pendingKey);
  sessionStorage.removeItem(pendingKey);
  if (!pending || pending.id !== id || pending.redirect !== redirect || query.get('state') !== pending.state ||
      Date.now() - pending.issued > 600000) {
    throw new Error('This link expired or came from another tab. Start again here.');
  }
  if (query.has('error')) throw new Error('Spotify linking was canceled. You can try again.');
  const token = await exchange({grant_type: 'authorization_code', client_id: id, code_verifier: pending.verifier,
    code: query.get('code'), redirect_uri: pending.redirect}, AbortSignal.timeout(12000));
  const account = store(id, token);
  try {
    await shortcutNamespace(id, AbortSignal.timeout(12000));
  } catch (error) {
    if (read(accountKey)?.grant === account.grant) sessionStorage.removeItem(accountKey);
    throw error;
  }
}

async function request(id, path, signal, method = 'GET', body, retry = false) {
  let account = read(accountKey);
  if (account?.id !== id || !hasScopes(account.scope)) throw new PlaybackError(1, 'Link Spotify to access your library.');
  if (retry || account.expires - Date.now() < 60000) {
    const token = await exchange({grant_type: 'refresh_token', refresh_token: account.refresh, client_id: id}, signal);
    signal.throwIfAborted();
    if (read(accountKey)?.grant !== account.grant) throw new PlaybackError(1, 'The Spotify account changed.');
    account = store(id, token, account);
  }
  const headers = {Authorization: 'Bearer ' + account.token};
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch('https://api.spotify.com/v1/' + path, {
    method, body: body ? JSON.stringify(body) : undefined,
    credentials: 'omit', cache: 'no-store', signal, headers,
  });
  if (read(accountKey)?.grant !== account.grant) throw new PlaybackError(1, 'The Spotify account changed.');
  if (response.status === 401 && !retry) return request(id, path, signal, method, body, true);
  if (response.status === 401) throw new PlaybackError(1, 'Your Spotify session expired. Link Spotify again.');
  if (response.status === 403 && method === 'GET' && /^playlists\/[^/]+\/items/.test(path))
    throw new PlaybackError(3, 'Spotify allows browsing playlists you own or collaborate on. You can still choose Play for other playlists.');
  if (response.status === 403) {
    const issue = await response.json().catch(() => null);
    const reason = issue?.error?.reason;
    if (path.startsWith('me/player/volume?') && reason !== 'PREMIUM_REQUIRED')
      throw new PlaybackError(5, 'Spotify declined volume control on this player. Use its own volume buttons.');
    if (reason === 'RESTRICTION_VIOLATED' || reason === 'DISALLOW')
      throw new PlaybackError(3, 'The active Spotify player cannot perform this action on the current item.');
    if (reason === 'PREMIUM_REQUIRED')
      throw new PlaybackError(3, 'Spotify requires Premium for this playback control.');
    throw new PlaybackError(3, 'Spotify denied access. Check that the developer app owner has Premium and this Spotify account is authorized for that app.');
  }
  if (response.status === 404 && path.startsWith('playlists/'))
    throw new PlaybackError(3, 'Spotify could not find this playlist. Choose another playlist.');
  if (response.status === 404 && path.startsWith('me/player/')) throw new PlaybackError(0, 'Open Spotify on your playback device and play a song, then try again.');
  if (response.status === 429) throw await rateLimit(response);
  if (!response.ok) throw new PlaybackError(2, 'Spotify could not complete that request. Please try again.');
  return method === 'GET' && response.status !== 204 ? response.json() : null;
}


function rowFor(entry, kind) {
  const name = entry?.name || 'Unavailable ' + kind;
  const by = kind === 'playlist' ? entry?.owner?.display_name :
    entry?.artists?.map(artist => artist.name).filter(Boolean).join(', ');
  const uri = entry?.uri || '';
  const match = /^spotify:(track|artist|album|playlist):([a-zA-Z0-9]{22})$/.exec(uri);
  const valid = match && match[0] === uri && match[1] === kind;
  const href = valid ? 'https://open.spotify.com/' + kind + '/' + match[2] : null;
  const playable = valid && !entry.is_local && entry.is_playable !== false && !entry.restrictions?.reason;
  return {name, label: by ? name + ' - ' + by : name, href, uri: playable ? uri : null};
}

function validatePage(result, offset, limit) {
  if (result?.offset !== offset || !Array.isArray(result.items) || result.items.length > limit ||
      (result.next && !result.items.length)) {
    throw new PlaybackError(2, 'Spotify returned an incomplete page. Try again.');
  }
}

// Filter a bounded number of API pages per button press. Back uses the saved display page.
// Copy the cursor so canceling a slow request cannot move the current page forward.
async function filteredPage(source, offset, fetchBatch, keep, kind) {
  const old = source.cursor;
  const cursor = {pages: old?.pages.slice() || [], remaining: old?.remaining.slice() || [],
    next:old ? old.next : 0};
  const index = offset / pageSize;
  if (index === cursor.pages.length) {
    for (let batches = 0; batches < 2 && cursor.next !== null && cursor.remaining.length <= pageSize; batches++) {
      const result = await fetchBatch(cursor.next);
      cursor.remaining.push(...result.items.filter(keep).map(item => rowFor(item, kind)));
      cursor.next = result.next ? cursor.next + result.items.length : null;
    }
    cursor.pages.push(cursor.remaining.splice(0, pageSize));
  }
  return {source:{...source, cursor}, kind, offset, rows:cursor.pages[index], hasPrev:index > 0,
    hasNext:index + 1 < cursor.pages.length || cursor.remaining.length > 0 || cursor.next !== null};
}

export async function libraryPage(id, source, offset, signal) {
  const {kind, destinationFor} = source;
  if (kind === 'now') {
    // Playback State includes the active device and current track in a single request.
    const state = await request(id, 'me/player', signal);
    const device = state?.device;
    const volume = device?.volume_percent;
    const adjustable = device?.supports_volume === true && !device.is_restricted &&
      Number.isInteger(volume) && volume >= 0 && volume <= 100;
    const rows = state?.item?.type === 'track' ? [rowFor(state.item, 'track')] : [];
    return {kind:'track', source, offset:0, rows, hasNext:false, hasPrev:false,
      playState: rows.length ? (state.is_playing ? 1 : 2) : 0,
      deviceId: device?.id || null, deviceKey: device?.id || JSON.stringify([device?.name, device?.type]),
      volume: adjustable ? volume : null,
      sampledAt: Date.now(), progressMs: rows.length ? state.progress_ms : 0,
      durationMs: rows.length ? state.item.duration_ms : 0};
  }
  if (kind === 'queue') {
    const queue = source.queue ?? (await request(id, 'me/player/queue', signal))?.queue;
    if (!Array.isArray(queue)) throw new PlaybackError(2, 'Spotify did not return a queue. Try again.');
    const tracks = queue.filter(item => item?.type === 'track');
    return {kind:'track', source:{...source, queue}, offset,
      rows:tracks.slice(offset, offset + pageSize).map(item => rowFor(item, 'track')),
      hasPrev:offset > 0, hasNext:offset + pageSize < tracks.length};
  }
  if (source.collection) {
    const [, collectionKind, spotifyId] = source.collection.split(':');
    const playlist = collectionKind === 'playlist';
    const path = playlist ? 'playlists/' + spotifyId + '/items' : 'albums/' + spotifyId + '/tracks';
    return filteredPage(source, offset, async start => {
      const result = await request(id, path + '?limit=20&offset=' + start, signal);
      validatePage(result, start, 20);
      return {...result, items: playlist ? result.items.map(row => row?.item ?? row?.track) : result.items};
    }, item => item?.type === 'track', 'track');
  }
  if (destinationFor) {
    const owner = source.owner || (await request(id, 'me', signal))?.id;
    if (!owner) throw new PlaybackError(3, 'Spotify could not identify your playlists.');
    return filteredPage({...source, owner}, offset, async start => {
      const result = await request(id, 'me/playlists?limit=50&offset=' + start, signal);
      validatePage(result, start, 50);
      return result;
    }, item => item?.owner?.id === owner && rowFor(item, 'playlist').uri, 'playlist');
  }
  if (!['album', 'playlist', 'track'].includes(kind)) throw new PlaybackError(3, 'Unknown library section.');
  const result = await request(id, 'me/' + kind + 's?limit=' + pageSize + '&offset=' + offset, signal);
  validatePage(result, offset, pageSize);
  const rows = result.items.map(item => rowFor(kind === 'playlist' ? item : item?.[kind], kind));
  return {kind, source, offset, rows, hasPrev:offset > 0, hasNext:Boolean(result.next)};
}

export function selectedRow(page, index, kind) {
  const row = page?.rows[index];
  if (!row?.uri || (kind && kind !== page.kind))
    throw new PlaybackError(3, 'This action is unavailable for the selected item.');
  return row;
}

export async function playLibraryItem(id, page, index, signal) {
  const {uri} = selectedRow(page, index);
  const body = page.kind === 'track' ? {uris:[uri]} : {context_uri:uri};
  await request(id, 'me/player/play', signal, 'PUT', body);
}

export async function queueTrack(id, page, index, signal) {
  const {uri} = selectedRow(page, index, 'track');
  await request(id, 'me/player/queue?' + new URLSearchParams({uri}), signal, 'POST');
}

export async function addTrack(id, page, index, signal) {
  const {uri} = selectedRow(page, index, 'playlist');
  if (!page.source.destinationFor) throw new PlaybackError(3, 'Select a song before choosing a playlist.');
  await request(id, 'playlists/' + uri.split(':')[2] + '/items', signal, 'POST',
    {uris:[page.source.destinationFor]});
}

export async function controlPlayer(id, op, signal) {
  if (op === 0x42) return request(id, 'me/player/next', signal, 'POST');
  const state = await request(id, 'me/player/currently-playing', signal);
  if (op === 0x41) return request(id, state?.is_playing ? 'me/player/pause' : 'me/player/play', signal, 'PUT');
  if (state?.progress_ms >= 3000) return request(id, 'me/player/seek?position_ms=0', signal, 'PUT');
  return request(id, 'me/player/previous', signal, 'POST');
}

export async function setPlayerVolume(id, displayed, target, signal) {
  if (!displayed || displayed.volume == null || !Number.isInteger(target) || target < 0 || target > 100)
    throw new PlaybackError(5, 'The active Spotify player does not offer volume control.');
  // Pin the write to the player shown, even when Spotify Connect has since switched.
  // Some players have no stable device ID. Confirm their identity before targeting the active player.
  if (!displayed.deviceId || Date.now() - displayed.sampledAt > 5000) {
    const latest = await libraryPage(id, {kind:'now'}, 0, signal);
    if (latest.deviceKey !== displayed.deviceKey || latest.volume == null)
      throw new PlaybackError(5, 'The Spotify player changed. Refresh Now Playing to adjust its volume.');
  }
  const params = new URLSearchParams({volume_percent:target});
  if (displayed.deviceId) params.set('device_id', displayed.deviceId);
  await request(id, 'me/player/volume?' + params, signal, 'PUT');
}

// Persist only the user's four chosen playlist references. Keep metadata, credentials,
// and the Spotify profile out of localStorage. A fresh grant verifies its own identity.
async function shortcutNamespace(id, signal) {
  const grant = sessionMarker(id);
  if (!grant) throw new PlaybackError(1, 'Link Spotify to access your shortcuts.');
  const account = read(accountKey);
  if (account.shortcuts) return account.shortcuts;
  const profile = await request(id, 'me', signal);
  if (typeof profile?.account_id !== 'string' || !profile.account_id)
    throw new PlaybackError(3, 'Spotify could not identify your account for playlist shortcuts.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id + '/' + profile.account_id));
  signal.throwIfAborted();
  const current = read(accountKey);
  if (current?.id !== id || current.grant !== grant)
    throw new PlaybackError(1, 'The Spotify account changed. Reopen your shortcuts.');
  current.shortcuts = 'eddy.spotify.shortcuts.' + base64url(new Uint8Array(digest));
  sessionStorage.setItem(accountKey, JSON.stringify(current));
  return current.shortcuts;
}

async function shortcutSlot(id, slot, signal) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= 4)
    throw new PlaybackError(3, 'Choose one of the four direction buttons.');
  return (await shortcutNamespace(id, signal)) + '.' + slot;
}

function readShortcut(key) {
  try {
    const uri = localStorage.getItem(key);
    return typeof uri === 'string' && /^spotify:playlist:[A-Za-z0-9]{22}$/u.exec(uri)?.[0] === uri ? uri : null;
  } catch {
    throw new PlaybackError(3, 'Allow local browser storage for your playlist shortcuts.');
  }
}

function shortcutSelection(page, index) {
  if (page?.source?.kind !== 'playlist' || page.source.destinationFor)
    throw new PlaybackError(3, 'Select a playlist from your library to assign this shortcut.');
  return selectedRow(page, index, 'playlist').uri;
}

function writeShortcut(key, uri) {
  try {
    if (uri) localStorage.setItem(key, uri);
    else localStorage.removeItem(key);
  } catch {
    throw new PlaybackError(3, 'Allow local browser storage to save your playlist shortcut.');
  }
}

async function changeShortcut(id, slot, signal, update) {
  const grant = sessionMarker(id);
  const key = await shortcutSlot(id, slot, signal);
  // Tabs signed in to the same account share these slots. Decide and write under one lock.
  return navigator.locks.request(key, {signal}, () => {
    signal.throwIfAborted();
    if (sessionMarker(id) !== grant) throw new PlaybackError(1, 'The Spotify account changed.');
    return update(key);
  });
}

export async function setShortcut(id, slot, page, index, signal) {
  const uri = page ? shortcutSelection(page, index) : null;
  await changeShortcut(id, slot, signal, key => writeShortcut(key, uri));
}

async function resolveShortcut(id, uri, signal) {
  const entry = await request(id, 'playlists/' + uri.slice('spotify:playlist:'.length) + '?fields=uri,name', signal);
  const row = rowFor(entry, 'playlist');
  if (!row.uri || row.uri !== uri)
    throw new PlaybackError(3, 'This playlist is unavailable. Assign another playlist.');
  return row;
}

async function playShortcutUri(id, grant, uri, signal) {
  if (sessionMarker(id) !== grant) throw new PlaybackError(1, 'The Spotify account changed.');
  await resolveShortcut(id, uri, signal);
  if (sessionMarker(id) !== grant) throw new PlaybackError(1, 'The Spotify account changed.');
  await request(id, 'me/player/play', signal, 'PUT', {context_uri:uri});
}

export async function playShortcut(id, slot, signal) {
  const grant = sessionMarker(id);
  const uri = readShortcut(await shortcutSlot(id, slot, signal));
  if (!uri) throw new PlaybackError(6, 'Assign a playlist to this button first.');
  await playShortcutUri(id, grant, uri, signal);
}

export async function holdPlaylistShortcut(id, slot, page, index, signal) {
  const grant = sessionMarker(id);
  const selected = shortcutSelection(page, index);
  const existing = await changeShortcut(id, slot, signal, key => {
    const prior = readShortcut(key);
    if (!prior) writeShortcut(key, selected);
    return prior;
  });
  if (existing) await playShortcutUri(id, grant, existing, signal);
  return Boolean(existing);
}

export async function shortcutPage(id, signal) {
  const prefix = await shortcutNamespace(id, signal);
  const resolved = new Map();
  const rows = [];
  for (let slot = 0; slot < 4; slot++) {
    const uri = readShortcut(prefix + '.' + slot);
    if (uri && !resolved.has(uri)) {
      try {
        resolved.set(uri, await resolveShortcut(id, uri, signal));
      } catch (error) {
        if (!(error instanceof PlaybackError) || error.code !== 3) throw error;
        resolved.set(uri, {label:'Unavailable'});
      }
    }
    rows.push(resolved.get(uri) || {label:'Unassigned'});
  }
  return {kind:'shortcut', rows, offset:0, hasNext:false, hasPrev:false};
}

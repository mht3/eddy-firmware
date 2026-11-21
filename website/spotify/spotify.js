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

export function unlink() {
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

function rateLimit(response) {
  const seconds = Number(response.headers.get('Retry-After'));
  return new PlaybackError(4, 'Spotify is busy. Wait a moment, then retry on your Flipper.',
    seconds > 0 ? seconds * 1000 : 30000);
}

async function exchange(params, signal) {
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST', body: new URLSearchParams(params), credentials: 'omit', cache: 'no-store', signal,
  });
  if (response.status === 429) throw rateLimit(response);
  if (response.status === 400 || response.status === 401) throw new PlaybackError(1, 'Your sign-in expired. Link Spotify again.');
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
    scope: token.scope ?? previous?.scope ?? scopes.join(' ')};
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
  store(id, token);
}

async function request(id, path, signal, method = 'GET', body, retry = false) {
  let account = read(accountKey);
  if (account?.id !== id || !hasScopes(account.scope)) throw new PlaybackError(1, 'Link Spotify to access your library.');
  if (retry || account.expires - Date.now() < 60000) {
    const token = await exchange({grant_type: 'refresh_token', refresh_token: account.refresh, client_id: id}, signal);
    signal.throwIfAborted();
    account = store(id, token, account);
  }
  const headers = {Authorization: 'Bearer ' + account.token};
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch('https://api.spotify.com/v1/' + path, {
    method, body: body ? JSON.stringify(body) : undefined,
    credentials: 'omit', cache: 'no-store', signal, headers,
  });
  if (response.status === 401 && !retry) return request(id, path, signal, method, body, true);
  if (response.status === 401) throw new PlaybackError(1, 'Your Spotify session expired. Link Spotify again.');
  if (response.status === 403 && method === 'GET' && path.startsWith('playlists/'))
    throw new PlaybackError(3, 'Spotify allows browsing playlists you own or collaborate on. You can still choose Play for other playlists.');
  if (response.status === 403) throw new PlaybackError(3, 'Spotify declined access. Check account eligibility and use an active Premium player for playback.');
  if (response.status === 404 && path.startsWith('me/player/')) throw new PlaybackError(0, 'Open Spotify on your playback device and play a song, then try again.');
  if (response.status === 429) throw rateLimit(response);
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
  const {kind, query, artist, destinationFor} = source;
  if (kind === 'now') {
    const state = await request(id, 'me/player/currently-playing', signal);
    const rows = state?.item?.type === 'track' ? [rowFor(state.item, 'track')] : [];
    return {kind:'track', source, offset:0, rows, hasNext:false, hasPrev:false,
      playState: rows.length ? (state.is_playing ? 1 : 2) : 0};
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
  if (query) {
    const fetchBatch = async (start, limit) => {
      const params = new URLSearchParams({q:query, type:kind, limit, offset:start});
      const result = (await request(id, 'search?' + params, signal))?.[kind + 's'];
      validatePage(result, start, limit);
      return result;
    };
    if (artist) return filteredPage(source, offset, start => fetchBatch(start, 10),
      item => item?.artists?.some(by => by.uri === artist || 'spotify:artist:' + by.id === artist), kind);
    const result = await fetchBatch(offset, pageSize);
    return {kind, source, offset, rows:result.items.map(item => rowFor(item, kind)),
      hasPrev:offset > 0, hasNext:Boolean(result.next)};
  }
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

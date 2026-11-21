const pendingKey = 'eddy.spotify.library.pkce';
const accountKey = 'eddy.spotify.library.session';
const scopes = ['user-library-read', 'playlist-read-private', 'playlist-read-collaborative', 'user-modify-playback-state'];
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

async function request(id, path, signal, body, retry = false) {
  let account = read(accountKey);
  if (account?.id !== id || !hasScopes(account.scope)) throw new PlaybackError(1, 'Link Spotify to access your library.');
  if (retry || account.expires - Date.now() < 60000) {
    const token = await exchange({grant_type: 'refresh_token', refresh_token: account.refresh, client_id: id}, signal);
    signal.throwIfAborted();
    account = store(id, token, account);
  }
  const headers = {Authorization: 'Bearer ' + account.token};
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch('https://api.spotify.com/v1/me/' + path, {
    method: body ? 'PUT' : 'GET', body: body ? JSON.stringify(body) : undefined,
    credentials: 'omit', cache: 'no-store', signal, headers,
  });
  if (response.status === 401 && !retry) return request(id, path, signal, body, true);
  if (response.status === 401) throw new PlaybackError(1, 'Your Spotify session expired. Link Spotify again.');
  if (response.status === 403) throw new PlaybackError(3, 'Spotify declined access. Check account eligibility and use an active Premium player for playback.');
  if (response.status === 404) throw new PlaybackError(0, 'Open Spotify on your playback device and play a song, then try again.');
  if (response.status === 429) throw rateLimit(response);
  if (!response.ok) throw new PlaybackError(2, 'Spotify could not complete that request. Please try again.');
  return body ? null : response.json();
}

export async function libraryPage(id, kind, offset, signal) {
  // Playlists are direct objects. Saved tracks and albums are wrapped with a saved-at date.
  const result = await request(id, kind + 's?limit=' + pageSize + '&offset=' + offset, signal);
  if (result.offset !== offset || !Array.isArray(result.items) || result.items.length > pageSize) {
    throw new PlaybackError(2, 'Spotify returned an incomplete library page. Try again.');
  }
  const rows = result.items.map(item => {
    const entry = kind === 'playlist' ? item : item?.[kind];
    const name = entry?.name || 'Unavailable ' + kind;
    const by = kind === 'playlist' ? entry?.owner?.display_name :
      entry?.artists?.map(artist => artist.name).filter(Boolean).join(', ');
    const uri = entry?.uri || '';
    const match = /^spotify:(track|album|playlist):([a-zA-Z0-9]{22})$/.exec(uri);
    const href = match && match[0] === uri && match[1] === kind ?
      'https://open.spotify.com/' + kind + '/' + match[2] : null;
    const playable = href && !entry.is_local && entry.is_playable !== false && !entry.restrictions?.reason;
    return {label: by ? name + ' - ' + by : name, href, uri: playable ? uri : null};
  });
  return {kind, offset, rows, hasPrev: offset > 0, hasNext: Boolean(result.next)};
}

export async function playLibraryItem(id, page, index, signal) {
  const uri = page.rows[index]?.uri;
  if (!uri) throw new PlaybackError(3, 'Spotify cannot play that library item on this device.');
  const body = page.kind === 'track' ? {uris: [uri]} : {context_uri: uri};
  await request(id, 'player/play', signal, body);
}

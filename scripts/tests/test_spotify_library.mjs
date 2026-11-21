// Run with node --test scripts/tests/test_spotify_library.mjs (Node 22+).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setImmediate as tick} from 'node:timers/promises';

const id = '0'.repeat(32);
const scopes = 'user-library-read playlist-read-private playlist-read-collaborative user-modify-playback-state';
const storage = new Map();
const redirect = 'https://example.org/eddy-firmware/spotify/';
globalThis.location = {href: redirect, pathname: '/eddy-firmware/spotify/', search: '',
  assign(url) { this.destination = new URL(url); }};
globalThis.history = {replaceState() { location.search = ''; }};
globalThis.sessionStorage = {getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value),
  removeItem: key => storage.delete(key)};
const auth = await import('../../website/spotify/spotify.js');
const {startBridge} = await import('../../website/spotify/bridge.js');

async function signIn(scope = scopes, corruptState = false) {
  await auth.authorize(id);
  const args = location.destination.searchParams;
  assert.equal(args.get('scope'), scopes);
  assert.equal(args.get('redirect_uri'), redirect);
  assert.equal(args.get('show_dialog'), 'true');
  assert.equal(args.get('code_challenge_method'), 'S256');
  location.search = '?' + new URLSearchParams({code: 'code', state: corruptState ? 'wrong' : args.get('state')});
  globalThis.fetch = async (url, {body}) => {
    assert.equal(url, 'https://accounts.spotify.com/api/token');
    assert.equal(body.get('redirect_uri'), redirect);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.get('code_verifier')));
    assert.equal(args.get('code_challenge'), Buffer.from(digest).toString('base64url'));
    return Response.json({scope, access_token: 'access', refresh_token: 'refresh', expires_in: 3600});
  };
  await auth.callback(id);
}

test('Spotify library requires a new PKCE grant with library access', async () => {
  storage.set('eddy.music.session', JSON.stringify({id, token: 'old-playback-grant'}));
  assert.equal(auth.linked(id), false);
  await assert.rejects(signIn(scopes, true), /expired|another tab/);
  await assert.rejects(signIn('user-modify-playback-state'), /grant access/);
  await assert.rejects(signIn('user-library-read user-modify-playback-state'), /grant access/);
  assert.equal(auth.linked(id), false);
  await signIn();
  assert.equal(auth.linked(id), true);
  auth.unlink();
  assert.equal(auth.linked(id), false);
});

function flipper() {
  const device = new EventTarget(), controls = new EventTarget(), frames = [];
  controls.startNotifications = async () => {};
  const state = {writeValueWithResponse: async bytes => { frames.push([...bytes]); }};
  const service = {getCharacteristic: async uuid => uuid.startsWith('efdd0002') ? state : controls};
  let choices = 0;
  device.gatt = {connected: false, async connect() { this.connected = true; return {getPrimaryService: async () => service}; },
    disconnect() { this.connected = false; }};
  Object.defineProperty(navigator, 'bluetooth', {configurable: true, value: {requestDevice: async () => { choices++; return device; }}});
  return {
    frames,
    get choices() { return choices; },
    drop() { device.gatt.disconnect(); device.dispatchEvent(new Event('gattserverdisconnected')); },
    send(...bytes) {
      controls.value = new DataView(Uint8Array.from(bytes).buffer);
      controls.dispatchEvent(new Event('characteristicvaluechanged'));
    },
  };
}

async function drain() { for (let i = 0; i < 3; i++) await tick(); }

test('signed-in Flipper browses real response rows and plays only the displayed page', async () => {
  await signIn();
  const dom = Object.fromEntries(['bridge','notice','link','pair','disconnect','unlink'].map(key => [key, {}]));
  const list = dom['library-links'] = {replaceChildren(...children) { this.children = children; }};
  globalThis.document = {getElementById: key => dom[key], createElement: tag =>
    ({tag, append(child) { this.child = child; }})};
  globalThis.window = new EventTarget();
  const device = flipper();
  const calls = [];
  let playbackStatus = 204;
  const song = (n, name) => ({track: {name, uri: 'spotify:track:' + String(n).padStart(22, '0'),
    artists: [{name: 'Artist'}]}});
  globalThis.fetch = async (url, options) => {
    const {pathname, searchParams} = new URL(url);
    calls.push([pathname, options.method, options.body]);
    assert.equal(options.headers.Authorization, 'Bearer access');
    if (pathname === '/v1/me/tracks') {
      const offset = Number(searchParams.get('offset'));
      assert.equal(searchParams.get('limit'), '4');
      return Response.json({offset, next: offset ? null : 'next', items: offset ?
        [song(5, 'Page two'), {track: {name:'Invalid', uri:'spotify:track:../outside'}}] :
        [song(1, 'カ'.repeat(45)), song(2, 'Second'), song(3, 'Third'), song(4, '<Fourth>')]});
    }
    if (pathname === '/v1/me/playlists' || pathname === '/v1/me/albums') {
      const offset = Number(searchParams.get('offset'));
      const kind = pathname.endsWith('albums') ? 'album' : 'playlist';
      const item = {name: kind + offset, uri: 'spotify:' + kind + ':' + String(offset).padStart(22, '0'),
        owner: {display_name: 'DJ'}, artists: [{name: 'Band'}]};
      return Response.json({offset, next: offset ? null : 'next', items: [kind === 'album' ? {album: item} : item]});
    }
    assert.equal(pathname, '/v1/me/player/play');
    assert.equal(options.headers['Content-Type'], 'application/json');
    return new Response(null, {status: playbackStatus});
  };
  await startBridge(id);
  await dom.pair.onclick();
  assert.deepEqual(device.frames, [[0x15]]);
  device.send(1); // Generic Music's single-byte notification.
  device.send(0x15, 254, 0, 0, 0); // Native session discovery, without reading library data.
  await drain();
  assert.equal(calls.length, 0);
  assert.deepEqual(device.frames, [[0x15],[0x15]]);
  device.send(0x10, 1, 0, 0, 0);
  await drain();
  assert.deepEqual(device.frames.at(-1), [0x12,1,0,4,0,1,0,0,0,0]);
  assert.equal(list.hidden, false);
  assert.deepEqual(list.children.map(li => li.child.href), [1,2,3,4].map(n =>
    'https://open.spotify.com/track/' + String(n).padStart(22, '0')));
  assert.equal(list.children[3].child.textContent, '<Fourth> - Artist');
  const text = device.frames.filter(p => p[0] === 0x11 && p[3] === 0).flatMap(p => p.slice(4));
  assert(device.frames.every(p => p.length <= 20));
  assert.equal(new TextDecoder('utf-8', {fatal: true}).decode(Uint8Array.from(text)), 'カ'.repeat(26));
  device.send(0x11, 2, 0, 1, 0);
  assert.equal(list.hidden, true);
  await drain();
  assert.deepEqual(device.frames.at(-1), [0x12,2,0,2,1,0,4,0,0,0]);
  assert.equal(list.children.length, 1); // The invalid URI cannot generate a source link.
  device.send(0x20, 3, 0, 1, 0); // A stale base must never choose page two's first row.
  await drain();
  assert.deepEqual(device.frames.at(-1), [0x13,3,0,3]);
  device.send(0x21, 4, 0, 2, 0); // Unavailable row.
  await drain();
  assert.deepEqual(device.frames.at(-1), [0x13,4,0,3]);
  assert.equal(calls.filter(c => c[1] === 'PUT').length, 0);
  device.send(0x20, 5, 0, 2, 0);
  await drain();
  assert.deepEqual(device.frames.at(-1), [0x14,5,0,0]);
  assert.deepEqual(JSON.parse(calls.at(-1)[2]), {uris: [song(5).track.uri]});
  device.send(0x20, 5, 0, 2, 0);
  await drain();
  assert.equal(calls.filter(c => c[1] === 'PUT').length, 1);
  playbackStatus = 404;
  device.send(0x20, 6, 0, 2, 0);
  await drain();
  assert.deepEqual(device.frames.at(-1), [0x13,6,0,0]);
  device.send(0x12, 7, 0, 2, 0);
  await drain();
  assert.deepEqual(device.frames.at(-1), [0x12,7,0,4,0,1,0,0,0,0]);
  playbackStatus = 204;
  for (const [op, token, kind, suffix] of [[0x18,10,'playlist','DJ'], [0x19,20,'album','Band']]) {
    device.send(op, token, 0, 0, 0);
    await drain();
    assert.deepEqual(device.frames.at(-1), [0x12,token,0,1,0,1,0,0,0,0]);
    assert.equal(list.children[0].child.href, 'https://open.spotify.com/'+kind+'/'+'0'.repeat(22));
    const label = device.frames.filter(p => p[0] === 0x11 && p[1] === token).flatMap(p => p.slice(4));
    assert.equal(Buffer.from(label).toString(), kind + '0 - ' + suffix);
    device.send(0x20, token+1, 0, 7, 0); // Old Liked Songs page after changing categories.
    await drain();
    assert.deepEqual(device.frames.at(-1), [0x13,token+1,0,3]);
    device.send(0x11, token+2, 0, token, 0);
    await drain();
    assert.deepEqual(device.frames.at(-1), [0x12,token+2,0,1,1,0,4,0,0,0]);
    device.send(0x20, token+3, 0, token+2, 0);
    await drain();
    assert.deepEqual(device.frames.at(-1), [0x14,token+3,0,0]);
    assert.deepEqual(JSON.parse(calls.at(-1)[2]), {context_uri: 'spotify:'+kind+':'+'4'.padStart(22, '0')});
  }
  device.send(0x16, 40, 0, 0, 0); // Back to the category menu clears personal links.
  assert.equal(list.hidden, true);
  assert.deepEqual(list.children, []);
  device.send(0x20, 41, 0, 22, 0);
  await drain();
  assert.deepEqual(device.frames.at(-1), [0x13,41,0,3]);
  device.send(0x10, 42, 0, 0, 0);
  await drain();
  assert.equal(list.children.length, 4);
  device.drop();
  await drain();
  assert.equal(auth.linked(id), true);
  assert.equal(list.hidden, true);
  assert.equal(dom.pair.textContent, 'Reconnect Flipper');
  // Allow the first background attempt to reconnect using the already-granted device.
  const beforeReconnect = device.frames.length;
  for (let i = 0; i < 30 && device.frames.length === beforeReconnect; i++) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(device.frames.length, beforeReconnect + 1);
  assert.equal(device.choices, 1);
  assert.deepEqual(device.frames.at(-1), [0x15]);
  device.send(0x20, 43, 0, 42, 0); // Drops invalidate the old page's row tokens.
  await drain();
  assert.deepEqual(device.frames.at(-1), [0x13,43,0,3]);
  device.drop();
  await drain();
  assert.equal(dom.disconnect.textContent, 'Stop reconnecting');
  await dom.disconnect.onclick();
  const framesWhenStopped = device.frames.length;
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal(device.frames.length, framesWhenStopped);
  assert.equal(dom.pair.textContent, 'Choose Flipper');
  await dom.pair.onclick();
  assert.equal(device.choices, 2);
  await dom.unlink.onclick();
  assert.deepEqual(list.children, []);
  assert.deepEqual(device.frames.at(-1), [0x16]);
  assert.equal(auth.linked(id), false);
  assert.match(dom.notice.textContent, /unlinked/);
});

test('device scan starts PKCE once, guide visits and linked accounts stay on the page', async () => {
  auth.unlink();
  const nodes = new Map();
  globalThis.document = {getElementById(key) {
    if (!nodes.has(key)) nodes.set(key, {});
    return nodes.get(key);
  }};
  globalThis.window = new EventTarget();
  location.destination = undefined;
  await startBridge(id);
  assert.equal(location.destination, undefined);
  await startBridge(id, true);
  assert.equal(location.destination.origin, 'https://accounts.spotify.com');
  assert.equal(location.destination.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(location.destination.searchParams.get('redirect_uri'), redirect);
  await signIn();
  location.destination = undefined;
  await startBridge(id, true);
  assert.equal(location.destination, undefined);
  assert.equal(nodes.get('pair').hidden, false);
  auth.unlink();
});

// Run with node --test scripts/tests/test_spotify_library.mjs (Node 22+).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setImmediate as tick} from 'node:timers/promises';

const id = '0'.repeat(32);
const scopes = 'user-library-read playlist-read-private playlist-read-collaborative user-modify-playback-state user-read-currently-playing user-read-playback-state playlist-modify-private playlist-modify-public';
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
    if (pathname === '/v1/playlists/'+'4'.padStart(22,'0')+'/items')
      return Response.json({offset:0, next:null, items:[{item:{...song(5, 'List song').track, type:'track'}}]});
    if (pathname === '/v1/albums/'+'4'.padStart(22,'0')+'/tracks')
      return Response.json({offset:0, next:null, items:[{...song(6, 'Album song').track, type:'track'}]});
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
    device.send(0x38, token+4, 0, token+2, 0);
    await drain();
    assert.deepEqual(device.frames.at(-1), [0x12,token+4,0,1,0,0,0,0,0,0]);
    assert.equal(list.children[0].child.textContent, (kind === 'album' ? 'Album song' : 'List song')+' - Artist');
    device.send(0x1d, token+5, 0, token+4, 0);
    await drain();
    assert.deepEqual(device.frames.at(-1), [0x12,token+5,0,1,1,0,4,0,0,0]);
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

test('search, artist matching, queue, owned playlist choices, Back and Now Playing over BLE', async t => {
  await signIn();
  const nodes = new Map();
  globalThis.document = {
    getElementById(key) {
      if (!nodes.has(key)) nodes.set(key, key === 'library-links' ? {replaceChildren() {}} : {});
      return nodes.get(key);
    },
    createElement() { return {append() {}}; },
  };
  globalThis.window = new EventTarget();
  const device = flipper();
  const writes = [], reads = [];
  const uri = (kind, index) => 'spotify:' + kind + ':' + String(index).padStart(22,'0');
  const artist = {name:'Eddy', uri:uri('artist', 5)};
  const track = {type:'track', name:'Tidé - Mix', duration_ms:240000, uri:uri('track', 1), artists:[artist]};
  let playing = true, progress = 8000;
  globalThis.fetch = async (url, options) => {
    const {pathname, searchParams} = new URL(url);
    if (options.method === 'POST' || options.method === 'PUT') {
      writes.push([pathname, searchParams.get('uri') ?? searchParams.get('position_ms'), options.body && JSON.parse(options.body)]);
      return new Response(null, {status:204});
    }
    reads.push(pathname);
    if (pathname === '/v1/me/player/queue') return Response.json({queue:[
      {type:'episode'}, ...Array.from({length:5}, () => track)]});
    if (pathname === '/v1/me') return Response.json({id:'owner'});
    if (pathname === '/v1/me/player/currently-playing')
      return playing === null ? new Response(null, {status:204}) :
        Response.json({is_playing:playing, progress_ms:progress, item:track});
    if (pathname === '/v1/me/playlists') {
      const items = Array.from({length:8}, (_, n) => ({name:'List '+n, uri:uri('playlist', n),
        owner:{id:n%3 === 0 ? 'other' : 'owner'}}));
      assert.equal(searchParams.get('limit'), '50');
      return Response.json({items, offset:0, next:null});
    }
    assert.equal(pathname, '/v1/search');
    const type = searchParams.get('type'), query = searchParams.get('q');
    if (type === 'artist') assert.equal(query, 'Eddy');
    if (type === 'track') assert(['Tidé & Sea', 'artist:"Eddy"'].includes(query));
    const items = type === 'artist' ? [artist] : [track];
    if (query.startsWith('artist:')) items.unshift({...track, name:'Other', artists:[{name:'Eddy', uri:uri('artist', 9)}]});
    return Response.json({[type+'s']:{offset:0, items, next:null}});
  };
  await startBridge(id);
  await nodes.get('pair').onclick();
  t.after(() => nodes.get('unlink').onclick());
  let token = 0;
  async function command(op, base = 0, query = '') {
    device.send(op, ++token, 0, base, 0, ...new TextEncoder().encode(query));
    await drain();
    return device.frames.at(-1);
  }
  const begin = (op, args) => device.frames.some(p => JSON.stringify(p) === JSON.stringify([0x10,op,0,...args]));
  const query = await command(0x1a, 0, 'Tidé & Sea');
  assert.deepEqual(query, [0x12,1,0,1,0,0,0,0,0,0]);
  assert.deepEqual(await command(0x28, 1), [0x14,2,0,0]);
  device.send(0x28,2,0,1,0);
  await drain();
  assert.deepEqual(writes, [['/v1/me/player/queue',track.uri,undefined]]);
  assert.deepEqual(await command(0x30, 1), [0x12,3,0,4,0,1,0,0,0,0]);
  assert.deepEqual(await command(0x11, 3), [0x12,4,0,1,1,0,4,0,0,0]);
  assert.deepEqual(await command(0x34, 4), [0x14,5,0,0]);
  device.send(0x34,5,0,4,0);
  await drain();
  assert.equal(writes.length, 2);
  assert.deepEqual(writes.at(-1), ['/v1/playlists/'+uri('playlist',7).split(':')[2]+'/items',null,{uris:[track.uri]}]);
  assert.equal(reads.filter(path => path === '/v1/me/playlists').length, 1);
  assert.deepEqual(await command(0x1d, 4), [0x12,6,0,1,0,0,0,0,0,0]);
  assert.deepEqual(await command(0x34, 4), [0x13,7,0,3]);
  assert.deepEqual(await command(0x34, 6), [0x13,8,0,3]);
  assert.equal(writes.length, 2);
  assert.deepEqual(await command(0x1b, 0, 'Eddy'), [0x12,9,0,1,0,0,0,0,0,0]);
  assert.deepEqual(await command(0x24, 9), [0x12,10,0,1,0,0,0,0,0,0]);
  assert.deepEqual(await command(0x1d, 10), [0x12,11,0,1,0,0,0,0,0,0]);
  const realNow = Date.now;
  let clock = realNow();
  Date.now = () => clock;
  t.after(() => { Date.now = realNow; });
  for (const [state, flag, count] of [[true,1,1],[false,2,1],[null,0,0]]) {
    clock += 16000;
    playing = state;
    const end = await command(0x1c);
    assert.deepEqual(end, [0x12,token,0,count,0,0,0,0,0,0]);
    const timing = Buffer.alloc(8);
    if (count) {
      timing.writeUInt32LE(8000, 0);
      timing.writeUInt32LE(240000, 4);
    }
    assert(begin(token, [flag, ...timing, count ? Buffer.byteLength(track.name) : 0]));
  }
  assert.deepEqual(await command(0x24, 11), [0x12,15,0,1,0,0,0,0,0,0]); // Polls retained the artist results.
  assert.deepEqual(await command(0x1e), [0x12,16,0,4,0,1,0,0,0,0]);
  assert.deepEqual(await command(0x11, 16), [0x12,17,0,1,1,0,4,0,0,0]);
  assert.equal(reads.filter(path => path.endsWith('/queue')).length, 1);
  const before = reads.length;
  device.send(0x1a, 22,0,0,0,0xc0,0xaf); // Invalid UTF-8.
  device.send(0x1a, 23,0,0,0,...Array(16).fill(97)); // Exceeds the negotiated frame.
  device.send(0x1b, 24,0,0,0); // Empty query.
  await drain();
  assert.equal(reads.length, before);

  // A foreground action still applies to the queue page while a background poll is stalled.
  const originalFetch = globalThis.fetch;
  let releasePoll;
  globalThis.fetch = (url, options) => {
    if (new URL(url).pathname.endsWith('/currently-playing'))
      return new Promise(resolve => { releasePoll = resolve; });
    return originalFetch(url, options);
  };
  clock += 16000;
  device.send(0x1c, 80,0,0,0);
  await drain();
  assert.equal(typeof releasePoll, 'function');
  assert.deepEqual(await command(0x28, 17), [0x14,18,0,0]);
  releasePoll(new Response(null, {status:204}));
  await drain();
  assert.deepEqual(device.frames.at(-1), [0x14,18,0,0]);

  // A throttled poll must also suppress unrelated requests until the server permits them.
  let throttled = 0;
  globalThis.fetch = async () => {
    throttled++;
    return new Response(null, {status:429, headers:{'Retry-After':'2'}});
  };
  assert.deepEqual(await command(0x1c), [0x13,19,0,4]);
  assert.deepEqual(await command(0x28,17), [0x13,20,0,4]);
  assert.equal(throttled, 1);
  clock += 2001;
  globalThis.fetch = originalFetch;
  assert.deepEqual(await command(0x28,17), [0x14,21,0,0]);
  playing = true;
  assert.deepEqual(await command(0x40), [0x14,22,0,0]);
  assert.deepEqual(writes.at(-1), ['/v1/me/player/seek','0',undefined]);
  progress = 1900;
  assert.deepEqual(await command(0x40), [0x14,23,0,0]);
  assert.equal(writes.at(-1)[0], '/v1/me/player/previous');
  assert.deepEqual(await command(0x41), [0x14,24,0,0]);
  assert.equal(writes.at(-1)[0], '/v1/me/player/pause');
  playing = false;
  assert.deepEqual(await command(0x41), [0x14,25,0,0]);
  assert.equal(writes.at(-1)[0], '/v1/me/player/play');
  assert.deepEqual(await command(0x42), [0x14,26,0,0]);
  assert.equal(writes.at(-1)[0], '/v1/me/player/next');
  const mutationCount = writes.length;
  device.send(0x42,26,0,0,0);
  await drain();
  assert.equal(writes.length, mutationCount);
});

test('sparse artist results bound each request and a canceled Next keeps its cursor intact', async () => {
  await signIn();
  const artist = 'spotify:artist:'+'2'.repeat(22);
  const source = {kind:'track', artist, query:'artist:"Eddy"'};
  const starts = [];
  let fail = false;
  globalThis.fetch = async url => {
    const start = Number(new URL(url).searchParams.get('offset'));
    starts.push(start);
    if (fail && start === 30) throw new Error('disconnected');
    const items = Array.from({length:10}, (_, i) => ({
      name:'Song '+(start+i), artists:[{uri:start >= 25 ? artist : 'another'}],
      uri:'spotify:track:'+String(start+i).padStart(22,'0'),
    }));
    return Response.json({tracks:{offset:start, items, next:start < 40 ? 'next' : null}});
  };
  const signal = new AbortController().signal;
  const first = await auth.libraryPage(id, source, 0, signal);
  assert.deepEqual(starts, [0,10]);
  assert.equal(first.rows.length, 0);
  assert.equal(first.hasNext, true);
  fail = true;
  await assert.rejects(auth.libraryPage(id, first.source, 4, signal), /disconnected/);
  fail = false;
  const second = await auth.libraryPage(id, first.source, 4, signal);
  assert.deepEqual(starts, [0,10,20,30,20,30]);
  assert.equal(second.rows[0].name, 'Song 30');
  assert.equal(first.source.cursor.pages.length, 1);
  auth.unlink();
});

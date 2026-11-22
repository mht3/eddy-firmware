import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {finishSignIn} from '../../website/spotify/session.js';

const file = name => readFile(new URL('../../website/spotify/' + name, import.meta.url), 'utf8');

test('public guide links to the demo and offers no account login', async () => {
  const html = await file('index.html');
  assert.match(html, /<h1>Spotify setup<\/h1>/);
  assert.match(html, /href="https:\/\/developer\.spotify\.com\/dashboard"/);
  for (const screenshot of ['dashboard.png', 'blank-create-app.png', 'completed-create-app.png', 'basic-information.webp']) {
    assert(html.includes('src="' + screenshot + '"'));
  }
  assert.doesNotMatch(html, /Using the Flipper buttons/);
  const demo = await file('../index.html');
  assert.match(demo, /<details id="spotify-buttons" hidden>/);
  assert.match(demo, /<summary>Using the Flipper buttons<\/summary>/);
  assert(html.indexOf('id="developer-setup"') < html.indexOf('id="try-spotify-preview"'));
  assert.match(html, /href="\.\.\/spotify-demo\/">Start guided tour<\/a>/);
  assert.doesNotMatch(html, /Try the sample library/i);
  assert.doesNotMatch(html, /href="[^"]*view=now-playing/);
  assert.doesNotMatch(html, /<input|startBridge|accounts\.spotify\.com|id="link"|eddy-personal-companion\.zip/);
  const config = await import('../../website/spotify/config.js');
  assert.equal(config.spotifyClientId, '');
  assert.equal(config.spotifyConfigured, false);
});

test('the installer never asks for a Spotify ID and the companion guide covers a closed beta', async () => {
  const installer = await file('../update/index.html');
  assert.doesNotMatch(installer, /spotify-client-id|Spotify Client ID/i);
  const setup = await file('index.html');
  assert.match(setup, /On <strong>Log in to Spotify<\/strong>, paste the Client ID/);
  const steps = ['iphone-settings', 'copy-client-id', 'install-spotify', 'connect-spotify', 'try-spotify-preview'];
  const offsets = steps.map(step => setup.indexOf('id="' + step + '"'));
  assert(offsets.every((offset, i) => offset >= 0 && (i === 0 || offset > offsets[i - 1])));
  assert(setup.includes('<code>eddyspotify://spotify-login</code>'));
  assert(setup.includes('<code>dev.eddyfirmware.spotify</code>'));
  const app = await file('../app/index.html');
  assert.match(app, /href="eddyspotify:\/\/setup"/);
  assert.match(app, /id="beta-availability"/);
  assert.match(app, /href="https:\/\/apps.apple.com\/app\/testflight\/id899247664"/);
});

test('previous QR codes and saved browser connections open Eddy and discard the old sign-in', async () => {
  const session = new Map([
    ['eddy.spotify.scan', 'old scan'],
    ['eddy.spotify.library.pkce', 'old challenge'],
    ['eddy.spotify.library.session', JSON.stringify({shortcuts: 'eddy.spotify.shortcuts.' + 'a'.repeat(43)})],
    ['unrelated', 'keep'],
  ]);
  const removed = [];
  globalThis.sessionStorage = {getItem:key => session.get(key) ?? null, removeItem:key => session.delete(key)};
  globalThis.localStorage = {removeItem:key => removed.push(key)};
  const next = [];
  globalThis.location = {pathname:'/eddy-firmware/s/', hash:'#' + 'a'.repeat(32), search:'', replace:url => next.push(new URL(url))};
  globalThis.history = {replaceState(_, __, path) { assert.equal(path, location.pathname); location.hash = ''; }};
  await import('../../website/s/scan.js');
  assert.equal(next[0].href, new URL('../../website/app/?open=1', import.meta.url).href);
  assert.equal(location.hash, '');
  assert.deepEqual([...session], [['unrelated', 'keep']]);
  assert.equal(removed.length, 4);

  // A stale bookmark also works when browser storage is completely disabled.
  globalThis.sessionStorage = {getItem() { throw Error('unavailable'); }, removeItem() { throw Error('unavailable'); }};
  location.pathname = '/eddy-firmware/spotify/connect/';
  await import('../../website/spotify/connect/connect.js');
  assert.equal(next[1].href, next[0].href);
  for (const path of ['../s/index.html', 'connect/index.html']) {
    const page = await file(path);
    assert.match(page, /href="[^"]*app\/\?open=1"/);
    assert.doesNotMatch(page, /id="pair"|Choose Flipper/);
  }
});

test('the Spotify guide returns only a well-formed iPhone OAuth result and never starts web sign-in', () => {
  const state = 'eddy-ios-' + 'A'.repeat(43);
  let target, cleaned;
  globalThis.location = {pathname:'/eddy-firmware/spotify/', search:'', replace(value) { target = new URL(value); }};
  globalThis.history = {replaceState(_, __, path) { cleaned = path; }};
  finishSignIn();
  assert.equal(target, undefined);
  assert.equal(cleaned, undefined);
  for (const [key, result] of [['code', 'once'], ['error', 'access_denied']]) {
    location.search = '?state=' + state + '&' + key + '=' + result + '&ignore=x';
    finishSignIn();
    assert.equal(cleaned, location.pathname);
    assert.equal(target.protocol, 'eddyspotify:');
    assert.equal(target.hostname, 'callback');
    assert.deepEqual([...target.searchParams], [['state', state], [key, result]]);
  }
  target = undefined;
  for (const invalid of ['code=', 'code=one&code=two', 'code=one&error=denied', 'error=']) {
    location.search = '?state=' + state + '&' + invalid;
    assert.throws(finishSignIn, /Incomplete iPhone/);
    assert.equal(target, undefined);
  }
  for (const invalidState of ['previous-web-session', state + '&state=' + state, '']) {
    location.search = '?code=once&state=' + invalidState;
    assert.throws(finishSignIn, /Open Eddy on your iPhone/);
    assert.equal(target, undefined);
    assert.equal(cleaned, location.pathname);
  }
});

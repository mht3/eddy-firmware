import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {finishScan, scanQr, scanSession, takeNotice} from '../../website/spotify/session.js';
import {linked} from '../../website/spotify/spotify.js';

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
  assert.match(html, /href="\.\.\/\?demo=spotify&amp;tour=1#home-screen">Start guided tour<\/a>/);
  assert.doesNotMatch(html, /Try the sample library/i);
  assert.doesNotMatch(html, /href="[^"]*view=now-playing/);
  assert.doesNotMatch(html, /<input|startBridge|accounts\.spotify\.com|id="link"|eddy-personal-companion\.zip/);
  const config = await import('../../website/spotify/config.js');
  assert.equal(config.spotifyClientId, '');
  assert.equal(config.spotifyConfigured, false);
});

test('scanning starts PKCE, callback consumes the grant once, and guide visits preserve it', async () => {
  const id = 'a'.repeat(32);
  const tab = new Map();
  globalThis.sessionStorage = {getItem:k => tab.get(k) ?? null, setItem:(k,v) => tab.set(k,v), removeItem:k => tab.delete(k)};
  let destination, replacements = [];
  globalThis.location = {pathname:'/eddy-firmware/s/', hash:'#' + id, search:'',
    assign(url) { destination = new URL(url); }, replace(url) { destination = new URL(url); }};
  globalThis.history = {replaceState(_, __, url) { replacements.push(url); location.hash = ''; location.search = ''; }};
  await scanQr();
  assert.equal(replacements.pop(), '/eddy-firmware/s/');
  assert.equal(destination.origin, 'https://accounts.spotify.com');
  assert.equal(destination.searchParams.get('client_id'), id);
  assert.equal(destination.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(destination.searchParams.get('redirect_uri'), new URL('../../website/spotify/', import.meta.url).href);
  const state = destination.searchParams.get('state');
  const challenge = destination.searchParams.get('code_challenge');
  const scope = destination.searchParams.get('scope');
  location.pathname = '/eddy-firmware/spotify/';
  let exchanges = 0;
  globalThis.fetch = async (url, opts) => {
    if (url === 'https://api.spotify.com/v1/me') return Response.json({id:'person', account_id:'person-profile'});
    assert.equal(url, 'https://accounts.spotify.com/api/token');
    assert.equal(opts.body.get('client_id'), id);
    assert.equal(opts.body.get('code'), 'once');
    assert.equal(opts.body.has('client_secret'), false);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(opts.body.get('code_verifier')));
    assert.equal(Buffer.from(digest).toString('base64url'), challenge);
    exchanges++;
    return Response.json({scope, access_token:'fixture',refresh_token:'refresh',expires_in:3600});
  };
  location.search = '?code=bad&state=other';
  await finishScan();
  assert.match(takeNotice(scanSession()), /expired|another tab/);
  assert.equal(exchanges, 0);
  location.search = '?code=once&state=' + state;
  await finishScan();
  assert.equal(replacements.pop(), '/eddy-firmware/spotify/');
  assert.equal(destination.href, new URL('../../website/spotify/connect/', import.meta.url).href);
  assert.equal(exchanges, 1);
  assert(linked(id));
  location.search = '?code=once&state=' + state;
  await finishScan();
  assert.equal(exchanges, 1);
  assert.match(takeNotice(scanSession()), /expired|another tab/);
  destination = undefined;
  await finishScan();
  assert.equal(destination, undefined);
  assert(linked(id));
  location.hash = '#' + id;
  await scanQr(); // Reopening after Flipper power loss resumes that tab's grant.
  assert.equal(destination.href, new URL('../../website/spotify/connect/', import.meta.url).href);
  tab.clear();
  location.search = '?code=once&state=' + state;
  await assert.rejects(finishScan(), /no pending/);
  assert.equal(exchanges, 1);
  location.hash = '#not-a-client-id';
  await assert.rejects(scanQr(), /scan its sign-in QR/);
  assert.equal(scanSession(), null);
  location.hash = '#' + id;
  await scanQr();
  const freshState = destination.searchParams.get('state');
  assert.notEqual(freshState, state);
  assert.notEqual(destination.searchParams.get('code_challenge'), challenge);
  location.search = '?error=access_denied&state=' + freshState;
  await finishScan();
  assert.match(takeNotice(scanSession()), /canceled/);
  assert.equal(exchanges, 1);
  assert.equal(linked(id), false);
});

import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import vm from 'node:vm';

const file = name => readFile(new URL('../../website/spotify/' + name, import.meta.url), 'utf8');
const script = await file('music.js');

test('public guide links to the demo and offers no account login', async () => {
  const html = await file('index.html');
  assert.match(html, /<h1>Spotify setup<\/h1>/);
  assert.match(html, /href="https:\/\/developer\.spotify\.com\/dashboard"/);
  for (const screenshot of ['create-app.webp', 'client-id.webp']) {
    assert(html.includes('src="' + screenshot + '"'));
  }
  assert.doesNotMatch(html, /Using the Flipper buttons/);
  const demo = await file('../index.html');
  assert.match(demo, /<details id="spotify-buttons" hidden>/);
  assert.match(demo, /<summary>Using the Flipper buttons<\/summary>/);
  assert(html.indexOf('id="developer-setup"') < html.indexOf('id="try-spotify-preview"'));
  assert.match(html, /href="\.\.\/\?demo=spotify#home-screen"/);
  assert.doesNotMatch(html, /href="[^"]*view=now-playing/);
  assert.doesNotMatch(html, /<input|startBridge|accounts\.spotify\.com|id="link"|eddy-personal-companion\.zip/);
  const config = await import('../../website/spotify/config.js');
  assert.equal(config.spotifyClientId, '');
  assert.equal(config.spotifyConfigured, false);
});

test('old QR and authorization returns go to the guide without exchanging credentials', () => {
  for (const suffix of ['#link', '?code=old&state=old', '?error=access_denied', '']) {
    const location = new URL('https://preview.example/spotify/' + suffix);
    const removed = [];
    let replacement, scrolled = false;
    vm.runInNewContext(script, {
      location, URLSearchParams, sessionStorage: {removeItem(key) { removed.push(key); }},
      history: {replaceState(_state, _title, url) { replacement = url; }},
      document: {getElementById(id) {
        assert.equal(id, 'developer-setup');
        return {scrollIntoView() { scrolled = true; }};
      }},
    });
    assert(removed.includes('eddy.spotify.library.session'));
    assert.equal(replacement, suffix ? '/spotify/#developer-setup' : undefined);
    assert.equal(scrolled, Boolean(suffix));
  }
});

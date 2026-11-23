import assert from 'node:assert/strict';
import {test} from 'node:test';
globalThis.Image=class {};
const {openSpotifyDemo,openSpotifyPlayer,spotifyKey,spotifyHit,spotifyStatus,drawSpotify}=await import('../../applications/main/eddy_spotify/source/demo/spotify-preview.js');
const {songs}=await import('../../applications/main/eddy_spotify/source/demo/spotify-demo-library.js');
const view=s=>s.views.at(-1);
function tapRow(s,row) { assert.equal(spotifyHit(s,20,13+12*row),true); }
function key(s,...keys) { for(const k of keys) assert.equal(spotifyKey(s,k),true); }
const ctx=new Proxy({measureText:text=>({width:text.length*4})},{get:(o,key)=>o[key]??(()=>{})});

test('players, playlist editing, and navigation work from each list page',()=>{
  const s=openSpotifyDemo();
  tapRow(s,0); tapRow(s,1); tapRow(s,0); tapRow(s,0); // On the Coast > Low Tide
  assert.equal(view(s).title,'Low Tide');
  const initialTrack=s.track, started=s.started;
  tapRow(s,1); assert.equal(s.queue.at(-1).id,1);
  assert.equal(s.track,initialTrack);
  assert.equal(s.started,started);
  assert.equal(view(s).kind,'playlist'); tapRow(s,0);
  tapRow(s,2); tapRow(s,0);
  assert.ok(s.playlists[0].tracks.includes(1));
  assert.equal(view(s).kind,'playlist'); tapRow(s,0);
  tapRow(s,2); tapRow(s,0);
  assert.equal(s.playlists[0].tracks.filter(id=>id===1).length,1);
  while(s.views.length>1) key(s,'back');
  key(s,'down','down','down'); assert.equal(view(s).row,3);
  key(s,'right'); assert.equal(view(s).kind,'player');
  key(s,'back'); assert.equal(view(s).row,3);
  spotifyHit(s,10,58); assert.equal(view(s).kind,'player');
  const queue=[...s.queue];
  key(s,'down'); assert.equal(view(s).kind,'destinations');
  assert.deepEqual(s.queue,queue);
  tapRow(s,1); assert(s.playlists[1].tracks.includes(s.track));
  key(s,'ok'); assert.equal(s.playing,false);
});

test('all four playlist holds are opt-in, persistent, replaceable and clearable',t=>{
  const saved=new Map();
  globalThis.localStorage={getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v)};
  t.after(()=>{delete globalThis.localStorage;});
  const s=openSpotifyDemo();
  assert.deepEqual(s.presets,{});
  key(s,'holdUp'); assert.equal(view(s).kind,'home'); assert.match(spotifyStatus(s),/No playlist on this button/);
  key(s,'ok','ok');
  const presets=['up','right','down','left'];
  for(let i=0;i<4;i++) {
    key(s,'hold'+presets[i][0].toUpperCase()+presets[i].slice(1));
    assert.equal(view(s).kind,'playlists');
    assert.equal(s.presets[presets[i]],s.playlists[i].id);
    key(s,'down');
  }
  key(s,'holdRight'); assert.equal(view(s).kind,'player'); assert.equal(s.track,s.playlists[1].tracks[0]);
  key(s,'back','holdOk','holdRight'); assert.equal(s.presets.right,s.playlists[0].id);
  key(s,'holdOk','left'); assert.equal(s.presets.left,s.playlists[0].id);
  const next=openSpotifyDemo();
  assert.deepEqual(next.presets,s.presets);
  for(const dir of presets) {
    const p=next.playlists.find(x=>x.id===next.presets[dir]);
    key(next,'hold'+dir[0].toUpperCase()+dir.slice(1));
    assert.equal(view(next).kind,'player'); assert.equal(next.track,p.tracks[0]);
    assert.deepEqual(next.queue.map(x=>x.id),p.tracks.slice(1));
  }
  key(next,'back','down','down','down','down','down','ok','ok');
  assert.equal(view(next).kind,'presetSlot');
  key(next,'down','down','ok'); assert.equal(next.presets.up,undefined);
  assert.equal(openSpotifyDemo().presets.up,undefined);
});

test('Now playing accepts only the controls available on the handheld',t=>{
  let seconds=0;
  t.mock.method(performance,'now',()=>seconds*1000);
  const s=openSpotifyPlayer(openSpotifyDemo());
  const before=spotifyStatus(s);
  key(s,'up');
  assert.equal(spotifyStatus(s),before);
  assert.equal(view(s).kind,'player');
  assert.equal(spotifyHit(s,80,34),false);
  assert.equal(s.elapsed,21);
  assert(spotifyHit(s,64,57)); assert.equal(s.playing,false);
  assert(spotifyHit(s,64,57)); assert.equal(s.playing,true);
  assert(spotifyHit(s,34,57)); assert.equal(s.elapsed,0);
  assert(spotifyHit(s,92,57)); assert.match(spotifyStatus(s),/Low Tide/);
  key(s,'left'); assert.match(spotifyStatus(s),/Dolphin Days/);
  seconds+=songs[0].seconds+1; assert.match(spotifyStatus(s),/Low Tide/);
  assert(spotifyHit(s,120,57)); assert.equal(view(s).kind,'destinations');
  key(s,'back','back'); assert.equal(view(s).kind,'home');
});

test('Queue offers the three handheld track actions, even if playback advances',()=>{
  const s=openSpotifyDemo();
  tapRow(s,2); tapRow(s,0); assert.equal(view(s).title,'Low Tide');
  s.elapsed=209; drawSpotify(ctx,s);
  const pending=[...s.queue];
  key(s,'up'); assert.match(spotifyStatus(s),/Add to playlist/);
  key(s,'up'); assert.match(spotifyStatus(s),/Add to queue/);
  key(s,'ok'); assert.deepEqual(s.queue,[...pending,{id:1}]);
});

test('Albums offer both browse and play from the collection menu',()=>{
  const s=openSpotifyDemo();
  key(s,'down','down','down','ok','ok','ok');
  assert.equal(view(s).kind,'album'); assert.equal(view(s).title,'Open Water');
  key(s,'back'); assert.equal(view(s).kind,'albums');
  key(s,'ok','down','ok'); assert.equal(view(s).kind,'player');
  assert.equal(s.track,0); assert.deepEqual(s.queue,[{id:4}]);
});

test('the demo describes how the device opens the iPhone companion',()=>{
  const s=openSpotifyDemo();
  key(s,'up','ok'); assert.equal(view(s).kind,'setup');
  assert.match(spotifyStatus(s),/QR code to open Eddy on your iPhone/);
  key(s,'ok'); assert.equal(view(s).kind,'home');
});

test('playing a track from a playlist continues with the next track in that playlist',()=>{
  const s=openSpotifyDemo();
  key(s,'ok','ok','ok'); // Morning Swim
  const tracks=s.playlists[view(s).value].tracks;
  key(s,'down','ok','ok'); // Play the second track
  assert.equal(view(s).kind,'player');
  assert.equal(s.track,tracks[1]);
  assert.deepEqual(s.queue.map(item=>item.id),tracks.slice(2));
  key(s,'right');
  assert.equal(s.track,tracks[2]);
  key(s,'back');
  assert.equal(view(s).kind,'playlist');
  assert.equal(view(s).row,1);
});

test('Liked Songs shortcuts work from Home, its track list and the Presets editor',t=>{
  const records=new Map();
  globalThis.localStorage={getItem:k=>records.get(k),setItem:(k,v)=>records.set(k,v)};
  t.after(()=>{delete globalThis.localStorage;});
  const s=openSpotifyDemo();
  key(s,'down','holdUp');
  assert.equal(s.presets.up,'liked-songs');
  key(s,'ok','holdOk','left');
  assert.equal(s.presets.left,'liked-songs');
  const next=openSpotifyDemo();
  key(next,'holdUp');
  assert.equal(view(next).kind,'player');
  assert.equal(next.queue.length,songs.length-1);
  key(next,'back','down','down','down','down','down','ok','up','ok','down','ok');
  assert.equal(next.presets.right,'liked-songs');
  key(next,'back','holdRight');
  assert.equal(next.track,0);
});

test('the fourth result is selectable on the LCD and scrolls into the next four-row page',()=>{
  const s=openSpotifyDemo();
  key(s,'down','ok');
  assert.equal(view(s).kind,'liked');
  assert(spotifyHit(s,4,47));
  assert.equal(view(s).title,songs[3].title);
  key(s,'back','down');
  assert.equal(view(s).row,4);
  assert(spotifyHit(s,4,21));
  assert.equal(view(s).title,songs[5].title);
  key(s,'back','down');
  assert.equal(view(s).row,4);
  key(s,'left');
  assert.equal(view(s).row,3);
});

test('the demo phone setup code matches the QR shipped with the Flipper app',async()=>{
  const {readFile}=await import('node:fs/promises');
  const {setupQr}=await import('../../applications/main/eddy_spotify/source/demo/spotify-demo-library.js');
  assert.deepEqual(Buffer.from(setupQr),await readFile(new URL('../../applications/main/eddy_spotify/source/assets/iphone_app.xbm',import.meta.url)));
});

// The browser draws integer rectangles into a 128×64 monochrome LCD. Keep this
// tiny Canvas implementation in the firmware's native vertical-page byte order.
function lcdFramebuffer() {
  const bytes = new Uint8Array(128 * 8);
  let bounds = [0, 0, 128, 64], path;
  const stack = [];
  return {
    bytes,
    globalCompositeOperation: 'source-over',
    save() { stack.push([bounds, this.globalCompositeOperation]); },
    restore() { [bounds, this.globalCompositeOperation] = stack.pop(); },
    beginPath() { path = undefined; },
    rect(x, y, w, h) { path = [x, y, x + w, y + h]; },
    clip() {
      bounds = [Math.max(bounds[0], path[0]), Math.max(bounds[1], path[1]),
        Math.min(bounds[2], path[2]), Math.min(bounds[3], path[3])];
    },
    fillRect(x, y, w, h) {
      const clear = this.globalCompositeOperation === 'destination-out';
      for (let py = Math.max(y, bounds[1]); py < Math.min(y + h, bounds[3]); py++) {
        for (let px = Math.max(x, bounds[0]); px < Math.min(x + w, bounds[2]); px++) {
          const index = (py >> 3) * 128 + px, mask = 1 << (py % 8);
          if (clear) bytes[index] &= ~mask;
          else bytes[index] |= mask;
        }
      }
    },
  };
}

test('Spotify paints the same framebuffer as the stock firmware renderer', async t => {
  const {createHash} = await import('node:crypto');
  t.mock.method(performance, 'now', () => 0);
  // SHA-256 of the 1,024 output bytes from spotify_screen_draw with u8g2,
  // default fonts, the demo library and Dolphin Days at 0:21. Battery is
  // composited by the system outside this view on both platforms.
  const frames = [
    ['Home', [], '7e122ddea66814cce85e31185d4558f978c7759d28c60865b7656010b49da794'],
    ['Playlists', ['ok','down'], '8fdbf5e0d05600c25d92aedfddbec77c77fd48c135763b9a075221e74ec2f218'],
    ['Collection actions', ['ok','ok','down'], 'c915c684d539bcb04f621b81cc0e83dfb505d3868f65135fc16d58f93454b7c7'],
    ['Playlist tracks', ['ok','ok','ok','down'], '7f5a3752d2417f29c1545947e07568e521c865e1d7a2620f5204086d134f169b'],
    ['Track actions', ['down','ok','ok','down','down'], 'ee534f5c836c8432ab5b343220092e108a716b709ff28fe972d3567797be418e'],
    ['Playing', ['right'], '3500a87e41db7905e8d2ddbbf37f727f9df836a44eabe7dd88ab1ec9d707c2fe'],
    ['Paused', ['right','ok'], '39fedb018158cf64b24fec83cf66b7567f8a3299000c021124b3faae402a3246'],
    ['Sign in QR', ['up','ok'], '1ae792b0f69b6ebacc9fdf735308973033703a651d8cb2ded8df227bd8bf6d41'],
    ['Presets', ['up','up','ok'], '19114d51cdd95eed341862b25d76a45d8adee76ddb078d3141ac727728191a2c'],
    ['Missing preset', ['holdDown'], '45947f132c8f132a49a47296bdb25f14f7868232048eb8849eadc9facce78cf6'],
    ['Preset saved', ['down','holdUp'], 'c4440742e44f25ad5c543b68be88443dc19e561a3bc2123a070250fc78c1aa84'],
  ];
  for (const [name, keys, reference] of frames) {
    const session = openSpotifyDemo(null, {persistPresets:false});
    keys.forEach(k => spotifyKey(session,k));
    const lcd = lcdFramebuffer();
    drawSpotify(lcd,session);
    assert.equal(createHash('sha256').update(lcd.bytes).digest('hex'),reference,name);
  }
});

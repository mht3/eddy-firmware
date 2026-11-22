import assert from 'node:assert/strict';
import {test} from 'node:test';
globalThis.Image=class {};
const {openSpotifyDemo,openSpotifyPlayer,spotifyKey,spotifyHit,spotifyStatus,spotifyVolumeAt,drawSpotify}=await import('../../website/spotify-preview.js');
const {songs}=await import('../../website/spotify-demo-library.js');
const view=s=>s.views.at(-1);
function tapRow(s,row) { assert.equal(spotifyHit(s,20,13+12*row),true); }
function key(s,...keys) { for(const k of keys) assert.equal(spotifyKey(s,k),true); }
const ctx=new Proxy({measureText:text=>({width:text.length*4})},{get:(o,key)=>o[key]??(()=>{})});

test('players, playlist editing, and navigation work from each list page',()=>{
  const s=openSpotifyDemo();
  tapRow(s,0); tapRow(s,1); tapRow(s,0); // On the Coast > Low Tide
  assert.equal(view(s).title,'Low Tide');
  const initialTrack=s.track, started=s.started;
  tapRow(s,1); assert.equal(s.queue.at(-1).id,1);
  assert.equal(s.track,initialTrack);
  assert.equal(s.started,started);
  tapRow(s,2); tapRow(s,0);
  assert.ok(s.playlists[0].tracks.includes(1));
  tapRow(s,2); tapRow(s,0);
  assert.equal(s.playlists[0].tracks.filter(id=>id===1).length,1);
  while(s.views.length>1) key(s,'back');
  key(s,'down','down','down'); assert.equal(view(s).row,3);
  key(s,'right'); assert.equal(view(s).kind,'player');
  key(s,'back'); assert.equal(view(s).row,3);
  spotifyHit(s,10,58); assert.equal(view(s).kind,'player');
  key(s,'down','ok'); assert.equal(view(s).kind,'volume');
  assert(spotifyVolumeAt(s,25,56)); assert.equal(s.volume,0);
  key(s,'up'); assert.equal(s.volume,5);
  assert(spotifyVolumeAt(s,-30,-8,true)); assert.equal(s.volume,100);
  key(s,'up','down','back'); assert.equal(s.volume,95);
  const queue=[...s.queue];
  key(s,'right','ok'); assert.equal(view(s).kind,'destinations');
  assert.deepEqual(s.queue,queue);
  tapRow(s,1); assert(s.playlists[1].tracks.includes(s.track));
  key(s,'up','ok'); assert.equal(s.playing,false);
});

test('all four playlist holds are opt-in, persistent, replaceable and clearable',t=>{
  const saved=new Map();
  globalThis.localStorage={getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v)};
  t.after(()=>{delete globalThis.localStorage;});
  const s=openSpotifyDemo();
  assert.deepEqual(s.presets,{});
  key(s,'holdUp'); assert.equal(view(s).kind,'home'); assert.match(spotifyStatus(s),/Set a preset/);
  key(s,'ok');
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
  key(next,'back','down','down','down','down','ok','ok');
  assert.equal(view(next).kind,'presetSlot');
  key(next,'down','down','ok'); assert.equal(next.presets.up,undefined);
  assert.equal(openSpotifyDemo().presets.up,undefined);
});

test('lyrics follow the playback clock while navigation and taps leave the text alone',t=>{
  let seconds=0;
  t.mock.method(performance,'now',()=>seconds*1000);
  const s=openSpotifyPlayer(openSpotifyDemo());
  key(s,'up'); assert.match(spotifyStatus(s),/one more wave/); // starts at 0:21
  seconds+=8; assert.match(spotifyStatus(s),/salt on my face/);
  const before=spotifyStatus(s);
  key(s,'up','ok');
  assert.equal(spotifyHit(s,12,18),false);
  assert.equal(spotifyHit(s,65,43),false);
  assert.equal(spotifyStatus(s),before);
  drawSpotify(ctx,s);
  key(s,'down'); assert.equal(view(s).kind,'player');
  key(s,'ok','up'); seconds+=45; assert.match(spotifyStatus(s),/salt on my face/);
  key(s,'back'); assert.equal(view(s).kind,'player');
  spotifyHit(s,2+123*70/songs[0].seconds,34); key(s,'up');
  assert.match(spotifyStatus(s),/harbor ringing/);
  key(s,'left'); assert.equal(view(s).kind,'lyrics'); assert.match(spotifyStatus(s),/Two fins/);
  assert.equal(s.playing,false);
  key(s,'right'); assert.equal(view(s).kind,'lyrics'); assert.match(spotifyStatus(s),/Low Tide.*Low tide at the landing/);
  key(s,'left'); assert.equal(view(s).kind,'lyrics'); assert.match(spotifyStatus(s),/Dolphin Days.*Two fins/);
  seconds+=songs[0].seconds+6; assert.match(spotifyStatus(s),/Low Tide.*boats lean/);
  seconds+=songs[1].seconds+2; assert.match(spotifyStatus(s),/High Tide.*One rung/);
  spotifyHit(s,65,57); assert.equal(view(s).kind,'player');
  key(s,'back'); assert.equal(view(s).kind,'home');
  for(const song of songs) {
    assert.equal(song.cues[0][0],0);
    assert(song.cues.every(([at,line],i)=>line.length>0 && at<song.seconds && (!i||at>song.cues[i-1][0])));
  }
});

test('a stale queue row cannot remove another song after a natural transition',()=>{
  const s=openSpotifyDemo();
  tapRow(s,2); tapRow(s,0); assert.equal(view(s).title,'Low Tide');
  s.elapsed=209; drawSpotify(ctx,s);
  assert.equal(s.track,1);
  const pending=[...s.queue]; tapRow(s,1);
  assert.deepEqual(s.queue,pending); assert.match(spotifyStatus(s),/already played/);
});

test('the informational setup guide can be opened from the home menu',()=>{
  const s=openSpotifyDemo();
  key(s,'up','ok'); assert.equal(view(s).kind,'setup');
  assert.match(spotifyStatus(s),/personal Spotify setup guide/);
  key(s,'ok'); assert.equal(view(s).kind,'home');
});

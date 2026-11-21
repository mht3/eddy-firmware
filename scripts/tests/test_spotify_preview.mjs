import assert from 'node:assert/strict';
import {test} from 'node:test';
globalThis.Image=class {};
const {openSpotifyDemo,spotifyKey,spotifyHit,searchSpotifyDemo,spotifyStatus,drawSpotify}=await import('../../website/spotify-preview.js');
const view=state=>state.views.at(-1);
function tapRow(state,row) {
  assert.equal(spotifyHit(state,20,13+12*row),true);
}

test('playlist art, search, library edits, and playing strip work in the local sample',()=>{
  const s=openSpotifyDemo();
  tapRow(s,0); tapRow(s,1);
  assert.equal(view(s).title,'On the Coast');
  tapRow(s,0); assert.equal(view(s).title,'Low Tide');
  tapRow(s,1); assert.equal(s.queue.at(-1).id,1);
  tapRow(s,2); tapRow(s,0);
  assert.ok(s.playlists[0].tracks.includes(1));
  tapRow(s,2); tapRow(s,0);
  assert.equal(s.playlists[0].tracks.filter(id=>id===1).length,1);
  while(s.views.length>1) spotifyKey(s,'back');
  let asked=false; spotifyHit(s,20,30,()=>{asked=true;});
  assert.equal(asked,true);
  searchSpotifyDemo(s,'  mara cove ');
  tapRow(s,0); assert.equal(view(s).kind,'artist');
  tapRow(s,0); assert.equal(view(s).title,'Dolphin Days');
  tapRow(s,0); assert.equal(view(s).kind,'player');
  spotifyKey(s,'up'); assert.equal(view(s).kind,'lyrics');
  spotifyKey(s,'down'); assert.match(spotifyStatus(s),/shadow swims/);
  spotifyHit(s,10,58); assert.equal(view(s).kind,'player');
  spotifyKey(s,'ok'); assert.equal(s.playing,false);
  searchSpotifyDemo(s,'nonexistent');
  assert.match(spotifyStatus(s),/No matches/);
  searchSpotifyDemo(s,'  HIGH '); tapRow(s,0); assert.equal(view(s).title,'High Tide');
});

test('queue actions keep the selected entry when the active song ends',()=>{
  const s=openSpotifyDemo();
  tapRow(s,2); tapRow(s,0);
  assert.equal(view(s).title,'Low Tide');
  s.elapsed=209;
  const ctx=new Proxy({measureText:text=>({width:text.length*4})},{get:(o,key)=>o[key]??(()=>{})});
  drawSpotify(ctx,s);
  assert.equal(s.track,1);
  const pending=[...s.queue];
  tapRow(s,1);
  assert.deepEqual(s.queue,pending);
  assert.match(spotifyStatus(s),/already played/);
});

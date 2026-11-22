import assert from 'node:assert/strict';
import {test} from 'node:test';

globalThis.Image=class {};
const {startSpotifyTour,spotifyTourSteps}=await import('../../website/spotify-tour.js');
const {openSpotifyDemo,spotifyKey,spotifyStatus}=await import('../../website/spotify-preview.js');
const {songs}=await import('../../website/spotify-demo-library.js');
const perform=(tour,key)=>{spotifyKey(tour.state,key);return tour.observe(key);};
const reach=(tour,id)=>{
  while(tour.step && tour.step.id!==id) assert(perform(tour,tour.step.key));
  assert.equal(tour.step?.id,id);
};

test('tour advances through actual model transitions and leaves personal presets untouched',t=>{
  const records=new Map();
  let reads=0,writes=0;
  globalThis.localStorage={getItem:k=>{reads++;return records.get(k)??null;},
    setItem:(k,v)=>{writes++;records.set(k,v);}};
  t.after(()=>{delete globalThis.localStorage;});
  const personal=openSpotifyDemo();
  spotifyKey(personal,'ok');spotifyKey(personal,'holdLeft');
  assert.equal(personal.presets.left,'morning-swim');
  const activity=[reads,writes], original=JSON.stringify(personal);
  const tour=startSpotifyTour(),state=tour.state;
  assert.deepEqual(state.presets,{});
  for(const [index,step] of spotifyTourSteps.entries()) {
    assert.equal(tour.step.id,step.id);assert.equal(tour.index,index);
    assert.equal(tour.observe(step.key),false,'reporting a key without its effect cannot advance');
    assert.equal(tour.retry(),state);
    assert(perform(tour,step.key),'the control must perform '+step.id);
  }
  assert(tour.complete);assert.equal(tour.step,undefined);
  assert.equal(state.presets.left,'on-the-coast');
  assert.equal(JSON.stringify(personal),original);assert.deepEqual([reads,writes],activity);
  assert.deepEqual(openSpotifyDemo().presets,personal.presets);
});

test('a wrong action, Back, exit, and stale key events cannot earn a lesson',()=>{
  const tour=startSpotifyTour();
  spotifyKey(tour.state,'ok');
  assert.equal(tour.observe('down'),false);
  assert.equal(tour.observe('ok'),false);
  assert.equal(perform(tour,'back'),false);
  assert(perform(tour,'ok'));
  assert.equal(perform(tour,'back'),false);
  assert.equal(perform(tour,'down'),false);assert.equal(tour.step.id,'choose');
  tour.retry();assert(perform(tour,'down'));
  assert.equal(tour.step.id,'open');
  tour.exit();
  assert.equal(tour.step,undefined);assert.equal(perform(tour,'ok'),false);
  tour.restart();assert.equal(tour.step.id,'library');
  assert.equal(tour.state.views.at(-1).kind,'home');
});

test('a browsed song queues next, then lyrics switch to it without leaving Lyrics',t=>{
  let seconds=0; t.mock.method(performance,'now',()=>seconds*1000);
  const tour=startSpotifyTour(),s=tour.state;
  const dolphin=songs.findIndex(song=>song.title==='Dolphin Days');
  const glass=songs.findIndex(song=>song.title==='Sea Glass');
  assert.equal(s.track,dolphin); assert.deepEqual(s.queue,[]);
  reach(tour,'enqueue');
  assert.equal(s.views.at(-1).kind,'song'); assert.equal(s.views.at(-1).value,glass);
  const clock=[s.started,s.elapsed,s.playing];
  seconds+=4;
  assert(perform(tour,'ok')); assert.equal(s.track,dolphin);
  assert.deepEqual([s.started,s.elapsed,s.playing],clock);
  assert.deepEqual(s.queue.map(row=>row.id),[glass]);
  reach(tour,'skip');
  const depth=s.views.length;
  assert.equal(s.views.at(-1).kind,'lyrics'); assert.match(spotifyStatus(s),/Dolphin Days/);
  assert(perform(tour,'right')); assert.equal(s.track,glass); assert.deepEqual(s.queue,[]);
  assert.equal(s.views.length,depth); assert.equal(s.views.at(-1).kind,'lyrics');
  assert.match(spotifyStatus(s),/Green glass in the sand/);
  seconds+=8; assert.match(spotifyStatus(s),/Edges softened by the sea/);
  assert(perform(tour,'down')); assert.equal(tour.step.id,'assign');
});

test('Back completes the return lesson only when it actually closes Lyrics',()=>{
  const tour=startSpotifyTour();
  reach(tour,'return');
  assert.equal(tour.step.alternateKey,'back');
  assert.equal(tour.observe('back'),false);
  assert.equal(perform(tour,'back'),true);
  assert.equal(tour.step.id,'assign');
});

test('retry reconstructs a fresh queue and clock after the tutorial is left idle',t=>{
  let seconds=0; t.mock.method(performance,'now',()=>seconds*1000);
  const tour=startSpotifyTour();reach(tour,'skip');
  seconds=3600;spotifyStatus(tour.state);
  assert.equal(tour.state.queue.length,0);assert.equal(tour.state.playing,false);
  assert.equal(perform(tour,'right'),false);
  const state=tour.state;assert.equal(tour.retry(),state);
  assert.equal(state.started,seconds*1000);assert(state.queue.length);assert(state.playing);
  assert(perform(tour,'right'));assert.equal(tour.step.id,'return');
});

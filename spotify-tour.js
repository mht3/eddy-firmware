import {openSpotifyDemo,spotifyKey} from './spotify-preview.js';

function snapshot(s) {
  const v=s.views.at(-1);
  return {
    kind:v.kind, row:v.row, toolbar:!!v.toolbar, action:s.action, track:s.track,
    queue:s.queue.map(item=>item.id), playing:s.playing, left:s.presets.left,
    leftTracks:s.playlists.find(p=>p.id===s.presets.left)?.tracks.slice() ?? [],
    playlist:v.kind==='playlists'?s.playlists[v.row]?.id:v.kind==='playlist'?s.playlists[v.value]?.id:null,
  };
}

const coast='on-the-coast';
const lesson=(id,title,instruction,key,changed,prepare)=>({
  id,title,instruction,key,hold:key.startsWith('hold'),changed,prepare,
});

export const spotifyTourSteps=[
  lesson('library','Open your playlists','Press OK on Playlists.','ok',
    (a,b)=>a.kind==='home' && a.row===0 && b.kind==='playlists'),
  lesson('choose','Find On the Coast','Press Down once to highlight On the Coast.','down',
    (a,b)=>a.kind==='playlists' && a.row===0 && b.kind==='playlists' && b.playlist===coast),
  lesson('open','Look inside the playlist','Press OK to see its tracks.','ok',
    (a,b)=>a.kind==='playlists' && a.playlist===coast && b.kind==='playlist' && b.playlist===coast),
  lesson('player','Open Now playing','Press Right from the track list.','right',
    (a,b)=>a.kind==='playlist' && b.kind==='player'),
  lesson('actions','Find the player actions','Press Down to focus the buttons below playback.','down',
    (a,b)=>a.kind==='player' && !a.toolbar && b.kind==='player' && b.toolbar),
  lesson('choose-queue','Choose the queue button','Press Right from Volume to highlight + Queue.','right',
    (a,b)=>a.kind==='player' && a.toolbar && a.action===2 && b.toolbar && b.action===0),
  lesson('enqueue','Queue the current song','Press OK to add this song to the end of the queue.','ok',
    (a,b)=>a.kind==='player' && a.toolbar && a.action===0 && b.queue.length===a.queue.length+1 &&
      b.queue.at(-1)===a.track),
  lesson('transport','Return to playback','Press Up to leave the action buttons.','up',
    (a,b)=>a.kind==='player' && a.toolbar && b.kind==='player' && !b.toolbar),
  lesson('skip','Skip to the next song','Tap Right to play the next track in your queue.','right',
    (a,b)=>a.kind==='player' && !a.toolbar && b.playing && a.queue.length===b.queue.length+1 &&
      b.track===a.queue[0]),
  lesson('lyrics','Follow the lyrics','Press Up to see the words follow the song.','up',
    (a,b)=>a.kind==='player' && !a.toolbar && b.kind==='lyrics'),
  lesson('return','Leave the lyrics','Press Back to return to the player. Next, you’ll save a playlist shortcut.','back',
    (a,b)=>a.kind==='lyrics' && b.kind==='player'),
  lesson('assign','Save a playlist shortcut','On the Coast is highlighted again. Hold Left to save it to that arrow.','holdLeft',
    (a,b)=>a.kind==='playlists' && a.playlist===coast && !a.left && b.kind==='playlists' && b.left===coast,
    s=>{openSpotifyDemo(s); spotifyKey(s,'ok'); spotifyKey(s,'down');}),
  lesson('recall','Play your shortcut','From the library, hold Left again to play On the Coast.','holdLeft',
    (a,b)=>a.kind==='home' && a.left===coast && b.kind==='player' && b.playing &&
      b.track===a.leftTracks[0] && b.queue.length===a.leftTracks.length-1 &&
      b.queue.every((id,i)=>id===a.leftTracks[i+1]), s=>openSpotifyDemo(s)),
];

export function startSpotifyTour() {
  const fresh=()=>openSpotifyDemo(null,{persistPresets:false});
  const state=fresh();
  let index=0, exited=false, before=snapshot(state);

  // Replay the same controls a visitor uses. Retrying also resets elapsed playback time.
  function retry() {
    if(exited || index>=spotifyTourSteps.length) return state;
    Object.assign(state,fresh());
    for(let i=0;i<=index;i++) {
      const step=spotifyTourSteps[i];
      step.prepare?.(state);
      if(i<index) spotifyKey(state,step.key);
    }
    before=snapshot(state);
    return state;
  }
  return {
    state,
    get index() { return index; },
    get step() { return exited?undefined:spotifyTourSteps[index]; },
    get complete() { return index===spotifyTourSteps.length; },
    observe(key) {
      const step=spotifyTourSteps[index];
      if(exited || !step) return false;
      const after=snapshot(state);
      const passed=key===step.key && step.changed(before,after);
      if(passed) {
        index++;
        spotifyTourSteps[index]?.prepare?.(state);
      }
      before=snapshot(state);
      return passed;
    },
    retry,
    restart() {index=0; exited=false; return retry();},
    exit() {exited=true;},
  };
}

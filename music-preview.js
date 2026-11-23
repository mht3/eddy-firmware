import {text} from './lcd.js';
import {box,inverted} from './utility-pixels.js';
// Sample titles for the website's local demo. The player never connects to a listener's account.
const tracks = [
  {title:'Low Tide', artist:'Eddy demo', length:208},
  {title:'High Tide', artist:'Eddy demo', length:174},
  {title:'Dolphin Days', artist:'Eddy demo', length:242},
];

export function openMusicDemo() {
  return {
    page:'music', row:0, index:0, elapsed:42,
    started:performance.now(), playing:true, volume:50, volumeUntil:0,
  };
}

function position(s) {
  return Math.min(tracks[s.index].length, s.elapsed + (s.playing ? (performance.now()-s.started)/1000 : 0));
}

export function musicKey(s,key) {
  if(key==='left' || key==='right') {
    const at=position(s);
    s.playing=s.playing && at<tracks[s.index].length;
    if (key==='right') s.index=(s.index+1)%tracks.length;
    else if (at<3) s.index=(s.index+tracks.length-1)%tracks.length;
    s.elapsed=0;
    s.started=performance.now();
  } else if(key==='up' || key==='down') {
    s.volume=Math.max(0,Math.min(100,s.volume+(key==='up' ? 5 : -5)));
    s.volumeHint=key==='up'?'Vol +':'Vol -';
    s.volumeUntil=performance.now()+1200;
  } else if(key==='ok') {
    const at=position(s);
    s.playing=!(s.playing && at<tracks[s.index].length);
    s.elapsed=at>=tracks[s.index].length ? 0 : at;
    s.started=performance.now();
  }
}

export function musicStatus(s) {
  const track=tracks[s.index];
  return 'Sample track. '+track.title+' by '+track.artist+'. '+
    (s.playing && position(s)<track.length ? 'Playing.' : 'Paused.')+
    ' Position '+clock(position(s))+'. Media volume '+s.volume+'%. Left restarts the song, or goes back a track in its first three seconds. Right skips. OK plays or pauses. Up and Down adjust volume.';
}

function clock(seconds) {
  seconds=Math.floor(seconds);
  return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
}

export function drawMusic(ctx,s) {
  const track=tracks[s.index];
  const at=position(s);
  const playing=s.playing && at<track.length;
  const showVolume=performance.now()<s.volumeUntil;
  text(ctx,'Music',2,8);
  text(ctx,showVolume?s.volumeHint:playing?'Playing':'Paused',88,8,'secondary','right');
  text(ctx,track.title,2,22,'primary');
  text(ctx,track.artist,2,32);
  box(ctx,2,36,124,4);
  ctx.fillRect(3,37,Math.floor(122*at/track.length),2);
  text(ctx,clock(at),2,49);
  text(ctx,clock(track.length),126,49,'secondary','right');
  text(ctx,'< Prev',2,61);
  text(ctx,'Next >',99,61);
  box(ctx,43,51,42,13,5,true);
  inverted(ctx,true,()=>text(ctx,playing?'Pause':'Play',64,61,'secondary','center'));
  return playing || showVolume;
}

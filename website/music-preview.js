// Sample titles for the website's local demo. The player never connects to a listener's account.
const tracks = [
  {title:'Low Tide', artist:'Eddy demo', length:208},
  {title:'Night Ferry', artist:'Eddy demo', length:174},
  {title:'Sea Glass', artist:'Eddy demo', length:242},
];

export function openMusicDemo() {
  return {page:'music', row:0, index:0, elapsed:42, started:performance.now(), playing:true};
}

function position(s) {
  return Math.min(tracks[s.index].length, s.elapsed + (s.playing ? (performance.now()-s.started)/1000 : 0));
}

export function musicKey(s,key) {
  if(key==='left' || key==='right') {
    s.index=(s.index+(key==='right' ? 1 : tracks.length-1))%tracks.length;
    s.elapsed=0;
    s.started=performance.now();
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
    (s.playing && position(s)<track.length ? 'Playing.' : 'Paused.')+' Left or Right for tracks, OK for play or pause.';
}

function clock(seconds) {
  seconds=Math.floor(seconds);
  return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
}

export function drawMusic(ctx,s) {
  const track=tracks[s.index];
  const at=position(s);
  const playing=s.playing && at<track.length;
  ctx.save();
  ctx.textBaseline='alphabetic';
  ctx.font='7px sans-serif';
  ctx.fillText('Spotify',2,8);
  ctx.fillText(playing?'Playing':'Paused',45,8);
  ctx.font='bold 11px sans-serif';
  ctx.fillText(track.title,2,22);
  ctx.font='8px sans-serif';
  ctx.fillText(track.artist,2,32);
  ctx.strokeRect(2.5,36.5,123,3);
  ctx.fillRect(3,37,122*at/track.length,2);
  ctx.fillText(clock(at),2,49);
  ctx.textAlign='right'; ctx.fillText(clock(track.length),126,49);
  ctx.fillText('Next >',126,61);
  ctx.textAlign='left'; ctx.fillText('< Prev',2,61);
  ctx.beginPath(); ctx.roundRect(43,51,42,13,5); ctx.fill();
  ctx.globalCompositeOperation='destination-out';
  ctx.textAlign='center'; ctx.fillText(playing?'Pause':'Play',64,61);
  ctx.restore();
  return playing;
}

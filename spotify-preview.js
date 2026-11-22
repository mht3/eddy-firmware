import {songs, samplePlaylists, drawIcon} from './spotify-demo-library.js';

const pageSize=3;
const setupQr=new Image();
setupQr.src=new URL('./spotify/guide-qr.png',import.meta.url).href;
const now=()=>performance.now();
const clock=seconds=>Math.floor(seconds/60)+':'+String(Math.floor(seconds%60)).padStart(2,'0');
const entry=(action,label,icon,value)=>({action,label,icon,value});
const songEntry=id=>entry('song',songs[id].title,songs[id].art,id);
const view=(kind,title,value)=>({kind,title,value,row:0});
const current=s=>s.views.at(-1);
const open=(s,kind,title,value)=>s.views.push(view(kind,title,value));
const actions=['+ Queue','+ Playlist','Volume'];
const volumeTop=15, volumeBottom=56;

const directions=['up','right','down','left'];
const directionLabels={up:'↑ Up',right:'→ Right',down:'↓ Down',left:'← Left'};
const presetStorage='eddy-spotify-demo-presets-v1';

function readPresets(playlists) {
  const presets={};
  try {
    const saved=JSON.parse(localStorage.getItem(presetStorage));
    for(const dir of directions) if(playlists.some(p=>p.id===saved?.[dir])) presets[dir]=saved[dir];
  } catch {}
  return presets;
}
function setPreset(s,dir,playlist) {
  if(playlist) s.presets[dir]=playlist.id;
  else delete s.presets[dir];
  if(s.persistPresets) {
    try { localStorage.setItem(presetStorage,JSON.stringify(s.presets)); } catch {}
  }
  notify(s,playlist?directionLabels[dir]+': '+playlist.name:'Preset cleared');
}
function presetPlaylist(s,dir) { return s.playlists.find(p=>p.id===s.presets[dir]); }
function presetLabel(s,dir) { return directionLabels[dir]+'   '+(presetPlaylist(s,dir)?.name ?? 'Unassigned'); }
function playPreset(s,dir) {
  const playlist=presetPlaylist(s,dir);
  if(!playlist?.tracks.length) {notify(s,'Set a preset in Playlists'); return;}
  const [first,...rest]=playlist.tracks;
  s.previous.push(s.track); s.queue=rest.map(id=>({id})); play(s,first);
  openSpotifyPlayer(s); current(s).toolbar=false;
  notify(s,playlist.name);
}

export function openSpotifyDemo(session,{persistPresets=true}={}) {
  if(session) {
    session.views=[view('home','Spotify demo')];
    session.notice='';
    position(session);
    return session;
  }
  const playlists=samplePlaylists();
  return {page:'spotify',row:0,views:[view('home','Spotify demo')],playlists,persistPresets,
    presets:persistPresets?readPresets(playlists):{},
    track:0,queue:[{id:1},{id:2}],previous:[],playing:true,started:now(),elapsed:21,volume:60,action:2,notice:'',noticeUntil:0};
}

export function openSpotifyPlayer(s) {
  if(current(s).kind!=='player') open(s,'player','Now playing');
  return s;
}

function play(s,id,at=0) {
  s.track=id; s.elapsed=at; s.started=now(); s.playing=true;
}

function position(s) {
  let at=s.elapsed+(s.playing?(now()-s.started)/1000:0);
  while(s.playing && at>=songs[s.track].seconds) {
    at-=songs[s.track].seconds;
    if(!s.queue.length) { s.playing=false; s.elapsed=songs[s.track].seconds; return s.elapsed; }
    s.previous.push(s.track); play(s,s.queue.shift().id,at);
  }
  return at;
}

function notify(s,message) { s.notice=message; s.noticeUntil=now()+1600; }
function menu(s) {
  const v=current(s);
  switch(v.kind) {
    case 'home': return [entry('playlists','Playlists','playlist'),entry('liked','Liked Songs','heart'),entry('queue','Queue','queue'),
      entry('albums','Albums','album'),entry('presets','Presets','playlist'),entry('setup','Setup guide','tracks')];
    case 'playlists': case 'destinations': return s.playlists.map((p,i)=>entry(v.kind==='playlists'?'playlist':'save',p.name,p.art,i));
    case 'playlist': return s.playlists[v.value].tracks.map(songEntry);
    case 'queue': return s.queue.map(item=>entry('queued',songs[item.id].title,songs[item.id].art,item));
    case 'liked': return songs.map((song,i)=>songEntry(i));
    case 'albums': return [...new Set(songs.map(song=>song.album))].map(name=>entry('album',name,songs.find(song=>song.album===name).art,name));
    case 'artist': case 'album': return songs.flatMap((song,i)=>song[v.kind]===v.value?[songEntry(i)]:[]);
    case 'presets': return directions.map(dir=>entry('presetSlot',presetLabel(s,dir),'playlist',dir));
    case 'presetSlot': return [...(presetPlaylist(s,v.value)?[entry('playPreset','Play preset','tracks')]:[]),
      entry('choosePreset','Choose playlist','playlist'),...(presetPlaylist(s,v.value)?[entry('clearPreset','Clear preset','playlist')]:[])];
    case 'choosePreset': return s.playlists.map((p,i)=>entry('assignPlaylist',p.name,p.art,i));
    case 'song': return [entry('play','Play now','tracks'),entry('enqueue','Add to queue','queue'),entry('destinations','Add to playlist','playlist'),entry('lyrics','Lyrics','tracks'),entry('artist',songs[v.value].artist,'artist',songs[v.value].artist)];
    default: return [];
  }
}

function openLyrics(s,id) {
  open(s,'lyrics',songs[id].title,id);
  current(s).live=current(s).follow=s.track===id;
}

function lyricLine(s,v,at) {
  if(v.live && v.value!==s.track) {
    v.value=s.track; v.title=songs[s.track].title; v.follow=true;
  }
  if(v.follow) {
    const cues=songs[v.value].cues;
    v.row=0;
    while(v.row+1<cues.length && cues[v.row+1][0]<=at) ++v.row;
  }
  return v.row;
}

function select(s,item) {
  const v=current(s);
  if(!item) return;
  switch(item.action) {
    case 'choosePreset': open(s,'choosePreset','Choose playlist',v.value); break;
    case 'assignPlaylist': setPreset(s,v.value,s.playlists[item.value]); s.views.pop(); s.views.pop(); break;
    case 'playPreset': playPreset(s,v.value); break;
    case 'clearPreset': setPreset(s,v.value,null); s.views.pop(); break;
    case 'play': s.previous.push(s.track); play(s,v.value); openSpotifyPlayer(s); break;
    case 'enqueue': s.queue.push({id:v.value}); notify(s,'Added to queue'); break;
    case 'queued': open(s,'queuedSong',songs[item.value.id].title,item.value); break;
    case 'destinations': open(s,item.action,item.label,v.value); break;
    case 'lyrics': openLyrics(s,v.value); break;
    case 'save': {
      const target=s.playlists[item.value];
      const duplicate=target.tracks.includes(v.value);
      if(!duplicate) target.tracks.push(v.value);
      s.views.pop(); notify(s,duplicate?'Already in playlist':'Added to '+target.name); break;
    }
    default: open(s,item.action,item.label,item.value);
  }
}

function visibleRows(s) {
  if(current(s).kind==='queuedSong') return [entry('playQueued','Play now','tracks'),entry('remove','Remove from queue','queue')];
  return menu(s);
}

function activate(s) {
  const v=current(s);
  if(v.kind==='queuedSong') {
    const index=s.queue.indexOf(v.value);
    if(index>=0) s.queue.splice(index,1);
    s.views.pop(); current(s).row=Math.max(0,Math.min(current(s).row,s.queue.length-1));
    if(index<0) { notify(s,'Song already played'); return; }
    if(v.row===0) { s.previous.push(s.track); play(s,v.value.id); openSpotifyPlayer(s); }
    else notify(s,'Removed from queue');
  } else select(s,menu(s)[v.row]);
}

function playerAction(s) {
  if(s.action===0) {
    s.queue.push({id:s.track});
    notify(s,'Added to queue');
  } else if(s.action===1) open(s,'destinations','Add to playlist',s.track);
  else open(s,'volume','Volume');
}

export function spotifyVolumeAt(s,x,y,dragging=false) {
  if(current(s).kind!=='volume' || (!dragging && (x<5 || x>53 || y<12 || y>60))) return false;
  s.volume=Math.max(0,Math.min(100,Math.round(100*(volumeBottom-y)/(volumeBottom-volumeTop))));
  return true;
}

export function spotifyKey(s,key) {
  const v=current(s);
  s.notice='';
  if(key==='holdOk' && (v.kind==='playlists' || v.kind==='playlist')) {
    open(s,'assign','Press a direction',v.kind==='playlist'?v.value:v.row);
    return true;
  }
  if(key.startsWith('hold')) {
    const dir=key.slice(4).toLowerCase();
    if(!directions.includes(dir)) return true;
    if(v.kind==='assign') { setPreset(s,dir,s.playlists[v.value]); s.views.pop(); }
    else if(v.kind==='playlists' && !s.presets[dir]) setPreset(s,dir,s.playlists[v.row]);
    else if(!['setup','volume','presetSlot','choosePreset','presets'].includes(v.kind)) playPreset(s,dir);
    return true;
  }
  if(key==='back' || (v.kind==='setup' && key==='ok')) {
    if(s.views.length===1) return false;
    s.views.pop(); return true;
  }
  if(v.kind==='setup') return true;
  if(v.kind==='assign') {
    if(directions.includes(key)) {setPreset(s,key,s.playlists[v.value]); s.views.pop();}
    return true;
  }
  if(v.kind==='volume') {
    if(key==='ok') s.views.pop();
    else if(key==='up' || key==='down') s.volume=Math.max(0,Math.min(100,s.volume+(key==='up'?5:-5)));
    return true;
  }
  if(v.kind==='player') {
    const at=position(s);
    if(v.toolbar) {
      if(key==='up') v.toolbar=false;
      else if(key==='left' || key==='right') s.action=(s.action+(key==='left'?2:1))%3;
      else if(key==='ok') playerAction(s);
      return true;
    }
    if(key==='ok') { s.elapsed=at>=songs[s.track].seconds?0:at; s.started=now(); s.playing=!s.playing; }
    else if(key==='right' && s.queue.length) { s.previous.push(s.track); play(s,s.queue.shift().id); }
    else if(key==='right') notify(s,'Queue is empty');
    else if(key==='left') {
      if(at<3 && s.previous.length) { s.queue.unshift({id:s.track}); play(s,s.previous.pop()); }
      else { s.elapsed=0; s.started=now(); }
    }
    else if(key==='down') v.toolbar=true;
    else if(key==='up') openLyrics(s,s.track);
    return true;
  }
  if(v.kind==='lyrics') {
    lyricLine(s,v,position(s));
    if(key==='up' || key==='down') {
      v.follow=false;
      v.row=Math.max(0,Math.min(songs[v.value].cues.length-1,v.row+(key==='down'?1:-1)));
    } else if(key==='ok') { v.follow=v.live=v.value===s.track; lyricLine(s,v,position(s)); }
    return true;
  }
  if(key==='right') {openSpotifyPlayer(s); return true;}
  const count=visibleRows(s).length;
  if(count && (key==='down' || key==='up')) v.row=(v.row+(key==='down'?1:count-1))%count;
  else if(count && key==='left') v.row=Math.max(0,(Math.floor(v.row/pageSize)-1)*pageSize);
  else if(count && key==='ok') activate(s);
  return true;
}

export function spotifyHit(s,x,y) {
  const v=current(s);
  if(v.kind==='setup') return spotifyKey(s,'ok');
  if(v.kind==='assign') {
    if(y>=13 && y<61) return spotifyKey(s,directions[Math.floor((y-13)/12)]);
    return true;
  }
  if(v.kind==='volume') {
    if(!spotifyVolumeAt(s,x,y) && x>=50 && y>=52) spotifyKey(s,'ok');
    return true;
  }
  if(v.kind==='player') {
    if(y>=50) { v.toolbar=true; s.action=Math.min(2,Math.floor(x/43)); playerAction(s); }
    else if(y>=39) {
      v.toolbar=false;
      return spotifyKey(s,x<29?'left':x<65?'ok':x<92?'right':'up');
    } else if(y>=30) {
      position(s);
      s.elapsed=Math.min(songs[s.track].seconds,Math.max(0,(x-2)/123*songs[s.track].seconds)); s.started=now();
    }
    return true;
  }
  if(y>=50) { openSpotifyPlayer(s); return true; }
  if(v.kind==='lyrics') return spotifyKey(s,y<30?'up':'down');
  if(y<12 || y>=48) return false;
  const row=Math.floor(v.row/pageSize)*pageSize+Math.floor((y-12)/12);
  if(row>=visibleRows(s).length) return false;
  v.row=row; activate(s); return true;
}

export function spotifyStatus(s) {
  const at=position(s), v=current(s), active=songs[s.track];
  if(v.kind==='setup') return 'Scan for the personal Spotify setup guide. OK returns to the sample library.';
  const playing=(s.playing?'Playing ':'Paused on ')+active.title+' by '+active.artist;
  if(v.kind==='volume') return 'Volume '+s.volume+' percent. Up and Down adjust. OK returns to the player.';
  if(v.kind==='player') return [now()<s.noticeUntil?s.notice:'',playing,v.toolbar?actions[s.action]+'. Left or Right selects an action. OK opens it. Up returns to playback.':
    'OK pauses or plays. Left restarts or goes back. Right skips. Up opens lyrics. Down selects player actions.'].filter(Boolean).join('. ');
  if(v.kind==='lyrics') {
    lyricLine(s,v,at);
    return 'Sample lyrics for '+songs[v.value].title+'. '+songs[v.value].cues[v.row][1]+'. Up and Down scroll. OK follows playback. '+playing+'.';
  }
  if(v.kind==='assign') return 'Assign '+s.playlists[v.value].name+'. Press a direction. '+directions.map(dir=>presetLabel(s,dir)).join('. ');
  const rows=visibleRows(s);
  return [v.title,now()<s.noticeUntil?s.notice:'',rows[v.row]?.label ?? 'Empty',playing,
    'Up or Down selects. OK opens. Right opens Now playing.',v.kind==='playlists'?'Hold an unused arrow to save this playlist. Hold OK to replace a preset.':''].filter(Boolean).join('. ');
}

function cropped(ctx,text,x,y,width) {
  if(ctx.measureText(text).width>width) {
    while(text.length && ctx.measureText(text+'…').width>width) text=text.slice(0,-1);
    text+='…';
  }
  ctx.fillText(text,x,y);
}

function footer(ctx,s,at) {
  const song=songs[s.track];
  ctx.save();
  ctx.fillRect(1,50,126,1);
  drawIcon(ctx,song.art,3,54);
  ctx.font='bold 8px sans-serif'; cropped(ctx,song.title,15,60,78);
  ctx.font='7px monospace'; ctx.fillText(clock(at),98,60);
  if(s.playing) { ctx.fillRect(121,54,2,6); ctx.fillRect(125,54,2,6); }
  else {ctx.beginPath();ctx.moveTo(120,53);ctx.lineTo(126,57);ctx.lineTo(120,61);ctx.fill();}
  ctx.fillRect(1,63,Math.round(126*at/song.seconds),1);
  ctx.restore();
}

function drawPlayer(ctx,s,v,at) {
  const track=songs[s.track];
  drawIcon(ctx,track.art,3,13,2);
  ctx.font='bold 10px sans-serif'; cropped(ctx,track.title,24,21,101);
  ctx.font='8px sans-serif'; cropped(ctx,track.artist,24,30,66);
  ctx.font='7px monospace'; ctx.fillText(clock(at),104,30);
  ctx.fillRect(2,34,124,1);
  ctx.fillRect(2,33,Math.max(2,Math.round(124*at/track.seconds)),3);
  ctx.font='bold 8px sans-serif';
  ctx.fillText('‹ Prev',2,46); ctx.fillText(s.playing?'Ⅱ Pause':'▷ Play',31,46);
  ctx.fillText('Next ›',66,46); ctx.fillText('↑ Lyrics',95,46);
  for(let i=0;i<actions.length;i++) {
    const x=1+i*43, width=i===2?40:41;
    ctx.save(); ctx.beginPath(); ctx.roundRect(x+.5,50.5,width,12,3);
    if(v.toolbar && i===s.action) { ctx.fill(); ctx.globalCompositeOperation='destination-out'; }
    else { ctx.lineWidth=1; ctx.stroke(); }
    ctx.textAlign='center'; ctx.fillText(actions[i],x+width/2,59.5);
    ctx.restore();
  }
}

function drawVolume(ctx,s) {
  const y=volumeBottom-(volumeBottom-volumeTop)*s.volume/100;
  ctx.save();
  ctx.lineWidth=1; ctx.strokeRect(22.5,volumeTop+.5,6,volumeBottom-volumeTop);
  ctx.fillRect(24,y,4,volumeBottom-y);
  ctx.fillRect(17,Math.round(y)-1,18,3);
  ctx.font='bold 15px sans-serif'; ctx.fillText(s.volume+'%',52,31);
  ctx.font='8px sans-serif'; ctx.fillText('↑ Louder',53,41); ctx.fillText('↓ Softer',53,50);
  ctx.fillText('OK  Done',53,61); ctx.restore();
}

export function drawSpotify(ctx,s) {
  const v=current(s), at=position(s);
  ctx.save(); ctx.textBaseline='alphabetic'; ctx.font='bold 9px sans-serif';
  if(v.kind==='setup') {
    ctx.imageSmoothingEnabled=false;
    if(setupQr.naturalWidth) ctx.drawImage(setupQr,0,0,64,64);
    ctx.fillText('Spotify',66,20); ctx.font='8px sans-serif';
    ctx.fillText('Personal setup',66,33); ctx.fillText('Scan for guide',66,44); ctx.fillText('OK: Back',66,60);
    ctx.restore(); return !setupQr.complete;
  }
  if(v.kind==='lyrics') lyricLine(s,v,at);
  cropped(ctx,v.kind==='playlists'?'Playlists · Hold arrow':v.title,2,9,89);
  ctx.fillRect(2,11,124,1);
  if(v.kind==='assign') {
    ctx.font='bold 8px sans-serif';
    directions.forEach((dir,i)=>cropped(ctx,presetLabel(s,dir),4,22+i*12,120));
  } else if(v.kind==='player') {
    drawPlayer(ctx,s,v,at);
  } else if(v.kind==='volume') {
    drawVolume(ctx,s);
  } else if(v.kind==='lyrics') {
    const cues=songs[v.value].cues;
    const start=Math.max(0,Math.min(v.row-1,cues.length-3));
    cues.slice(start,start+3).forEach(([,line],i)=>{
      ctx.font=(start+i===v.row?'bold ':'')+'8px sans-serif';
      if(start+i===v.row) ctx.fillRect(2,15+11*i,2,8);
      cropped(ctx,line,7,22+11*i,119);
    });
  } else {
    const rows=visibleRows(s); v.row=Math.min(v.row,Math.max(0,rows.length-1));
    const start=Math.floor(v.row/pageSize)*pageSize;
    rows.slice(start,start+pageSize).forEach((item,i)=>{
      const y=12+i*12;
      ctx.save();
      if(start+i===v.row) {ctx.beginPath();ctx.roundRect(1,y,123,12,3);ctx.fill();ctx.globalCompositeOperation='destination-out';}
      drawIcon(ctx,item.icon,5,y+2);
      ctx.font='bold 8px sans-serif'; cropped(ctx,item.label,17,y+9,101);
      ctx.restore();
    });
    if(rows.length>pageSize) ctx.fillRect(126,13+Math.floor(v.row/pageSize)*34/Math.ceil(rows.length/pageSize),1,Math.ceil(33/Math.ceil(rows.length/pageSize)));
    if(!rows.length) {
      ctx.font='8px sans-serif'; ctx.fillText('Your queue is empty',4,37);
    }
  }
  if(!['player','volume','assign'].includes(v.kind)) footer(ctx,s,at);
  if(s.notice && now()<s.noticeUntil) {
    ctx.save();ctx.fillRect(1,35,125,14);ctx.globalCompositeOperation='destination-out';ctx.font='bold 8px sans-serif';cropped(ctx,s.notice,5,45,117);ctx.restore();
  }
  ctx.restore(); return s.playing || now()<s.noticeUntil;
}

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

export function openSpotifyDemo(session) {
  if(session) {
    session.views=[view('home','Spotify')];
    session.notice='';
    position(session);
    return session;
  }
  return {page:'spotify',row:0,views:[view('home','Spotify')],playlists:samplePlaylists(),
    track:0,queue:[{id:1},{id:2}],previous:[],playing:true,started:now(),elapsed:21,query:'',notice:'',noticeUntil:0};
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
function artistEntries(query) {
  const artists=[...new Set(songs.map(song=>song.artist))];
  return artists.filter(name=>name.toLowerCase().includes(query)).map(name=>entry('artist',name,'artist',name));
}
function menu(s) {
  const v=current(s);
  switch(v.kind) {
    case 'home': return [entry('playlists','Playlists','playlist'),entry('search','Search','search'),entry('queue','Queue','queue'),
      entry('liked','Liked Songs','heart'),entry('albums','Albums','album'),entry('player','Now playing','tracks')];
    case 'playlists': case 'destinations': return s.playlists.map((p,i)=>entry(v.kind==='playlists'?'playlist':'save',p.name,p.art,i));
    case 'playlist': return s.playlists[v.value].tracks.map(songEntry);
    case 'queue': return s.queue.map(item=>entry('queued',songs[item.id].title,songs[item.id].art,item));
    case 'liked': return songs.map((song,i)=>songEntry(i));
    case 'albums': return [...new Set(songs.map(song=>song.album))].map(name=>entry('album',name,songs.find(song=>song.album===name).art,name));
    case 'artist': case 'album': return songs.flatMap((song,i)=>song[v.kind]===v.value?[songEntry(i)]:[]);
    case 'results': {
      const query=s.query.toLowerCase();
      return [...artistEntries(query),...songs.flatMap((song,i)=>song.title.toLowerCase().includes(query)?[songEntry(i)]:[]),entry('search','Search again','search')];
    }
    case 'song': return [entry('play','Play now','tracks'),entry('enqueue','Add to queue','queue'),entry('destinations','Add to playlist','playlist'),entry('lyrics','Lyrics','tracks'),entry('artist',songs[v.value].artist,'artist',songs[v.value].artist)];
    default: return [];
  }
}

export function searchSpotifyDemo(s,query) {
  query=query.trim();
  if(!query) return;
  if(current(s).kind==='results') s.views.pop();
  s.query=query; open(s,'results','Search: '+query);
}

function openLyrics(s,id) {
  open(s,'lyrics',songs[id].title,id);
  current(s).follow=s.track===id;
}

function lyricLine(s,v,at) {
  if(v.follow && v.value===s.track) {
    v.row=Math.min(songs[v.value].lines.length-1,Math.floor(at*songs[v.value].lines.length/songs[v.value].seconds));
  }
  return v.row;
}

function select(s,item,askSearch) {
  const v=current(s);
  if(!item) return;
  switch(item.action) {
    case 'search': askSearch?.(s.query); break;
    case 'play': s.previous.push(s.track); play(s,v.value); open(s,'player','Now playing'); break;
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

function activate(s,askSearch) {
  const v=current(s);
  if(v.kind==='queuedSong') {
    const index=s.queue.indexOf(v.value);
    if(index>=0) s.queue.splice(index,1);
    s.views.pop(); current(s).row=Math.max(0,Math.min(current(s).row,s.queue.length-1));
    if(index<0) { notify(s,'Song already played'); return; }
    if(v.row===0) { s.previous.push(s.track); play(s,v.value.id); open(s,'player','Now playing'); }
    else notify(s,'Removed from queue');
  } else select(s,menu(s)[v.row],askSearch);
}

export function spotifyKey(s,key,askSearch) {
  const v=current(s);
  s.notice='';
  if(key==='holdUp') { if(v.kind!=='setup') open(s,'setup','Spotify setup'); return true; }
  if(key==='back' || (v.kind==='setup' && key==='ok')) {
    if(s.views.length===1) return false;
    s.views.pop(); return true;
  }
  if(v.kind==='setup') return true;
  if(v.kind==='player') {
    const at=position(s);
    if(key==='ok') { s.elapsed=at>=songs[s.track].seconds?0:at; s.started=now(); s.playing=!s.playing; }
    else if(key==='right' && s.queue.length) { s.previous.push(s.track); play(s,s.queue.shift().id); }
    else if(key==='right') notify(s,'Queue is empty');
    else if(key==='left') play(s,at<3 && s.previous.length?s.previous.pop():s.track);
    else if(key==='down') open(s,'song',songs[s.track].title,s.track);
    else if(key==='up') openLyrics(s,s.track);
    return true;
  }
  if(v.kind==='lyrics') {
    if(key==='up' || key==='down') {
      lyricLine(s,v,position(s)); v.follow=false;
      v.row=Math.max(0,Math.min(songs[v.value].lines.length-1,v.row+(key==='down'?1:-1)));
    } else if(key==='ok') v.follow=v.value===s.track;
    return true;
  }
  const count=visibleRows(s).length;
  if(!count) return true;
  if(key==='up' || key==='down') v.row=(v.row+(key==='up'?-1:1)+count)%count;
  else if(key==='left' || key==='right') {
    const start=Math.floor(v.row/pageSize)*pageSize+(key==='right'?pageSize:-pageSize);
    if(start>=0 && start<count) v.row=start;
  } else if(key==='ok') activate(s,askSearch);
  return true;
}

export function spotifyHit(s,x,y,askSearch) {
  const v=current(s);
  if(v.kind==='setup') return spotifyKey(s,'ok');
  if(y>=50) {
    if(v.kind==='player') return spotifyKey(s,'ok');
    open(s,'player','Now playing'); return true;
  }
  if(v.kind==='player') return spotifyKey(s,y>=36?'down':'up');
  if(v.kind==='lyrics') return spotifyKey(s,y<30?'up':'down');
  if(y<12 || y>=48) return false;
  const row=Math.floor(v.row/pageSize)*pageSize+Math.floor((y-12)/12);
  if(row>=visibleRows(s).length) return false;
  v.row=row; activate(s,askSearch); return true;
}

export function spotifyStatus(s) {
  const v=current(s); const active=songs[s.track];
  if(v.kind==='setup') return 'Scan to link Spotify. OK returns to your library.';
  const playing=(s.playing?'Playing ':'Paused on ')+active.title+' by '+active.artist;
  if(v.kind==='player') return playing+'. OK pauses or plays. Left restarts or goes back. Right plays the next queued song. Up opens lyrics. Down opens song actions.';
  if(v.kind==='lyrics') return 'Sample lyrics for '+songs[v.value].title+'. '+songs[v.value].lines[v.row]+'. Up and Down scroll. '+playing+'.';
  const rows=visibleRows(s);
  return [v.title,now()<s.noticeUntil?s.notice:'', v.kind==='results' && rows.length===1?'No matches. Search again':rows[v.row]?.label ?? 'Empty',playing,'Up or Down selects. OK opens. Tap the bottom bar for playback.'].filter(Boolean).join('. ');
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
  ctx.fillRect(1,50,126,1);
  drawIcon(ctx,song.art,3,54);
  ctx.font='bold 8px sans-serif'; cropped(ctx,song.title,15,60,78);
  ctx.font='7px monospace'; ctx.fillText(clock(at),98,60);
  if(s.playing) { ctx.fillRect(121,54,2,6); ctx.fillRect(125,54,2,6); }
  else {ctx.beginPath();ctx.moveTo(120,53);ctx.lineTo(126,57);ctx.lineTo(120,61);ctx.fill();}
  ctx.fillRect(1,63,Math.round(126*at/song.seconds),1);
}

export function drawSpotify(ctx,s) {
  const v=current(s), at=position(s);
  ctx.save(); ctx.textBaseline='alphabetic'; ctx.font='bold 9px sans-serif';
  if(v.kind==='setup') {
    ctx.imageSmoothingEnabled=false;
    if(setupQr.naturalWidth) ctx.drawImage(setupQr,0,0,64,64);
    ctx.fillText('Spotify',66,20); ctx.font='8px sans-serif';
    ctx.fillText('Scan to link',66,33); ctx.fillText('in browser',66,44); ctx.fillText('OK: Continue',66,60);
    ctx.restore(); return !setupQr.complete;
  }
  cropped(ctx,v.title,2,9,89);
  ctx.fillRect(2,11,124,1);
  if(v.kind==='player') {
    const track=songs[s.track]; drawIcon(ctx,track.art,3,16,3);
    ctx.font='bold 10px sans-serif'; cropped(ctx,track.title,32,24,94);
    ctx.font='8px sans-serif'; cropped(ctx,track.artist,32,35,92);
    ctx.font='7px sans-serif'; ctx.fillText('↑ Lyrics     ↓ Actions',32,45);
  } else if(v.kind==='lyrics') {
    const lines=songs[v.value].lines; const start=Math.min(lyricLine(s,v,at),lines.length-3);
    lines.slice(start,start+3).forEach((line,i)=>{
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
    if(!rows.length || (v.kind==='results' && rows.length===1)) {
      ctx.font='8px sans-serif'; ctx.fillText(rows.length?'No matches':'Your queue is empty',4,37);
    }
  }
  footer(ctx,s,at);
  if(s.notice && now()<s.noticeUntil) {
    ctx.save();ctx.fillRect(1,35,125,14);ctx.globalCompositeOperation='destination-out';ctx.font='bold 8px sans-serif';cropped(ctx,s.notice,5,45,117);ctx.restore();
  }
  ctx.restore(); return s.playing || now()<s.noticeUntil;
}

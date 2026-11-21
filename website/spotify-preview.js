// Local demo titles. The emulator never requests account access or starts playback on a phone.
const collections = [
  {name:'Liked Songs',kind:'song',items:[
    'Low Tide','High Tide','Dolphin Days','Sea Glass','Kelp Forest',
    'Pacific Blue','Night Ferry','Moon Pool','Tide Chart',
  ]},
  {name:'Playlists',kind:'playlist',items:[
    'Morning Swim','On the Coast','After Hours','Focus Mix','Sunday Drift','At the Pier',
  ]},
  {name:'Albums',kind:'album',items:[
    'Breakwater','Open Water','Blue Hour','Tidal Pool','Channel Islands',
  ]},
];
const categoryNames=collections.map(({name})=>name);
const pageSize=4;
const setupQr=new Image();
setupQr.src=new URL('./spotify/guide-qr.png',import.meta.url).href;

export function openSpotifyDemo() {
  return {page:'spotify',category:null,row:0,libraryPage:0,overlay:null};
}

function currentRows(s) {
  if(s.category===null) return categoryNames;
  const start=s.libraryPage*pageSize;
  return collections[s.category].items.slice(start,start+pageSize);
}

function pageCount(s) {
  return Math.ceil(collections[s.category].items.length/pageSize);
}

export function spotifyKey(s,key) {
  if(key==='holdUp') {
    s.overlay='setup';
    return true;
  }
  if(s.overlay) {
    if(key==='ok' || key==='back') s.overlay=null;
    return true;
  }
  const rows=currentRows(s);
  if(key==='up' || key==='down') {
    s.row=(s.row+(key==='down' ? 1 : rows.length-1))%rows.length;
  } else if(key==='ok') {
    if(s.category===null) {
      s.category=s.row;
      s.libraryPage=0;
      s.row=0;
    } else s.overlay='playing';
  } else if(key==='back' && s.category!==null) {
    s.row=s.category;
    s.category=null;
    s.libraryPage=0;
  } else if((key==='left' || key==='right') && s.category!==null) {
    const next=s.libraryPage+(key==='right' ? 1 : -1);
    if(next>=0 && next<pageCount(s)) {
      s.libraryPage=next;
      s.row=0;
    }
  } else return false;
  return true;
}

export function spotifyStatus(s) {
  const collection=collections[s.category];
  const heading=collection?.name ?? 'Library';
  if(s.overlay==='setup') return 'Scan the QR code to link Spotify in a browser with Bluetooth. OK returns to '+heading+'.';
  const title=currentRows(s)[s.row];
  if(s.overlay==='playing') return 'Playing '+title+' in the sample library. OK or Back returns to '+heading+'.';
  if(!collection) return 'Sample library. '+title+'. Up or Down selects a category. OK opens it.';
  return 'Sample '+heading+'. Page '+(s.libraryPage+1)+' of '+pageCount(s)+'. '+title+
    '. Up or Down selects a '+collection.kind+'. Left or Right turns the page. OK plays the selection in the demo. Back returns to the library.';
}

export function drawSpotify(ctx,s) {
  const collection=collections[s.category];
  const heading=collection?.name ?? 'Library';
  ctx.save();
  ctx.textBaseline='alphabetic';
  ctx.font='bold 8px sans-serif';
  ctx.fillText(heading+' · demo',2,8);
  ctx.fillRect(1,11,126,1);
  const rows=currentRows(s);
  if(s.overlay==='setup') {
    if(setupQr.naturalWidth) ctx.drawImage(setupQr,2,18,setupQr.naturalWidth,setupQr.naturalHeight);
    ctx.fillText('Spotify setup',46,24);
    ctx.font='8px sans-serif';
    ctx.fillText('Scan to link',46,37);
    ctx.fillText('OK: Done',46,55);
  } else if(s.overlay==='playing') {
    ctx.font='8px sans-serif';
    ctx.fillText('Playing in demo',4,26);
    ctx.font='bold 11px sans-serif';
    ctx.fillText(rows[s.row],4,42,120);
    ctx.font='8px sans-serif';
    ctx.fillText('OK: '+heading,4,59);
  } else {
    const rowHeight=collection ? 10 : 13;
    rows.forEach((title,i)=>{
      const y=13+rowHeight*i;
      ctx.save();
      if(i===s.row) {
        ctx.beginPath();
        ctx.roundRect(1,y,126,rowHeight,2);
        ctx.fill();
        ctx.globalCompositeOperation='destination-out';
      }
      ctx.font='bold 8px sans-serif';
      ctx.fillText(title,5,y+rowHeight-2);
      ctx.restore();
    });
    ctx.font='7px sans-serif';
    if(collection) ctx.fillText('Page '+(s.libraryPage+1)+'/'+pageCount(s),2,63);
    ctx.fillText(collection?'OK: Play':'OK: Open',89,63);
  }
  ctx.restore();
  return s.overlay==='setup' && !setupQr.complete;
}

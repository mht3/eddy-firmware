import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {test} from 'node:test';
import {catalog,defaultAppOrder} from '../../website/app-catalog.js';
import {prepareInstall,makeDownload} from '../../website/update/package.js';
import {spotifySignInBitmap} from '../../website/update/spotify-qr.js';

const digest = (algorithm,data)=>createHash(algorithm).update(data).digest('hex');
const communityList = 'eddy/community_apps.txt';
const launcher = 'eddy/launcher_order.txt';
const all = catalog.map(app=>app.id);
const appFiles = Object.fromEntries(catalog.map(({appId})=>['apps/assets/'+appId+'.fap',appId]));
const stock = {...appFiles,[communityList]:'',[launcher]:defaultAppOrder.join('\n')+'\n'};
stock.Manifest = ['V:0','T:1','D:apps','D:apps/assets','D:eddy',
  ...Object.entries(stock).map(([path,data])=>'F:'+digest('md5',data)+':'+data.length+':'+path),''].join('\n');

// Python's tar reader checks the same output independently of the browser's tar writer.
function python(script,input) {
  return JSON.parse(execFileSync('python3',['-c','import base64,io,json,sys,tarfile\n'+script],
    {input:JSON.stringify(input),encoding:'utf8'}));
}
const fixture = python(`
out=io.BytesIO()
with tarfile.open(fileobj=out,mode='w:gz') as tar:
    for path,data in json.load(sys.stdin).items():
        data=data.encode()
        entry=tarfile.TarInfo(path)
        entry.size=len(data)
        tar.addfile(entry,io.BytesIO(data))
with tarfile.open(fileobj=io.BytesIO(out.getvalue())) as tar:
    offsets={entry.name:entry.offset for entry in tar}
    print(json.dumps([base64.b64encode(out.getvalue()).decode(),offsets,tar.offset]))
`,stock);
const [base64,offsets,archiveEnd] = fixture;
const resources = Buffer.from(base64,'base64');
const extra = {techart_calendar:Buffer.from('calendar fixture'),resistors:Buffer.from('resistors fixture')};
const build = {
  version:'eddy-test',
  parts:[{name:'resources.tar.gz',size:resources.length,sha256:digest('sha256',resources)}],
  resourceIndex:{manifest:offsets.Manifest,launcherOrder:offsets[launcher],communityList:offsets[communityList],
    archiveEnd,spotifySignIn:true,apps:Object.fromEntries(Object.keys(appFiles).map(name=>[stock[name],{name,offset:offsets[name]}]))},
  communityApps:Object.fromEntries(Object.entries(extra).map(([id,bytes])=>
    [id,{name:id,size:bytes.length,sha256:digest('sha256',bytes),license:'Fixture license '+id}])),
};

function unpack(bytes) {
  const values = python(`
with tarfile.open(fileobj=io.BytesIO(base64.b64decode(json.load(sys.stdin)))) as tar:
    print(json.dumps({m.name:base64.b64encode(tar.extractfile(m).read()).decode() if m.isfile() else None for m in tar}))
`,Buffer.from(bytes).toString('base64'));
  return Object.fromEntries(Object.entries(values).map(([key,value])=>[key,value===null?null:Buffer.from(value,'base64')]));
}

test('selected community apps reach USB and qFlipper with an accurate resource manifest',async t=>{
  const fetched = [];
  const responses = new Map([['resources.tar.gz',resources],...Object.entries(extra).map(([id,data])=>[id+'.fap',data])]);
  t.mock.method(globalThis,'fetch',async url=>{
    const file = url.pathname.split('/').pop();
    fetched.push(file);
    return new Response(responses.get(file),{status:responses.has(file)?200:404});
  });
  const base = await prepareInstall(build,all);
  assert.deepEqual(fetched,['resources.tar.gz']);
  assert.deepEqual(Buffer.from(base[0].bytes),resources);

  for (const ids of [['resistors'],['techart_calendar','resistors']]) {
    const files = await prepareInstall(build,['music'],null,defaultAppOrder,ids);
    const bundle = unpack(await (await makeDownload(build,files)).arrayBuffer());
    const image = Object.values(bundle).find(value=>value!==null);
    assert.deepEqual(image,Buffer.from(files[0].bytes));
    assert.equal(digest('sha256',image),files[0].part.sha256);
    const sd = unpack(image);
    assert.equal(sd[communityList].toString(),ids.join('\n')+'\n');
    assert.equal(sd[launcher].toString(),'music\n');
    assert.deepEqual(Object.keys(sd).filter(path=>/^apps\/Community\/.*\.fap$/.test(path)),
      ids.map(id=>'apps/Community/'+id+'.fap'));
    const manifest = sd.Manifest.toString().split('\n');
    assert(manifest.includes('D:apps/Community'));
    for (const [name,data] of Object.entries(sd).filter(([name,data])=>name!=='Manifest' && data!==null)) {
      assert(manifest.includes('F:'+digest('md5',data)+':'+data.length+':'+name));
    }
    for (const id of ids) {
      assert.deepEqual(sd['apps/Community/'+id+'.fap'],extra[id]);
      assert.equal(sd['apps/Community/'+id+'.LICENSE.txt'].toString(),build.communityApps[id].license);
    }
  }
  await assert.rejects(prepareInstall(build,all,null,defaultAppOrder,['../bad']),/unavailable/);
  await assert.rejects(prepareInstall(build,all,null,defaultAppOrder,['resistors','resistors']),/unavailable/);
  responses.set('resistors.fap',Buffer.alloc(extra.resistors.length));
  await assert.rejects(prepareInstall(build,all,null,defaultAppOrder,['resistors']),/verification/);
});

test('personal Spotify setup adds the ID only to the local package on either install path', async t => {
  const id = '1234567890abcdef1234567890abcdef';
  const path = 'eddy/spotify_signin.xbm';
  const requested = [];
  t.mock.method(globalThis, 'fetch', async url => {
    requested.push(String(url));
    return new Response(resources);
  });
  const files = await prepareInstall(build, all, null, defaultAppOrder, [], id);
  const image = files[0].bytes;
  const downloaded = unpack(await (await makeDownload(build, files)).arrayBuffer());
  assert.deepEqual(Object.values(downloaded).find(Boolean), Buffer.from(image));
  assert.equal(digest('md5', image), files[0].part.md5);
  const sd = unpack(image);
  assert.equal(sd[path].length, 512);
  assert.deepEqual(sd[path], Buffer.from(spotifySignInBitmap(id)));
  assert.notDeepEqual(sd[path], Buffer.from(spotifySignInBitmap('0'.repeat(32))));
  assert(!sd.Manifest.toString().includes(path), 'a later stock update must preserve personal data');
  const stockFiles = await prepareInstall(build, all);
  assert.deepEqual(Buffer.from(stockFiles[0].bytes), resources);
  assert(!Object.hasOwn(unpack(stockFiles[0].bytes), path));
  await assert.rejects(prepareInstall(build, all, null, defaultAppOrder, [], 'invalid'), /Client ID/);
  await assert.rejects(prepareInstall(build, ['music'], null, defaultAppOrder, [], id), /select Spotify/);
  const oldBuild = {...build, resourceIndex:{...build.resourceIndex, spotifySignIn:false}};
  await assert.rejects(prepareInstall(oldBuild, all, null, defaultAppOrder, [], id), /predates Spotify/);
  assert.equal(requested.length, 2);
  assert(requested.every(url => url.endsWith('/resources.tar.gz') && !url.includes(id)));
});

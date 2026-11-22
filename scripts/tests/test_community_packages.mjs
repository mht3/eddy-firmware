import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {test} from 'node:test';
import {catalog,defaultAppOrder} from '../../website/app-catalog.js';
import {prepareInstall,makeDownload} from '../../website/update/package.js';

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
const extra = {techart_calendar:Buffer.from('calendar fixture'),sample_app:Buffer.from('sample app fixture')};
const build = {
  version:'eddy-test',
  parts:[{name:'resources.tar.gz',size:resources.length,sha256:digest('sha256',resources)}],
  resourceIndex:{manifest:offsets.Manifest,launcherOrder:offsets[launcher],communityList:offsets[communityList],
    archiveEnd,apps:Object.fromEntries(Object.keys(appFiles).map(name=>[stock[name],{name,offset:offsets[name]}]))},
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

  for (const ids of [['sample_app'],['techart_calendar','sample_app']]) {
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
  await assert.rejects(prepareInstall(build,all,null,defaultAppOrder,['sample_app','sample_app']),/unavailable/);
  responses.set('sample_app.fap',Buffer.alloc(extra.sample_app.length));
  await assert.rejects(prepareInstall(build,all,null,defaultAppOrder,['sample_app']),/verification/);
});

test('selecting Spotify installs the app without a personal sign-in code', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(resources));
  const files = await prepareInstall(build, ['spotify']);
  const sd = unpack(files[0].bytes);
  assert.equal(sd[launcher].toString(), 'spotify\n');
  assert(!Object.hasOwn(sd, 'eddy/spotify_signin.xbm'));
});

test('a verified Flipper Lab app reaches the SD launcher and survives preparing another update', async t => {
  const {readFile} = await import('node:fs/promises');
  const {rememberLabApp, setCommunityRelease, selectCommunity, getCommunitySelection, labAlias} =
    await import('../../website/community-apps.js');
  const {verifyCatalogFap} = await import('../../website/update/fap.js');
  t.mock.method(globalThis,'fetch',async () => new Response(resources));
  const previousWindow = globalThis.window;
  globalThis.window = new EventTarget();
  t.after(() => { globalThis.window = previousWindow; });
  const data = new Uint8Array(await readFile(new URL('../../website/community/techart_calendar.fap',import.meta.url)));
  const csv = await readFile(new URL('../../targets/f7/api_symbols.csv',import.meta.url),'utf8');
  const symbols = csv.split(/\r?\n/).filter(row => /^(?:Variable|Function),\+,/.test(row))
    .map(row => [...row.split(',')[2]].reduce((h,ch) => (Math.imul(h,33)+ch.charCodeAt(0))>>>0,5381));
  const compatibility = {api:csv.match(/Version,\+,([\d.]+)/)[1],target:'f7',symbols};
  const alias = labAlias('https://lab.flipper.net/apps/4new_app');
  assert.equal(alias,'4new_app');
  const icon = verifyCatalogFap(data,compatibility).iconHex;
  await rememberLabApp({id:alias,name:'New App',sha256:digest('sha256',data),iconHex:icon,data});
  setCommunityRelease(build.communityApps,compatibility);
  selectCommunity([alias]);
  const selected = getCommunitySelection();
  assert.deepEqual(selected,[alias]);
  const release = {...build,catalogCompatibility:compatibility};
  const entries = await prepareInstall(release,all,null,defaultAppOrder,selected);
  const sd = unpack(entries[0].bytes);
  assert.deepEqual(sd['apps/Community/4new_app.fap'],Buffer.from(data));
  assert.equal(sd[communityList].toString(),alias+'\tNew App\t'+icon+'\n');
  assert(sd.Manifest.toString().includes('F:'+digest('md5',data)+':'+data.length+':apps/Community/'+alias+'.fap'));
  await assert.rejects(prepareInstall(build,all,null,defaultAppOrder,selected),/unavailable/);
  await assert.rejects(prepareInstall({...release,catalogCompatibility:{...compatibility,api:'1.0'}},
    all,null,defaultAppOrder,selected),/requires firmware API/);
  selectCommunity([]);
  assert.deepEqual(getCommunitySelection(),[]);
});

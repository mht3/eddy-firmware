import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {fetchLabApp, LabFileRequired} from '../../website/update/flipper-lab.js';

const read = path => readFileSync(new URL('../../' + path, import.meta.url));
const fap = read('website/community/techart_calendar.fap');
const csv = read('targets/f7/api_symbols.csv').toString();
const api = /^Version,\+,([\d.]+),/m.exec(csv)[1];
const symbols = csv.split('\n').map(line => line.split(','))
  .filter(([kind, status]) => status === '+' && ['Function', 'Variable'].includes(kind))
  .map(([, , name]) => [...name].reduce((a, char) => (33 * a + char.charCodeAt(0)) >>> 0, 5381));
const versionId = '1234567890abcdef12345678';
const sha256 = createHash('sha256').update(fap).digest('hex');
const alias = 'test_app';
const record = {name:'Test app', description:'Catalog app', api, versionId, sha256};

function fixture(t, release, app, contents = fap) {
  const catalog = 'eddy-' + release + '/lab/index.json';
  const requests = [];
  t.mock.method(globalThis, 'fetch', async url => {
    requests.push(url.href);
    if (url.href.endsWith('/' + catalog)) {
      return Response.json({date:'2026-11-21', api, target:'f7', apps:{[alias]:app}});
    }
    if (url.href.endsWith('/' + alias + '.fap')) return new Response(contents);
    if (url.href.endsWith('/' + alias + '.LICENSE.txt')) return new Response('Upstream license');
    throw Error('Unexpected network request ' + url);
  });
  return {compatibility:{api, target:'f7', symbols, catalog}, requests};
}

test('one-click import verifies bytes, loads the license and exposes matching source', async t => {
  const {compatibility, requests} = fixture(t, 'mirror', {...record, mirrored:true});
  const app = await fetchLabApp(alias, compatibility);
  assert.equal(app.name, record.name);
  assert.equal(app.sha256, sha256);
  assert.deepEqual(Buffer.from(app.data), fap);
  assert.match(app.iconHex, /^[a-f0-9]{40}$/);
  assert.match(app.license, /Upstream license/);
  assert.ok(app.sourceUrl.endsWith('/lab/' + alias + '.source.zip'));
  assert.equal(requests.length, 3);
});

test('choose an official FAP, accept it on matching SHA and reject a different file', async t => {
  const {compatibility} = fixture(t, 'userfile', record);
  await assert.rejects(fetchLabApp(alias, compatibility), error => {
    assert.ok(error instanceof LabFileRequired);
    assert.equal(error.appName, record.name);
    assert.equal(error.downloadUrl, 'https://catalog.flipperzero.one/api/v0/1/application/version/' +
      versionId + '/build/f7/' + api);
    return true;
  });
  await assert.rejects(fetchLabApp(alias, compatibility, new Blob(['wrong'])), /differs from the official/);
  const app = await fetchLabApp(alias, compatibility, new Blob([fap]));
  assert.ok(app.sourceUrl.endsWith('/' + versionId + '/bundle'));
  assert.equal(app.license, undefined);
});

test('ignores arbitrary catalog URLs and verifies mirror integrity', async t => {
  const {compatibility,requests} = fixture(t, 'badbytes', {...record, mirrored:true,
    downloadUrl:'https://outside.example/app', sourceUrl:'https://outside.example/source'}, new Uint8Array([1]));
  await assert.rejects(fetchLabApp(alias, compatibility), /differs from the official/);
  await assert.rejects(fetchLabApp('../unsafe', compatibility), /link from a Flipper Lab/);
  await assert.rejects(fetchLabApp(alias, {...compatibility, catalog:'https://outside.example/lab/index.json'}), /supports Flipper Lab/);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(url => !url.includes('outside.example')));
});

test('missing, incompatible or incomplete catalog entries explain why they cannot be added', async t => {
  const {compatibility} = fixture(t, 'missing', {...record, api:'1.0'});
  await assert.rejects(fetchLabApp(alias, compatibility), /no compatible/);
  await assert.rejects(fetchLabApp('unknown_app', compatibility), /updated 2026-11-21/);
});

test('retries after an unavailable app index', async t => {
  const compatibility = {api, target:'f7', symbols, catalog:'eddy-retry/lab/index.json'};
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => ++requests === 1 ? new Response(null, {status:503}) :
    Response.json({date:'2026-11-21',api,target:'f7',apps:{[alias]:record}}));
  await assert.rejects(fetchLabApp(alias, compatibility), /list could not be loaded/);
  const app = await fetchLabApp(alias, compatibility, new Blob([fap]));
  assert.equal(app.id, alias);
});

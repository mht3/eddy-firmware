import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {verifyCatalogFap} from '../../website/update/fap.js';

const read = path => readFileSync(new URL('../../' + path, import.meta.url));
const symbols = read('targets/f7/api_symbols.csv').toString().split('\n')
  .map(row => row.split(','))
  .filter(([kind, status]) => status === '+' && (kind === 'Function' || kind === 'Variable'))
  .map(([, , name]) => [...name].reduce((hash, char) => (33 * hash + char.charCodeAt(0)) >>> 0, 5381));
const api = /^Version,\+,([\d.]+),/m.exec(read('targets/f7/api_symbols.csv').toString())[1];
const release = {api, target:'f7', symbols};
const calendar = read('website/community/techart_calendar.fap');

function sectionHeader(file, name) {
  const start = file.readUInt32LE(32), count = file.readUInt16LE(48);
  const strings = file.readUInt32LE(start + file.readUInt16LE(50) * 40 + 16);
  for (let i = 0; i < count; ++i) {
    const header = start + i * 40;
    const p = strings + file.readUInt32LE(header);
    if (file.toString('utf8', p, file.indexOf(0, p)) === name) return header;
  }
  assert.fail('Fixture is missing ' + name);
}
const meta = calendar.readUInt32LE(sectionHeader(calendar, '.fapmeta') + 16);

test('both shipped ARM apps pass the release symbol check, including compact relocations', () => {
  for (const name of ['techart_calendar', 'resistors']) {
    verifyCatalogFap(read('website/community/' + name + '.fap'), release);
  }
});

test('classic relocation-only packages are checked against the same firmware exports', () => {
  const file = Buffer.from(calendar);
  const fastName = file.indexOf(Buffer.from('.fast.rel.text\0'));
  assert.ok(fastName > 0);
  // .rel.text may be stored as a suffix in the same ELF string.
  file.write('.skip', fastName, 'ascii');
  verifyCatalogFap(file, release);
  assert.throws(() => verifyCatalogFap(file, {...release, symbols:[0]}), /firmware feature/);
});

test('checks compact hash imports even when ordinary relocation imports are available', () => {
  const file = Buffer.from(calendar);
  const fast = file.readUInt32LE(sectionHeader(file, '.fast.rel.text') + 16);
  let p = fast + 5;
  for (let i = 0; i < file.readUInt32LE(fast + 1); ++i) {
    if (!(file[p] & 0x80)) {
      file.writeUInt32LE(0, p + 1);
      assert.throws(() => verifyCatalogFap(file, release), /firmware feature/);
      return;
    }
    p += 13 + 3 * file.readUInt32LE(p + 9);
  }
  assert.fail('Fixture contains no compact import');
});

test('rejects different hardware, incompatible APIs and libraries with no app entry', () => {
  for (const [offset, value, expected] of [[12,18,/hardware/], [10,256,/firmware API/],
    [8,65535,/firmware API/], [14,0,/plugin/]]) {
    const file = Buffer.from(calendar);
    file.writeUInt16LE(value, meta + offset);
    assert.throws(() => verifyCatalogFap(file, release), expected);
  }
  assert.throws(() => verifyCatalogFap(calendar, {}), /compatibility information/);
});

test('rejects incomplete headers and truncated relocation data', () => {
  assert.throws(() => verifyCatalogFap(calendar.subarray(0, 28), release), /invalid/);
  const file = Buffer.from(calendar);
  const header = sectionHeader(file, '.fast.rel.text');
  file.writeUInt32LE(6, header + 20);
  assert.throws(() => verifyCatalogFap(file, release), /invalid/);
});

test('reads raw and compressed app icons as ten rows of XBM pixels', () => {
  // Expected bytes were generated from the original app PNGs.
  assert.equal(verifyCatalogFap(calendar, release).iconHex, '00008400fe0102012a0102012a010201fe010000');
  const resistor = read('website/community/resistors.fap');
  assert.equal(verifyCatalogFap(resistor, release).iconHex, 'fc00fe018703030303038703ce01cc00cf03cf03');
  const absent = Buffer.from(calendar);
  absent[meta + 52] = 0;
  assert.equal(verifyCatalogFap(absent, release).iconHex, '');
});

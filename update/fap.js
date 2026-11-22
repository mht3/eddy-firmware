// Verify the same ARM ELF sections and symbol hashes that Eddy's FAP loader uses.
const decoder = new TextDecoder();
const relocationTypes = new Set([2, 3, 10, 28, 30, 38, 47, 48]);

function check(condition) {
  if (!condition) throw Error('The catalog returned an invalid or unsupported Flipper app package.');
}

function sectionString(bytes, section, index) {
  check(index < section.size);
  const start = section.offset + index;
  const table = bytes.subarray(start, section.offset + section.size);
  const end = table.indexOf(0);
  check(end >= 0);
  return decoder.decode(table.subarray(0, end));
}

function hashName(name) {
  let hash = 5381;
  for (const char of name) hash = (Math.imul(hash, 33) + char.charCodeAt(0)) >>> 0;
  return hash;
}

function readElf(bytes) {
  check(bytes instanceof Uint8Array && bytes.length >= 52);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = offset => view.getUint16(offset, true);
  const u32 = offset => view.getUint32(offset, true);
  check(u32(0) === 0x464c457f && bytes[4] === 1 && bytes[5] === 1 && bytes[6] === 1 &&
    u16(16) === 1 && u16(18) === 40 && u32(20) === 1 && u16(40) === 52);
  const table = u32(32), count = u16(48);
  check(u16(46) === 40 && table >= 52 && table + count * 40 <= bytes.length);
  const sections = [];
  for (let i = 0; i < count; ++i) {
    const p = table + i * 40;
    const section = {
      nameIndex: u32(p), type: u32(p + 4), flags: u32(p + 8), offset: u32(p + 16),
      size: u32(p + 20), link: u32(p + 24), info: u32(p + 28), entrySize: u32(p + 36),
    };
    // SHT_NOBITS occupies RAM only.
    check(section.type === 8 || section.offset + section.size <= bytes.length);
    sections.push(section);
  }
  const names = sections[u16(50)];
  check(names?.type === 3);
  const named = new Map();
  for (const section of sections) {
    section.name = sectionString(bytes, names, section.nameIndex);
    check(!named.has(section.name));
    named.set(section.name, section);
  }
  const text = named.get('.text');
  const entry = u32(24);
  check(text?.type === 1 && (text.flags & 6) === 6 && (entry & 1) && entry - 1 < text.size);
  return {bytes, u16, u32, sections, named};
}

function checkTarget(section) {
  check(section && (section.flags & 2) && !section.name.startsWith('.ARM.'));
}

function checkType(type) {
  if (!relocationTypes.has(type)) throw Error('This app uses a relocation format Eddy cannot load.');
}

function checkFast(elf, section, target, requireSymbol) {
  const {bytes, u32, sections} = elf;
  let pos = section.offset;
  const end = pos + section.size;
  check(section.type === 1 && section.size >= 5 && bytes[pos] === 1);
  const records = u32(pos + 1);
  pos += 5;
  for (let i = 0; i < records; ++i) {
    check(pos + 9 <= end);
    const kind = bytes[pos];
    const value = u32(pos + 1);
    checkType(kind & 0x7f);
    pos += 5;
    if (kind & 0x80) {
      check(pos + 8 <= end);
      checkTarget(sections[value]);
      check(u32(pos) <= sections[value].size);
      pos += 4;
    } else {
      requireSymbol(value);
    }
    const count = u32(pos);
    pos += 4;
    check(count > 0 && pos + count * 3 <= end);
    for (let j = 0; j < count; ++j) {
      const offset = bytes[pos] + bytes[pos + 1] * 256 + bytes[pos + 2] * 65536;
      check(offset + 4 <= target.size);
      pos += 3;
    }
  }
  check(pos === end);
}

function checkClassic(elf, section, target, requireSymbol) {
  const {bytes, u16, u32, sections} = elf;
  const symbols = sections[section.link];
  check(section.type === 9 && section.entrySize === 8 && section.size % 8 === 0 &&
    sections[section.info] === target && symbols?.name === '.symtab' &&
    symbols.type === 2 && symbols.entrySize === 16 && symbols.size % 16 === 0);
  const strings = sections[symbols.link];
  check(strings?.name === '.strtab' && strings.type === 3);
  for (let p = section.offset; p < section.offset + section.size; p += 8) {
    check(u32(p) + 4 <= target.size);
    const info = u32(p + 4);
    checkType(info & 0xff);
    const symbol = symbols.offset + (info >>> 8) * 16;
    check(symbol + 16 <= symbols.offset + symbols.size);
    const index = u16(symbol + 14);
    if (index) {
      checkTarget(sections[index]);
      check(u32(symbol + 4) <= sections[index].size);
    } else {
      const name = sectionString(bytes, strings, u32(symbol));
      check(name.length > 0);
      requireSymbol(hashName(name), name);
    }
  }
}

// FAP icons are 10 × 10 XBM pixels, two bytes per row. A zero header
// precedes raw data. Compressed icons use Heatshrink with an 8/4 window/lookahead.
function readIcon(bytes, metaOffset) {
  if (bytes[metaOffset + 52] === 0) return '';
  const icon = bytes.subarray(metaOffset + 53, metaOffset + 85);
  let pixels;
  if (icon[0] === 0) {
    pixels = icon.subarray(1, 21);
  } else {
    check(icon[0] === 1 && icon[1] === 0);
    const size = icon[2] + 256 * icon[3];
    check(size > 0 && size + 4 <= icon.length);
    const stream = icon.subarray(4, 4 + size);
    let bit = 0;
    function readBits(count) {
      check(bit + count <= stream.length * 8);
      let value = 0;
      for (let i = 0; i < count; ++i, ++bit) {
        value = value * 2 + ((stream[bit >> 3] >> (7 - (bit % 8))) & 1);
      }
      return value;
    }
    pixels = new Uint8Array(20);
    let pos = 0;
    while (pos < pixels.length) {
      if (readBits(1)) {
        pixels[pos++] = readBits(8);
      } else {
        const distance = readBits(8) + 1, count = readBits(4) + 1;
        check(pos + count <= pixels.length);
        for (let i = 0; i < count; ++i, ++pos) {
          // Heatshrink initializes its history window with zeroes.
          pixels[pos] = pos >= distance ? pixels[pos - distance] : 0;
        }
      }
    }
    const padding = stream.length * 8 - bit;
    check(padding < 8 && readBits(padding) === 0);
  }
  return Array.from(pixels, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function verifyCatalogFap(bytes, compatibility) {
  const version = /^(\d+)\.(\d+)$/.exec(compatibility?.api);
  if (!version || compatibility.target !== 'f7' || !Array.isArray(compatibility.symbols) ||
      !compatibility.symbols.length) throw Error('This Eddy release is missing its app compatibility information.');
  const elf = readElf(bytes);
  const meta = elf.named.get('.fapmeta');
  check(meta?.type === 1 && (meta.size === 85 || meta.size === 86));
  const p = meta.offset;
  check(elf.u32(p) === 0x52474448 && elf.u32(p + 4) === 1);
  if (elf.u16(p + 12) !== 7) throw Error('This app was built for different Flipper hardware.');
  if (!elf.u16(p + 14)) throw Error('This package is a plugin. Choose a standalone app in Flipper Lab.');
  const major = elf.u16(p + 10), minor = elf.u16(p + 8);
  if (major !== Number(version[1]) || minor > Number(version[2])) {
    throw Error('This app requires firmware API ' + major + '.' + minor + '. Eddy uses ' + compatibility.api + '.');
  }
  const available = new Set(compatibility.symbols);
  function requireSymbol(hash, name) {
    if (!available.has(hash)) {
      throw Error('This app needs a firmware feature this Eddy release does not provide' +
        (name ? ' (' + name + ')' : '') + '.');
    }
  }
  for (const section of elf.sections) {
    const {name} = section;
    if (name.startsWith('.fast.rel.ARM.') || name.startsWith('.rel.ARM.')) continue;
    if (name.startsWith('.fast.rel.')) {
      const target = elf.named.get(name.slice('.fast.rel'.length));
      checkTarget(target);
      checkFast(elf, section, target, requireSymbol);
    } else if (name.startsWith('.rel.') || section.type === 9 || section.type === 4 || section.flags & 0x40) {
      const target = elf.named.get(name.slice('.rel'.length));
      checkTarget(target);
      checkClassic(elf, section, target, requireSymbol);
    }
  }
  return {iconHex: readIcon(bytes, p)};
}

// The Flipper storage CLI reports MD5 for uploaded files. Published downloads
// are independently checked against SHA-256 before reaching this step.
const rotations = [
  7,12,17,22, 7,12,17,22, 7,12,17,22, 7,12,17,22,
  5,9,14,20, 5,9,14,20, 5,9,14,20, 5,9,14,20,
  4,11,16,23, 4,11,16,23, 4,11,16,23, 4,11,16,23,
  6,10,15,21, 6,10,15,21, 6,10,15,21, 6,10,15,21,
];
const constants = Array.from({length:64}, (_,i)=>Math.floor(0x100000000 * Math.abs(Math.sin(i+1))));

export function md5(bytes) {
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const words = new DataView(padded.buffer);
  words.setUint32(padded.length-8, bytes.length * 8, true);
  words.setUint32(padded.length-4, Math.floor(bytes.length / 0x20000000), true);

  const hash = new Uint32Array([0x67452301,0xefcdab89,0x98badcfe,0x10325476]);
  for (let offset=0; offset<padded.length; offset+=64) {
    let [a,b,c,d] = hash;
    for (let i=0; i<64; i++) {
      let mix, index;
      if (i<16) { mix=(b & c) | (~b & d); index=i; }
      else if (i<32) { mix=(d & b) | (~d & c); index=(5*i+1)%16; }
      else if (i<48) { mix=b ^ c ^ d; index=(3*i+5)%16; }
      else { mix=c ^ (b | ~d); index=(7*i)%16; }
      const sum = (a + mix + constants[i] + words.getUint32(offset+4*index,true)) | 0;
      const shifted = (sum << rotations[i]) | (sum >>> (32-rotations[i]));
      a=d; d=c; c=b; b=(b+shifted) | 0;
    }
    hash[0]+=a; hash[1]+=b; hash[2]+=c; hash[3]+=d;
  }
  const digest = new DataView(new ArrayBuffer(16));
  hash.forEach((word,i)=>digest.setUint32(4*i,word,true));
  return Array.from(new Uint8Array(digest.buffer),v=>v.toString(16).padStart(2,'0')).join('');
}

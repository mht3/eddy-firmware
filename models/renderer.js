// Coordinates here are millimetres. The glTF files use standard metres.
const vertexSource = `#version 300 es
precision highp float;
in vec3 position;
in vec3 normal;
uniform mat3 camera;
uniform mat3 rotation;
uniform vec2 scale;
uniform vec2 center;
uniform vec3 offset;
out vec3 world;
out vec3 surface;
void main() {
  world = rotation * position * 1000.0 + offset;
  surface = rotation * normal;
  vec3 eye = camera * world;
  gl_Position = vec4(eye.xy * scale + center, -eye.z / 260.0, 1.0);
}`;

const fragmentSource = `#version 300 es
precision highp float;
in vec3 world;
in vec3 surface;
uniform vec3 color;
uniform vec3 eyeDirection;
uniform float metallic;
uniform int part;
uniform sampler2D lcd;
uniform sampler2D labels;
out vec4 pixel;

float roundedBox(vec2 p, vec2 halfSize, float r) {
  vec2 q = abs(p) - halfSize + r;
  return min(max(q.x,q.y),0.0) + length(max(q,0.0)) - r;
}
float coverage(float edge) {
  float aa = max(fwidth(edge), 0.012);
  return 1.0 - smoothstep(-aa * 0.5, aa * 0.5, edge);
}
void main() {
  vec3 n = normalize(surface);
  vec3 key = normalize(vec3(-0.37, 0.69, 0.82));
  vec3 fill = normalize(vec3(0.83, -0.25, 0.42));
  vec3 rim = normalize(vec3(0.52, 0.80, -0.68));
  float diffuse = 0.26 + 0.59 * max(dot(n, key), 0.0)
                       + 0.22 * max(dot(n, fill), 0.0) + 0.2 * max(dot(n,rim),0.0);
  float rough = part == 2 ? 0.2 : 0.43;
  vec3 albedo = color;
  // A broad front softbox and a brighter strip above the GPIO edge. Their
  // attenuation varies across the enclosure, including the large planar faces.
  vec3 areaLight = normalize(vec3(-35.0,52.0,35.0) - world);
  diffuse += 0.16 * max(dot(n,areaLight),0.0) - 0.08;
  diffuse *= 0.86 + 0.14 * smoothstep(-19.0, 15.0, world.y + 0.42*world.z);
  float facing = max(dot(n,eyeDirection),0.0);
  if (part == 0) {
    // The graphite line is the split between the two molded shell halves.
    float seam = 1.0 - smoothstep(0.02, 0.13, abs(world.z + 4.0));
    albedo *= 1.0 - 0.34 * seam * (1.0 - abs(n.z));
    // Warm reflected light from the key pad falls on its recessed seat.
    float recess = length((world.xy - vec2(25.36,3.95)) / vec2(11.0));
    albedo *= 1.0 - 0.26 * exp(-abs(recess - 1.0) * 14.0) * max(n.z,0.0);
    vec2 logoUV = vec2((world.x + 24.0)/14.5, (-7.9-world.y)/2.2);
    if (n.z > 0.72 && all(greaterThanEqual(logoUV,vec2(0.0))) && all(lessThanEqual(logoUV,vec2(1.0)))) {
      float ink = texture(labels,vec2(logoUV.x,logoUV.y*0.5)).a;
      albedo = mix(albedo,vec3(0.18,0.166,0.142),ink);
    }
    vec2 pinUV = vec2((world.x+30.4)/64.0,(5.6-world.z)/1.55);
    if (n.y > 0.65 && world.y>18.0 && all(greaterThanEqual(pinUV,vec2(0.0))) && all(lessThanEqual(pinUV,vec2(1.0)))) {
      albedo = mix(albedo,vec3(0.18,0.175,0.152),texture(labels,vec2(pinUV.x,0.5+pinUV.y*0.5)).a);
    }
    // The blind bottoms of the connector pin holes sit behind their black rims.
    if (world.y > 12.0 && world.y < 19.3 && world.z > 0.6 && world.z < 3.35 &&
        ((world.x > -29.4 && world.x < -8.0) || (world.x > 5.9 && world.x < 32.8))) {
      albedo *= 0.055;
    }
    // Contact shadow cast by the two walls of the recessed right-side port.
    vec2 port = vec2(world.y+4.26, world.z-1.64);
    if (world.x>42.0 && world.x<49.64 && roundedBox(port,vec2(4.38,1.58),1.15)<0.0) {
      albedo = mix(vec3(0.010,0.013,0.012),albedo,0.04);
    }
  }
  float spec = pow(max(dot(n,normalize(eyeDirection+key)),0.0), mix(96.0,22.0,rough));
  float fresnel = pow(1.0 - max(dot(n,eyeDirection),0.0),4.0);
  float broad = pow(max(dot(n,normalize(eyeDirection+areaLight)),0.0),12.0);
  vec3 shaded = albedo * diffuse + vec3(spec * 0.18 + fresnel * 0.031 + broad*0.038);
  if (metallic > 0.5) {
    vec3 ref = reflect(-eyeDirection,n);
    float strip = exp(-pow((ref.y - 0.46 + 0.006*world.z) * 3.6,2.0));
    float edge = exp(-pow((ref.x + 0.66) * 5.0,2.0));
    shaded = albedo * (0.21 + 0.69 * strip + 0.4 * edge + 0.43 * max(ref.z,0.0));
  }
  if (part == 2 && n.z > 0.985) {
    // Only the LCD artwork has native 128×64 pixels. The bezel and glass
    // have antialiased contours at the full drawing buffer resolution.
    vec2 q = world.xy - vec2(-6.64,3.95);
    float activeArea = coverage(roundedBox(q,vec2(15.9,7.95),0.34));
    float lip = coverage(roundedBox(q,vec2(16.28,8.33),0.67));
    float rimMask = coverage(roundedBox(q,vec2(17.76,10.07),1.66));
    vec3 bezel = mix(vec3(0.042,0.049,0.044),vec3(0.014,0.018,0.017),rimMask);
    bezel = mix(bezel,vec3(0.115,0.077,0.041),lip);
    vec2 uv = vec2(q.x / 31.8 + 0.5, 0.5 - q.y / 15.9);
    float ink = texture(lcd,clamp(uv,0.0,1.0)).a;
    vec3 amber = mix(vec3(1.0,0.51,0.143),vec3(0.83,0.34,0.073),clamp(uv.y*0.58,0.0,1.0));
    vec3 panel = mix(amber,vec3(0.080,0.038,0.012),ink);
    shaded = mix(bezel,panel,activeArea) + 0.014 * max(0.0, 1.0 - (q.x + q.y) * 0.035);
  }
  pixel = vec4(pow(max(shaded,0.0),vec3(1.0/2.2)),1.0);
}`;

function makeProgram(gl) {
  const program = gl.createProgram();
  for (const [type, code] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, code);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
  return program;
}

const normalize = v => {
  const length = Math.hypot(...v);
  return v.map(n => n / length);
};
const cross = (a, b) => [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]];
const blend = (a, b, u) => a * (1-u) + b * u;
const clamp01 = v => Math.min(1,Math.max(0,v));

// End face-on, framing 72 × 36 mm of the production housing around the LCD and keys.
function closeUp(phase) {
  const t = clamp01((phase - 1.48) / 1.24);
  return t*t*(3 - 2*t);
}

export function cameraFor(phase, still) {
  const t = still ? 0 : Math.sin(phase * Math.PI / 3);
  const tilt = 1 - closeUp(phase);
  const yaw = (0.39 + 0.21*t)*tilt, pitch = (0.31 + 0.06*t)*tilt, roll = (0.27 - 0.08*t)*tilt;
  const eye = [Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)];
  const right = normalize(cross([0,1,0],eye)), up = cross(eye,right);
  const a = Math.cos(roll), b = Math.sin(roll);
  return right.flatMap((value, i) => [value * a - up[i] * b, value * b + up[i] * a, eye[i]]);
}

export function plugOffset(phase) {
  const ease = value => { const t = clamp01(value); return t*t*(3-2*t); };
  const gap = blend(11.0,-6.4,ease(phase / 0.64)) + 37*ease((phase-1.65)/0.75);
  return [49.9+gap, -4.25, 1.63];
}

function shellLabels() {
  const atlas = document.createElement('canvas');
  atlas.width=1024;
  atlas.height=256;
  const ctx=atlas.getContext('2d');
  ctx.fillStyle='#fff';
  ctx.textBaseline='middle';
  ctx.save();
  ctx.scale(1.65,1);
  ctx.font='italic 900 103px Arial, sans-serif';
  ctx.fillText('FLIPPER',6,68);
  ctx.restore();
  ctx.font='700 69px monospace';
  ctx.fillText('ZERO',752,70);
  ctx.textAlign='center';
  ctx.font='600 88px monospace';
  for (let i=0;i<18;i++) {
    const y=i<8 ? -1.7 + 2.54*i : 33.8 + 2.54*(i-8);
    const x=(y-26.14+30.4)/64*1024;
    ctx.save();
    ctx.translate(x,193);
    ctx.scale(0.24,1);
    ctx.fillText(String(i+1),0,0);
    ctx.restore();
  }
  return atlas;
}

function parseModel(buffer) {
  const view = new DataView(buffer);
  if (view.getUint32(0,true) !== 0x46546c67 || view.getUint32(4,true) !== 2) throw Error('Invalid glTF model');
  const length = view.getUint32(12,true);
  const doc = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,20,length)));
  const start = length+28;
  function values(index) {
    const a = doc.accessors[index], v = doc.bufferViews[a.bufferView];
    const at = start + (v.byteOffset || 0) + (a.byteOffset || 0);
    if (a.componentType === 5123) return new Uint16Array(buffer,at,a.count);
    if (a.componentType === 5126) return new Float32Array(buffer,at,a.count*3);
    throw Error('Unexpected glTF accessor type');
  }
  const primitives = doc.meshes[0].primitives;
  return {
    positions: values(primitives[0].attributes.POSITION),
    normals: values(primitives[0].attributes.NORMAL),
    groups: primitives.map(p => {
      const m = doc.materials[p.material];
      return {name:m.name,indices:values(p.indices),...m.pbrMetallicRoughness};
    }),
  };
}

let geometry;
export function loadGeometry() {
  if (!geometry) geometry = Promise.all(['flipper-zero.glb','usb-c.glb'].map(async filename => {
    const response = await fetch(new URL(filename,import.meta.url));
    if (!response.ok) throw Error('Failed to load ' + filename);
    return parseModel(await response.arrayBuffer());
  })).catch(error => { geometry = null; throw error; });
  return geometry;
}

// The machined metal plug is a separate CAD model. The molded cable boot,
// strain relief and circular flexible lead extend back from its solder end.
function cableGeometry() {
  const positions = [], normals = [], indices = [], sides = 64;
  function meshStrip(rings, close = false) {
    const start = positions.length / 3;
    const count = rings.length;
    for (let row = 0; row < count; row++) {
      const previous = rings[Math.max(row - 1,0)], next = rings[Math.min(row + 1,count - 1)];
      for (let j = 0; j < sides; j++) {
        const p = rings[row][j], after = rings[row][(j+1)%sides], before = rings[row][(j+sides-1)%sides];
        const dir = next[j].map((v,i) => v-previous[j][i]);
        const tangent = after.map((v,i) => v-before[i]);
        positions.push(...p.map(n => n/1000));
        normals.push(...normalize(cross(tangent,dir)));
        if (row < count-1) {
          const a = start+row*sides+j, b = start+row*sides+(j+1)%sides;
          indices.push(a,b,a+sides,b,b+sides,a+sides);
        }
      }
    }
    if (close) {
      for (let j=1; j<sides-1; j++) indices.push(start,start+j+1,start+j);
    }
  }
  function bootRing(x,ry,rz,roundness) {
    return Array.from({length:sides},(_,j) => {
      const a = Math.PI*2*j/sides;
      const point = v => Math.sign(v)*Math.pow(Math.abs(v),roundness);
      return [x,ry*point(Math.cos(a)),rz*point(Math.sin(a))];
    });
  }
  meshStrip([[6.7,4.9,2.28],[6.82,5.2,2.55],[7.15,5.48,2.83],[7.8,5.58,2.94],
    [17.2,5.58,2.94],[18.6,5.45,2.87],[20.2,4.8,2.65],[21.7,3.25,2.21],[23,2.24,1.85]]
    .map(([x,y,z])=>bootRing(x,y,z,0.64)),true);
  const bootEnd = indices.length;
  const relief = [[22.8,2.17],[23.4,2.2],[24,2.15],[24.23,1.87],[24.52,2.09],
    [25.4,2.04],[25.62,1.8],[25.92,1.98],[26.7,1.94],[26.94,1.72],[27.24,1.85],[28.2,1.74],[29,1.42]];
  meshStrip(relief.map(([x,r])=>bootRing(x,r,r*0.9,0.94)));
  const rings = [];
  for (let k=0;k<=72;k++) {
    const t=k/72;
    const x=28.7+95*t;
    const y=-17*t*t*(3-2*t) + 4.5*Math.sin(t*Math.PI*2)*t*t;
    const z=-5*t*t;
    rings.push(bootRing(x,1.42,1.35,1).map(p=>[p[0],p[1]+y,p[2]+z]));
  }
  meshStrip(rings);
  return { positions:new Float32Array(positions), normals:new Float32Array(normals), groups:[
    {name:'Overmold',baseColorFactor:[0.065,0.077,0.083],metallicFactor:0,indices:new Uint16Array(indices.slice(0,bootEnd))},
    {name:'Cable',baseColorFactor:[0.039,0.048,0.052],metallicFactor:0,indices:new Uint16Array(indices.slice(bootEnd))},
  ]};
}

export class DeviceRenderer {
  constructor(canvas, models) {
    const gl = canvas.getContext('webgl2',{alpha:true,antialias:true,depth:true,premultipliedAlpha:true});
    if (!gl) throw Error('WebGL 2 unavailable');
    this.gl = gl;
    this.program = makeProgram(gl);
    gl.useProgram(this.program);
    this.locations = {};
    for (const key of ['camera','rotation','scale','center','offset','color','eyeDirection','metallic','part','lcd','labels']) {
      this.locations[key] = gl.getUniformLocation(this.program,key);
    }
    this.buffers = [];
    this.arrays = [];
    this.models = [...models,cableGeometry()].map(model=>this.upload(model));
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,this.texture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    this.labels = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D,this.labels);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,shellLabels());
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.DEPTH_TEST);
  }

  upload(model) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    this.arrays.push(vao);
    gl.bindVertexArray(vao);
    const buffer = (target,data) => {
      const id = gl.createBuffer();
      this.buffers.push(id);
      gl.bindBuffer(target,id);
      gl.bufferData(target,data,gl.STATIC_DRAW);
      return id;
    };
    for (const [name,data] of [['position',model.positions],['normal',model.normals]]) {
      const attr = gl.getAttribLocation(this.program,name);
      buffer(gl.ARRAY_BUFFER,data);
      gl.enableVertexAttribArray(attr);
      gl.vertexAttribPointer(attr,3,gl.FLOAT,false,0,0);
    }
    const groups = model.groups.map(g => ({buffer:buffer(gl.ELEMENT_ARRAY_BUFFER,g.indices),
      count:g.indices.length, color:g.baseColorFactor.slice(0,3), metal:g.metallicFactor,
      part:g.name === 'Screen lens' ? 2 : g.name === 'Case' ? 0 : 1}));
    return {vao,groups};
  }

  draw(lcd, phase, still) {
    const gl = this.gl, loc = this.locations, c = gl.canvas;
    const view = cameraFor(phase,still);
    const zoom = closeUp(phase);
    const pixelScale = blend(Math.min(c.width/153,c.height/76.5), Math.min(c.width/72,c.height/36), zoom);
    gl.viewport(0,0,c.width,c.height);
    gl.clearColor(0,0,0,0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(loc.camera,false,view);
    gl.uniform3fv(loc.eyeDirection,[view[2],view[5],view[8]]);
    gl.uniform2f(loc.scale,2*pixelScale/c.width,2*pixelScale/c.height);
    gl.uniform2f(loc.center,blend(-0.20,-16*pixelScale/c.width,zoom),blend(0.04,-3.9*pixelScale/c.height,zoom));
    gl.uniform1i(loc.lcd,0);
    gl.uniform1i(loc.labels,1);
    gl.bindTexture(gl.TEXTURE_2D,this.texture);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,lcd);
    for (const [index,model] of this.models.entries()) {
      gl.bindVertexArray(model.vao);
      const angle = index === 0 ? 0 : (1-clamp01(phase/0.64)) * 0.8;
      const cs=Math.cos(angle), sn=Math.sin(angle);
      gl.uniformMatrix3fv(loc.rotation,false,[cs,0,-sn,0,1,0,sn,0,cs]);
      gl.uniform3fv(loc.offset,index === 0 ? [0,0,0] : plugOffset(phase));
      for (const g of model.groups) {
        gl.uniform3fv(loc.color,g.color);
        gl.uniform1i(loc.part,g.part);
        gl.uniform1f(loc.metallic,g.metal);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,g.buffer);
        gl.drawElements(gl.TRIANGLES,g.count,gl.UNSIGNED_SHORT,0);
      }
    }
  }
  dispose() {
    const gl=this.gl;
    this.buffers.forEach(id=>gl.deleteBuffer(id));
    this.arrays.forEach(id=>gl.deleteVertexArray(id));
    gl.deleteTexture(this.texture);
    gl.deleteTexture(this.labels);
    gl.deleteProgram(this.program);
  }
}

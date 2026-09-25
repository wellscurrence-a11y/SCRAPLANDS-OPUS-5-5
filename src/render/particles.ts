/**
 * GPU-instanced billboard particles (additive + alpha-blended smoke), beams,
 * CPU-simulated debris chunks, ground scorch decals and a pooled flash-light system.
 */
import * as THREE from 'three';
import { G, FOG_FUNCTIONS } from './globals';
import { makeRadialSprite, makeSmokeAtlas } from './textures';
import { rand, randRange } from '../core/random';
import { clamp01, lerp } from '../core/math';

interface Particle {
  alive: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size0: number;
  size1: number;
  r0: number;
  g0: number;
  b0: number;
  a0: number;
  r1: number;
  g1: number;
  b1: number;
  a1: number;
  drag: number;
  gravity: number;
  rot: number;
  spin: number;
  stretch: number;
  frame: number;
  groundY: number;
  lit: number;
}

function newParticle(): Particle {
  return {
    alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, size0: 1, size1: 1,
    r0: 1, g0: 1, b0: 1, a0: 1, r1: 1, g1: 1, b1: 1, a1: 0, drag: 0, gravity: 0, rot: 0, spin: 0, stretch: 0, frame: 0,
    groundY: -1e9, lit: 0,
  };
}

const VERT = /* glsl */ `
  attribute vec3 iPos;
  attribute vec4 iColor;
  attribute vec4 iMisc; // size, rot, stretch, frame
  attribute vec3 iVel;
  varying vec2 vUv;
  varying vec4 vColor;
  varying vec3 vWorld;
  varying float vFrame;
  void main() {
    vec4 mv = viewMatrix * vec4(iPos, 1.0);
    float size = iMisc.x;
    float rot = iMisc.y;
    float stretch = iMisc.z;
    vec2 corner = position.xy;
    vec2 offset;
    if (stretch > 0.0) {
      vec3 vv = (viewMatrix * vec4(iVel, 0.0)).xyz;
      vec2 d = vv.xy;
      float l = length(d);
      vec2 dir = l > 1e-4 ? d / l : vec2(1.0, 0.0);
      vec2 perp = vec2(-dir.y, dir.x);
      float len = size + l * stretch;
      offset = dir * corner.x * len + perp * corner.y * size * 0.35;
    } else {
      float c = cos(rot), s = sin(rot);
      offset = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y) * size;
    }
    mv.xy += offset;
    vWorld = (inverse(viewMatrix) * mv).xyz;
    gl_Position = projectionMatrix * mv;
    vUv = position.xy + 0.5;
    vColor = iColor;
    vFrame = iMisc.w;
  }
`;

const FRAG_ADD = /* glsl */ `
  uniform sampler2D uTex;
  varying vec2 vUv;
  varying vec4 vColor;
  varying vec3 vWorld;
  ${FOG_FUNCTIONS}
  void main() {
    float a = texture2D(uTex, vUv).r;
    vec3 col = vColor.rgb * a * vColor.a;
    // fade additive into fog by distance
    vec3 fogged = applyWorldFog(col, vWorld);
    float fogK = length(fogged - col) / max(length(col), 1e-3);
    gl_FragColor = vec4(col * (1.0 - clamp(fogK, 0.0, 0.9)), 1.0);
  }
`;

const FRAG_SMOKE = /* glsl */ `
  uniform sampler2D uTex;
  uniform vec3 uAmbient;
  uniform vec3 uSun;
  varying vec2 vUv;
  varying vec4 vColor;
  varying vec3 vWorld;
  varying float vFrame;
  ${FOG_FUNCTIONS}
  void main() {
    float f = floor(vFrame + 0.5);
    vec2 cell = vec2(mod(f, 4.0), floor(f / 4.0));
    vec2 uv = (cell + vUv) / 4.0;
    float a = texture2D(uTex, uv).a * vColor.a;
    if (a < 0.004) discard;
    float lit = vColor.a < 0.0 ? 1.0 : 1.0;
    vec3 light = uAmbient + uSun * (0.35 + 0.35 * vUv.y);
    vec3 col = vColor.rgb * light;
    col = applyWorldFog(col, vWorld);
    gl_FragColor = vec4(col, a);
  }
`;

class BillboardPool {
  particles: Particle[] = [];
  mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private aPos: THREE.InstancedBufferAttribute;
  private aCol: THREE.InstancedBufferAttribute;
  private aMisc: THREE.InstancedBufferAttribute;
  private aVel: THREE.InstancedBufferAttribute;
  private cursor = 0;
  count = 0;

  constructor(public capacity: number, material: THREE.ShaderMaterial) {
    this.geo = new THREE.InstancedBufferGeometry();
    const quad = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]);
    this.geo.setAttribute('position', new THREE.BufferAttribute(quad, 3));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.aMisc = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    for (const a of [this.aPos, this.aCol, this.aMisc, this.aVel]) a.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iPos', this.aPos);
    this.geo.setAttribute('iColor', this.aCol);
    this.geo.setAttribute('iMisc', this.aMisc);
    this.geo.setAttribute('iVel', this.aVel);
    this.geo.instanceCount = 0;
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < capacity; i++) this.particles.push(newParticle());
  }

  spawn(): Particle {
    for (let k = 0; k < this.capacity; k++) {
      const i = (this.cursor + k) % this.capacity;
      if (!this.particles[i].alive) {
        this.cursor = (i + 1) % this.capacity;
        const p = this.particles[i];
        p.alive = true;
        return p;
      }
    }
    // Overwrite oldest-ish
    const p = this.particles[this.cursor];
    this.cursor = (this.cursor + 1) % this.capacity;
    p.alive = true;
    return p;
  }

  update(dt: number, sort?: THREE.Vector3) {
    let n = 0;
    const pos = this.aPos.array as Float32Array;
    const col = this.aCol.array as Float32Array;
    const misc = this.aMisc.array as Float32Array;
    const vel = this.aVel.array as Float32Array;
    const list = this.particles;
    const order: Particle[] = [];
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p.alive) continue;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.alive = false;
        continue;
      }
      const drag = Math.exp(-p.drag * dt);
      p.vx *= drag;
      p.vy = p.vy * drag - p.gravity * dt;
      p.vz *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < p.groundY) {
        p.y = p.groundY;
        p.vy = Math.abs(p.vy) * 0.3;
        p.vx *= 0.6;
        p.vz *= 0.6;
      }
      p.rot += p.spin * dt;
      order.push(p);
    }
    if (sort) {
      // back-to-front for alpha blending
      const cx = sort.x,
        cy = sort.y,
        cz = sort.z;
      order.sort((a, b) => (b.x - cx) ** 2 + (b.y - cy) ** 2 + (b.z - cz) ** 2 - ((a.x - cx) ** 2 + (a.y - cy) ** 2 + (a.z - cz) ** 2));
    }
    for (const p of order) {
      const t = p.life / p.maxLife;
      pos[n * 3] = p.x;
      pos[n * 3 + 1] = p.y;
      pos[n * 3 + 2] = p.z;
      col[n * 4] = lerp(p.r0, p.r1, t);
      col[n * 4 + 1] = lerp(p.g0, p.g1, t);
      col[n * 4 + 2] = lerp(p.b0, p.b1, t);
      // alpha: quick fade in, fade to a1
      const fadeIn = clamp01(t * 8);
      col[n * 4 + 3] = lerp(p.a0, p.a1, t) * fadeIn;
      misc[n * 4] = lerp(p.size0, p.size1, Math.sqrt(t));
      misc[n * 4 + 1] = p.rot;
      misc[n * 4 + 2] = p.stretch;
      misc[n * 4 + 3] = p.frame;
      vel[n * 3] = p.vx;
      vel[n * 3 + 1] = p.vy;
      vel[n * 3 + 2] = p.vz;
      n++;
    }
    this.count = n;
    this.geo.instanceCount = n;
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aMisc.needsUpdate = true;
    this.aVel.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- beams
const BEAM_VERT = /* glsl */ `
  attribute vec3 iA;
  attribute vec3 iB;
  attribute vec4 iColor;
  attribute float iWidth;
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    vec3 p = mix(iA, iB, position.x);
    vec3 d = normalize(iB - iA);
    vec3 toCam = normalize(cameraPosition - p);
    vec3 side = normalize(cross(d, toCam));
    p += side * position.y * iWidth;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    vUv = vec2(position.x, position.y + 0.5);
    vColor = iColor;
  }
`;
const BEAM_FRAG = /* glsl */ `
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    float d = abs(vUv.y - 0.5) * 2.0;
    float core = smoothstep(1.0, 0.0, d);
    float hot = smoothstep(0.35, 0.0, d);
    vec3 col = vColor.rgb * core + vec3(1.0) * hot * 0.8;
    gl_FragColor = vec4(col * vColor.a, 1.0);
  }
`;

interface Beam {
  a: THREE.Vector3;
  b: THREE.Vector3;
  color: THREE.Color;
  width: number;
  life: number;
  maxLife: number;
  alive: boolean;
}

class BeamPool {
  mesh: THREE.Mesh;
  beams: Beam[] = [];
  private geo: THREE.InstancedBufferGeometry;
  private aA: THREE.InstancedBufferAttribute;
  private aB: THREE.InstancedBufferAttribute;
  private aC: THREE.InstancedBufferAttribute;
  private aW: THREE.InstancedBufferAttribute;
  constructor(private cap: number) {
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -0.5, 0, 1, -0.5, 0, 1, 0.5, 0, 0, 0.5, 0]), 3));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.aA = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.aB = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.aC = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.aW = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    this.geo.setAttribute('iA', this.aA);
    this.geo.setAttribute('iB', this.aB);
    this.geo.setAttribute('iColor', this.aC);
    this.geo.setAttribute('iWidth', this.aW);
    const mat = new THREE.ShaderMaterial({
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < cap; i++) this.beams.push({ a: new THREE.Vector3(), b: new THREE.Vector3(), color: new THREE.Color(), width: 0.1, life: 0, maxLife: 0.1, alive: false });
  }
  add(a: THREE.Vector3, b: THREE.Vector3, color: THREE.Color, width: number, life: number) {
    const beam = this.beams.find((x) => !x.alive) ?? this.beams[0];
    beam.a.copy(a);
    beam.b.copy(b);
    beam.color.copy(color);
    beam.width = width;
    beam.life = 0;
    beam.maxLife = life;
    beam.alive = true;
  }
  update(dt: number) {
    let n = 0;
    const A = this.aA.array as Float32Array;
    const B = this.aB.array as Float32Array;
    const C = this.aC.array as Float32Array;
    const W = this.aW.array as Float32Array;
    for (const b of this.beams) {
      if (!b.alive) continue;
      b.life += dt;
      if (b.life > b.maxLife) {
        b.alive = false;
        continue;
      }
      const t = 1 - b.life / b.maxLife;
      A.set([b.a.x, b.a.y, b.a.z], n * 3);
      B.set([b.b.x, b.b.y, b.b.z], n * 3);
      C.set([b.color.r, b.color.g, b.color.b, t], n * 4);
      W[n] = b.width * (0.4 + 0.6 * t);
      n++;
    }
    this.geo.instanceCount = n;
    this.aA.needsUpdate = this.aB.needsUpdate = this.aC.needsUpdate = this.aW.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- chunks (cheap debris)
interface Chunk {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  scale: number;
  life: number;
  maxLife: number;
  ground: (x: number, z: number) => number;
  resting: boolean;
}

class ChunkPool {
  mesh: THREE.InstancedMesh;
  chunks: Chunk[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  constructor(cap: number, material: THREE.Material, geo: THREE.BufferGeometry) {
    this.mesh = new THREE.InstancedMesh(geo, material, cap);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < cap; i++)
      this.chunks.push({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(), scale: 1, life: 0, maxLife: 1, ground: () => 0, resting: false });
  }
  spawn(pos: THREE.Vector3, vel: THREE.Vector3, scale: number, life: number, ground: (x: number, z: number) => number) {
    const c = this.chunks.find((x) => !x.alive) ?? this.chunks[Math.floor(rand() * this.chunks.length)];
    c.alive = true;
    c.pos.copy(pos);
    c.vel.copy(vel);
    c.rot.set(rand() * 6, rand() * 6, rand() * 6);
    c.spin.set(randRange(-12, 12), randRange(-12, 12), randRange(-12, 12));
    c.scale = scale;
    c.life = 0;
    c.maxLife = life;
    c.ground = ground;
    c.resting = false;
  }
  update(dt: number, gravity: number) {
    let n = 0;
    for (const c of this.chunks) {
      if (!c.alive) continue;
      c.life += dt;
      if (c.life > c.maxLife) {
        c.alive = false;
        continue;
      }
      if (!c.resting) {
        c.vel.y -= gravity * dt;
        c.pos.addScaledVector(c.vel, dt);
        c.rot.x += c.spin.x * dt;
        c.rot.y += c.spin.y * dt;
        c.rot.z += c.spin.z * dt;
        const gy = c.ground(c.pos.x, c.pos.z) + c.scale * 0.3;
        if (c.pos.y < gy) {
          c.pos.y = gy;
          if (Math.abs(c.vel.y) < 1.5) {
            c.resting = true;
          } else {
            c.vel.y = Math.abs(c.vel.y) * 0.35;
            c.vel.x *= 0.5;
            c.vel.z *= 0.5;
            c.spin.multiplyScalar(0.5);
          }
        }
      }
      const shrink = c.life > c.maxLife - 1 ? c.maxLife - c.life : 1;
      this.q.setFromEuler(c.rot);
      this.s.setScalar(c.scale * shrink);
      this.m.compose(c.pos, this.q, this.s);
      this.mesh.setMatrixAt(n++, this.m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- scorch decals
class ScorchPool {
  mesh: THREE.InstancedMesh;
  private i = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  constructor(cap: number) {
    const tex = makeRadialSprite(128, 0.35);
    const mat = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: tex, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }
  add(pos: THREE.Vector3, normal: THREE.Vector3, size: number) {
    this.q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6.28);
    this.q.multiply(spin);
    this.m.compose(pos.clone().addScaledVector(normal, 0.05), this.q, new THREE.Vector3(size, size, size));
    this.mesh.setMatrixAt(this.i, this.m);
    this.i = (this.i + 1) % this.mesh.instanceMatrix.count;
    this.mesh.count = Math.min(this.mesh.instanceMatrix.count, Math.max(this.mesh.count, this.i));
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- flash lights
interface Flash {
  light: THREE.PointLight;
  life: number;
  maxLife: number;
  intensity: number;
  priority: number;
}

export type SurfaceKind = 'metal' | 'dirt' | 'sand' | 'rock' | 'asphalt' | 'ricochet' | 'energy';

export class FX {
  group = new THREE.Group();
  add: BillboardPool;
  smokePool: BillboardPool;
  beams: BeamPool;
  chunks: ChunkPool;
  rockChunks: ChunkPool;
  scorch: ScorchPool;
  flashes: Flash[] = [];
  smokeMat: THREE.ShaderMaterial;
  quality = 1;
  ground: (x: number, z: number) => number = () => 0;
  private tmp = new THREE.Vector3();

  constructor() {
    const spark = makeRadialSprite(64, 0.15);
    const addMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG_ADD,
      uniforms: {
        uTex: { value: spark },
        uFogSunDir: G.sunDir,
        uFogColor: G.fogColor,
        uFogSunColor: G.fogSunColor,
        uFogDensity: G.fogDensity,
        uFogFalloff: G.fogHeightFalloff,
        uFogBase: G.fogBase,
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.smokeMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG_SMOKE,
      uniforms: {
        uTex: { value: makeSmokeAtlas() },
        uAmbient: { value: new THREE.Color(0.5, 0.5, 0.5) },
        uSun: { value: new THREE.Color(0.5, 0.5, 0.5) },
        uFogSunDir: G.sunDir,
        uFogColor: G.fogColor,
        uFogSunColor: G.fogSunColor,
        uFogDensity: G.fogDensity,
        uFogFalloff: G.fogHeightFalloff,
        uFogBase: G.fogBase,
      },
      transparent: true,
      depthWrite: false,
    });
    this.add = new BillboardPool(5000, addMat);
    this.smokePool = new BillboardPool(3500, this.smokeMat);
    this.add.mesh.renderOrder = 10;
    this.smokePool.mesh.renderOrder = 9;
    this.beams = new BeamPool(96);
    this.beams.mesh.renderOrder = 11;
    const metal = new THREE.MeshStandardMaterial({ color: 0x3a3634, metalness: 0.7, roughness: 0.5 });
    const chunkGeo = new THREE.BoxGeometry(0.16, 0.05, 0.12);
    this.chunks = new ChunkPool(500, metal, chunkGeo);
    const rock = new THREE.MeshStandardMaterial({ color: 0x6d5645, roughness: 0.95 });
    this.rockChunks = new ChunkPool(500, rock, new THREE.IcosahedronGeometry(0.1, 0));
    this.scorch = new ScorchPool(96);
    this.group.add(this.smokePool.mesh, this.add.mesh, this.beams.mesh, this.chunks.mesh, this.rockChunks.mesh, this.scorch.mesh);
    // Lights stay "visible" permanently (intensity 0 when idle) so the shader light count never changes.
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 30, 2);
      this.group.add(l);
      this.flashes.push({ light: l, life: 0, maxLife: 0.1, intensity: 0, priority: 0 });
    }
  }

  private q(n: number) {
    return Math.max(1, Math.round(n * this.quality));
  }

  flash(pos: THREE.Vector3, color: number, intensity: number, range: number, life: number, priority = 1) {
    let slot = this.flashes.find((f) => f.life >= f.maxLife);
    if (!slot) {
      slot = this.flashes.reduce((a, b) => (a.priority * (1 - a.life / a.maxLife) < b.priority * (1 - b.life / b.maxLife) ? a : b));
      if (slot.priority > priority && slot.life < slot.maxLife * 0.5) return;
    }
    slot.light.position.copy(pos);
    slot.light.color.setHex(color);
    slot.light.distance = range;
    slot.intensity = intensity;
    slot.light.intensity = intensity;
    slot.life = 0;
    slot.maxLife = life;
    slot.priority = priority;
  }

  sparks(pos: THREE.Vector3, dir: THREE.Vector3, count: number, speed = 12, spread = 0.6, color = [1, 0.7, 0.3]) {
    for (let i = 0; i < this.q(count); i++) {
      const p = this.add.spawn();
      const s = speed * randRange(0.4, 1.2);
      p.x = pos.x;
      p.y = pos.y;
      p.z = pos.z;
      p.vx = (dir.x + randRange(-spread, spread)) * s;
      p.vy = (dir.y + randRange(-spread, spread) + 0.3) * s;
      p.vz = (dir.z + randRange(-spread, spread)) * s;
      p.life = 0;
      p.maxLife = randRange(0.25, 0.7);
      p.size0 = randRange(0.03, 0.06);
      p.size1 = 0.01;
      p.r0 = color[0] * 4;
      p.g0 = color[1] * 4;
      p.b0 = color[2] * 4;
      p.r1 = color[0] * 2;
      p.g1 = color[1] * 0.6;
      p.b1 = 0.1;
      p.a0 = 1;
      p.a1 = 0.2;
      p.drag = 1.2;
      p.gravity = 14;
      p.stretch = 0.03;
      p.rot = 0;
      p.spin = 0;
      p.groundY = this.ground(pos.x, pos.z);
    }
  }

  glow(pos: THREE.Vector3, size: number, color: [number, number, number], life: number, vel?: THREE.Vector3) {
    const p = this.add.spawn();
    p.x = pos.x;
    p.y = pos.y;
    p.z = pos.z;
    p.vx = vel?.x ?? 0;
    p.vy = vel?.y ?? 0;
    p.vz = vel?.z ?? 0;
    p.life = 0;
    p.maxLife = life;
    p.size0 = size;
    p.size1 = size * 0.6;
    p.r0 = color[0];
    p.g0 = color[1];
    p.b0 = color[2];
    p.r1 = color[0] * 0.5;
    p.g1 = color[1] * 0.3;
    p.b1 = color[2] * 0.2;
    p.a0 = 1;
    p.a1 = 0;
    p.drag = 2;
    p.gravity = 0;
    p.stretch = 0;
    p.rot = rand() * 6.28;
    p.spin = 0;
    p.groundY = -1e9;
  }

  smoke(pos: THREE.Vector3, vel: THREE.Vector3, size: number, life: number, color: [number, number, number], opacity = 0.6, growth = 3) {
    const p = this.smokePool.spawn();
    p.x = pos.x;
    p.y = pos.y;
    p.z = pos.z;
    p.vx = vel.x;
    p.vy = vel.y;
    p.vz = vel.z;
    p.life = 0;
    p.maxLife = life;
    p.size0 = size;
    p.size1 = size * growth;
    p.r0 = color[0];
    p.g0 = color[1];
    p.b0 = color[2];
    p.r1 = color[0] * 1.1;
    p.g1 = color[1] * 1.1;
    p.b1 = color[2] * 1.1;
    p.a0 = opacity;
    p.a1 = 0;
    p.drag = 1.0;
    p.gravity = -0.6;
    p.stretch = 0;
    p.rot = rand() * 6.28;
    p.spin = randRange(-0.6, 0.6);
    p.frame = Math.floor(rand() * 16);
    p.groundY = -1e9;
  }

  fire(pos: THREE.Vector3, size: number, vel?: THREE.Vector3) {
    const p = this.add.spawn();
    p.x = pos.x + randRange(-size, size) * 0.3;
    p.y = pos.y;
    p.z = pos.z + randRange(-size, size) * 0.3;
    p.vx = (vel?.x ?? 0) + randRange(-0.5, 0.5);
    p.vy = (vel?.y ?? 0) + randRange(1.5, 3.5);
    p.vz = (vel?.z ?? 0) + randRange(-0.5, 0.5);
    p.life = 0;
    p.maxLife = randRange(0.35, 0.7);
    p.size0 = size * randRange(0.7, 1.1);
    p.size1 = size * 0.3;
    p.r0 = 3.2;
    p.g0 = 1.4;
    p.b0 = 0.35;
    p.r1 = 1.2;
    p.g1 = 0.15;
    p.b1 = 0.02;
    p.a0 = 0.9;
    p.a1 = 0;
    p.drag = 1.5;
    p.gravity = -2;
    p.stretch = 0;
    p.rot = rand() * 6.28;
    p.spin = randRange(-2, 2);
    p.groundY = -1e9;
  }

  muzzleFlash(pos: THREE.Vector3, dir: THREE.Vector3, size: number, color: [number, number, number] = [4, 2.4, 1.0]) {
    this.glow(pos, size * 1.4, color, 0.05);
    for (let i = 0; i < 3; i++) {
      const p = this.add.spawn();
      const s = randRange(8, 18) * size;
      p.x = pos.x;
      p.y = pos.y;
      p.z = pos.z;
      p.vx = dir.x * s + randRange(-1, 1);
      p.vy = dir.y * s + randRange(-1, 1);
      p.vz = dir.z * s + randRange(-1, 1);
      p.life = 0;
      p.maxLife = 0.06;
      p.size0 = size * 0.6;
      p.size1 = size * 0.2;
      p.r0 = color[0];
      p.g0 = color[1];
      p.b0 = color[2];
      p.r1 = color[0] * 0.5;
      p.g1 = color[1] * 0.3;
      p.b1 = 0;
      p.a0 = 1;
      p.a1 = 0;
      p.drag = 8;
      p.gravity = 0;
      p.stretch = 0.05;
      p.rot = 0;
      p.spin = 0;
      p.groundY = -1e9;
    }
    this.smoke(pos.clone().addScaledVector(dir, size), dir.clone().multiplyScalar(3), size * 0.5, 0.8, [0.55, 0.53, 0.5], 0.25, 3);
  }

  tracer(from: THREE.Vector3, vel: THREE.Vector3, color: [number, number, number], size = 0.06) {
    const p = this.add.spawn();
    p.x = from.x;
    p.y = from.y;
    p.z = from.z;
    p.vx = vel.x;
    p.vy = vel.y;
    p.vz = vel.z;
    p.life = 0;
    p.maxLife = 0.035;
    p.size0 = size;
    p.size1 = size;
    p.r0 = color[0];
    p.g0 = color[1];
    p.b0 = color[2];
    p.r1 = color[0];
    p.g1 = color[1];
    p.b1 = color[2];
    p.a0 = 1;
    p.a1 = 1;
    p.drag = 0;
    p.gravity = 0;
    p.stretch = 0.035;
    p.rot = 0;
    p.spin = 0;
    p.groundY = -1e9;
  }

  dust(pos: THREE.Vector3, amount: number, color: [number, number, number] = [0.62, 0.5, 0.38], vel?: THREE.Vector3, size = 1) {
    for (let i = 0; i < this.q(amount); i++) {
      const v = this.tmp.set(randRange(-1.5, 1.5), randRange(0.5, 2), randRange(-1.5, 1.5));
      if (vel) v.add(vel);
      this.smoke(pos, v, size * randRange(0.6, 1.2), randRange(1.2, 2.8), color, 0.35, 3.5);
    }
  }

  impact(pos: THREE.Vector3, normal: THREE.Vector3, kind: SurfaceKind, scale = 1) {
    switch (kind) {
      case 'metal':
        this.sparks(pos, normal, 10 * scale, 10, 0.7);
        this.glow(pos, 0.35 * scale, [3, 2, 1], 0.06);
        this.smoke(pos, normal.clone().multiplyScalar(1.5), 0.25 * scale, 0.9, [0.4, 0.38, 0.36], 0.35, 3);
        break;
      case 'ricochet':
        this.sparks(pos, normal, 16 * scale, 18, 0.35, [1, 0.85, 0.5]);
        this.glow(pos, 0.3 * scale, [3, 2.6, 2], 0.05);
        break;
      case 'energy':
        this.sparks(pos, normal, 8 * scale, 8, 0.8, [0.4, 0.8, 1]);
        this.glow(pos, 0.5 * scale, [1, 2.2, 3.5], 0.1);
        this.smoke(pos, normal.clone().multiplyScalar(1), 0.2, 0.7, [0.3, 0.3, 0.3], 0.3, 3);
        break;
      default: {
        const col: [number, number, number] =
          kind === 'sand' ? [0.72, 0.58, 0.42] : kind === 'rock' ? [0.55, 0.45, 0.38] : kind === 'asphalt' ? [0.35, 0.34, 0.33] : [0.52, 0.42, 0.32];
        for (let i = 0; i < this.q(3 * scale); i++) {
          const v = normal.clone().multiplyScalar(randRange(2, 6)).add(new THREE.Vector3(randRange(-1.5, 1.5), randRange(0, 2), randRange(-1.5, 1.5)));
          this.smoke(pos, v, 0.3 * scale, randRange(0.8, 1.6), col, 0.5, 3.5);
        }
        for (let i = 0; i < this.q(2 * scale); i++) {
          const v = normal.clone().multiplyScalar(randRange(3, 7)).add(new THREE.Vector3(randRange(-2, 2), randRange(1, 3), randRange(-2, 2)));
          this.rockChunks.spawn(pos, v, randRange(0.3, 0.7) * scale, randRange(2, 4), this.ground);
        }
      }
    }
  }

  explosion(pos: THREE.Vector3, size: number, opts: { smoke?: boolean; debris?: boolean; scorch?: boolean } = {}) {
    const s = size;
    this.flash(pos, 0xffa050, 60 * s, 18 * s, 0.35, 3);
    this.glow(pos, 3.5 * s, [6, 3.5, 1.5], 0.12);
    // fireball
    for (let i = 0; i < this.q(14 * s); i++) {
      const v = new THREE.Vector3(randRange(-1, 1), randRange(-0.2, 1), randRange(-1, 1)).normalize().multiplyScalar(randRange(2, 7) * s);
      const p = this.add.spawn();
      p.x = pos.x;
      p.y = pos.y;
      p.z = pos.z;
      p.vx = v.x;
      p.vy = v.y;
      p.vz = v.z;
      p.life = 0;
      p.maxLife = randRange(0.4, 0.9);
      p.size0 = randRange(0.8, 1.6) * s;
      p.size1 = randRange(1.5, 2.5) * s;
      p.r0 = 4;
      p.g0 = 2.0;
      p.b0 = 0.6;
      p.r1 = 0.8;
      p.g1 = 0.12;
      p.b1 = 0.02;
      p.a0 = 1;
      p.a1 = 0;
      p.drag = 3;
      p.gravity = -2;
      p.stretch = 0;
      p.rot = rand() * 6.28;
      p.spin = randRange(-1, 1);
      p.groundY = -1e9;
    }
    this.sparks(pos, new THREE.Vector3(0, 1, 0), 30 * s, 20 * s, 1.0);
    if (opts.smoke !== false) {
      for (let i = 0; i < this.q(10 * s); i++) {
        const v = new THREE.Vector3(randRange(-1, 1), randRange(0.3, 1.2), randRange(-1, 1)).multiplyScalar(randRange(1, 4) * s);
        this.smoke(pos, v, randRange(0.8, 1.4) * s, randRange(2.5, 5), [0.16, 0.15, 0.14], 0.75, 3.2);
      }
    }
    if (opts.debris !== false) {
      for (let i = 0; i < this.q(10 * s); i++) {
        const v = new THREE.Vector3(randRange(-1, 1), randRange(0.5, 1.5), randRange(-1, 1)).multiplyScalar(randRange(5, 14) * Math.sqrt(s));
        this.chunks.spawn(pos, v, randRange(0.6, 1.4) * Math.min(2, s), randRange(4, 8), this.ground);
      }
    }
    const gy = this.ground(pos.x, pos.z);
    if (opts.scorch !== false && pos.y - gy < 2.5 * s) {
      this.scorch.add(new THREE.Vector3(pos.x, gy, pos.z), new THREE.Vector3(0, 1, 0), 3.5 * s);
      this.dust(new THREE.Vector3(pos.x, gy + 0.3, pos.z), 6 * s, [0.55, 0.45, 0.35], undefined, 1.2 * s);
    }
  }

  update(dt: number, camPos: THREE.Vector3, ambient: THREE.Color, sun: THREE.Color) {
    this.add.update(dt);
    this.smokePool.update(dt, camPos);
    this.beams.update(dt);
    this.chunks.update(dt, 12);
    this.rockChunks.update(dt, 12);
    const u = this.smokeMat.uniforms;
    u.uAmbient.value.copy(ambient);
    u.uSun.value.copy(sun);
    for (const f of this.flashes) {
      if (f.life >= f.maxLife) {
        f.light.intensity = 0;
        continue;
      }
      f.life += dt;
      const t = Math.max(0, 1 - f.life / f.maxLife);
      f.light.intensity = f.intensity * t * t;
    }
  }
}

import * as THREE from 'three';
import { G } from './globals';
import { clamp01, lerp, smoothstep } from '../core/math';

/** Colour keyframes keyed by sun elevation (sin of altitude). */
interface SkyKey {
  e: number;
  zenith: THREE.Color;
  horizon: THREE.Color;
  sun: THREE.Color;
  sunI: number;
  amb: THREE.Color;
  ambI: number;
  fog: THREE.Color;
  fogSun: THREE.Color;
}
const C = (h: string) => new THREE.Color(h);
const KEYS: SkyKey[] = [
  { e: -1.0, zenith: C('#02040b'), horizon: C('#070b17'), sun: C('#7f9cd6'), sunI: 0.35, amb: C('#1f2c4a'), ambI: 0.28, fog: C('#0a0f1c'), fogSun: C('#131b30') },
  { e: -0.18, zenith: C('#03060f'), horizon: C('#0c1427'), sun: C('#8aa6dd'), sunI: 0.35, amb: C('#243357'), ambI: 0.3, fog: C('#0d1424'), fogSun: C('#1a2440') },
  { e: -0.06, zenith: C('#101a38'), horizon: C('#4a3350'), sun: C('#ff7a4a'), sunI: 0.2, amb: C('#3a3a5c'), ambI: 0.35, fog: C('#2e2a3f'), fogSun: C('#6b3d3a') },
  { e: 0.0, zenith: C('#243a6a'), horizon: C('#e0784a'), sun: C('#ff7b3a'), sunI: 1.3, amb: C('#6d5a6e'), ambI: 0.45, fog: C('#9a6a5a'), fogSun: C('#ff9a55') },
  { e: 0.08, zenith: C('#2f5288'), horizon: C('#f09a60'), sun: C('#ffa060'), sunI: 2.0, amb: C('#8a7a80'), ambI: 0.42, fog: C('#c09078'), fogSun: C('#ffb070') },
  { e: 0.22, zenith: C('#3469aa'), horizon: C('#e6c29a'), sun: C('#ffd6a8'), sunI: 2.5, amb: C('#9aa4b4'), ambI: 0.48, fog: C('#bdb4a6'), fogSun: C('#ffd9a8') },
  { e: 0.5, zenith: C('#2b67b5'), horizon: C('#cfd5d6'), sun: C('#fff1dc'), sunI: 2.8, amb: C('#a9b8cc'), ambI: 0.5, fog: C('#b9c2c8'), fogSun: C('#fff0d6') },
  { e: 1.0, zenith: C('#2360b2'), horizon: C('#c8d3da'), sun: C('#fff6ea'), sunI: 2.9, amb: C('#b0c0d4'), ambI: 0.52, fog: C('#b4bec6'), fogSun: C('#fff4e0') },
];

export interface AtmosphereState {
  sunDir: THREE.Vector3;
  moonDir: THREE.Vector3;
  lightDir: THREE.Vector3; // whichever of sun/moon is lighting
  zenith: THREE.Color;
  horizon: THREE.Color;
  lightColor: THREE.Color;
  lightIntensity: number;
  ambient: THREE.Color;
  ambientIntensity: number;
  fog: THREE.Color;
  fogSun: THREE.Color;
  night: number; // 0 day .. 1 full night
  sunElevation: number;
  exposure: number;
}

const _a = new THREE.Color();
function sample(e: number, out: AtmosphereState) {
  let i = 0;
  while (i < KEYS.length - 2 && e > KEYS[i + 1].e) i++;
  const k0 = KEYS[i];
  const k1 = KEYS[i + 1];
  const t = clamp01((e - k0.e) / (k1.e - k0.e));
  out.zenith.copy(k0.zenith).lerp(k1.zenith, t);
  out.horizon.copy(k0.horizon).lerp(k1.horizon, t);
  out.lightColor.copy(k0.sun).lerp(k1.sun, t);
  out.lightIntensity = lerp(k0.sunI, k1.sunI, t);
  out.ambient.copy(k0.amb).lerp(k1.amb, t);
  out.ambientIntensity = lerp(k0.ambI, k1.ambI, t);
  out.fog.copy(k0.fog).lerp(k1.fog, t);
  out.fogSun.copy(k0.fogSun).lerp(k1.fogSun, t);
}

export function computeAtmosphere(dayFraction: number, overcast: number, dust: number, out?: AtmosphereState): AtmosphereState {
  const st: AtmosphereState = out ?? {
    sunDir: new THREE.Vector3(),
    moonDir: new THREE.Vector3(),
    lightDir: new THREE.Vector3(),
    zenith: new THREE.Color(),
    horizon: new THREE.Color(),
    lightColor: new THREE.Color(),
    lightIntensity: 1,
    ambient: new THREE.Color(),
    ambientIntensity: 1,
    fog: new THREE.Color(),
    fogSun: new THREE.Color(),
    night: 0,
    sunElevation: 0,
    exposure: 1,
  };
  // Sun path: rises in the east (+X), sets in the west (-X), tilted toward the south (+Z).
  const ang = (dayFraction - 0.25) * Math.PI * 2;
  const elev = Math.sin(ang);
  const sx = Math.cos(ang);
  st.sunDir.set(sx * 0.92, elev * 0.88, 0.38).normalize();
  st.moonDir.set(-sx * 0.8, -elev * 0.85 + 0.15, -0.3).normalize();
  st.sunElevation = st.sunDir.y;
  sample(st.sunDir.y, st);
  st.night = 1 - smoothstep(-0.14, 0.02, st.sunDir.y);
  if (st.sunDir.y > -0.06) {
    st.lightDir.copy(st.sunDir);
    if (st.sunDir.y < 0.02) st.lightDir.y = 0.02;
  } else {
    st.lightDir.copy(st.moonDir);
    if (st.lightDir.y < 0.15) st.lightDir.y = 0.15;
    st.lightDir.normalize();
  }
  // Fade light around the crossover so shadows don't pop.
  const cross = smoothstep(-0.06, 0.0, st.sunDir.y) + smoothstep(-0.06, -0.14, st.sunDir.y);
  st.lightIntensity *= lerp(0.15, 1, clamp01(cross));

  // Weather desaturates and flattens.
  const grey = _a.setRGB(0.55, 0.56, 0.58).multiplyScalar(lerp(1, 0.12, st.night));
  st.zenith.lerp(grey, overcast * 0.75);
  st.horizon.lerp(grey, overcast * 0.6);
  st.lightIntensity *= 1 - overcast * 0.72;
  st.ambientIntensity *= 1 + overcast * 0.25;
  const dustCol = _a.set('#b58a5c').multiplyScalar(lerp(1, 0.1, st.night));
  st.fog.lerp(dustCol, dust * 0.8);
  st.fogSun.lerp(dustCol, dust * 0.6);
  st.horizon.lerp(dustCol, dust * 0.7);
  st.zenith.lerp(dustCol, dust * 0.35);
  st.lightIntensity *= 1 - dust * 0.45;
  st.exposure = lerp(1.0, 1.55, st.night);
  return st;
}

/** Sky dome: gradient + sun/moon discs + procedural clouds + stars. */
export class Sky {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uGround: { value: new THREE.Color() },
        uSunDir: G.sunDir,
        uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
        uSunColor: { value: new THREE.Color() },
        uTime: G.time,
        uNight: { value: 0 },
        uCloudCover: { value: 0.35 },
        uOvercast: { value: 0 },
        uDust: { value: 0 },
        uFogSun: { value: new THREE.Color() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uZenith, uHorizon, uGround, uSunDir, uMoonDir, uSunColor, uFogSun;
        uniform float uTime, uNight, uCloudCover, uOvercast, uDust;
        varying vec3 vDir;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1,0)), u.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
        }
        float fbm(vec2 p) {
          float s = 0.0, a = 0.5;
        #ifdef SKY_LOW
          for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
          s += 0.09; // keep the mean of the dropped octaves so cloud cover matches
        #else
          for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
        #endif
          return s;
        }
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          float t = pow(clamp(h, 0.0, 1.0), 0.45);
          vec3 col = mix(uHorizon, uZenith, t);
          // Horizon glow toward the sun
          float sd = max(dot(d, uSunDir), 0.0);
          float horizonBand = exp(-abs(h) * 6.0);
          col += uFogSun * pow(sd, 6.0) * horizonBand * 0.55;
          col += uSunColor * pow(sd, 64.0) * 0.35;
          // Below horizon: fade to ground/fog colour
          col = mix(col, uGround, smoothstep(0.0, -0.08, h));
          // Stars
          if (uNight > 0.01 && h > 0.0) {
            vec3 sp = d * 180.0;
            vec3 cell = floor(sp);
            float r = hash3(cell);
            float star = step(0.9965, r);
            vec3 f = fract(sp) - 0.5;
            float tw = 0.6 + 0.4 * sin(uTime * (2.0 + r * 5.0) + r * 60.0);
            float s = star * smoothstep(0.35, 0.0, length(f)) * tw;
            // milky band
            float band = exp(-pow(dot(d, normalize(vec3(0.3, 0.2, 1.0))) * 3.2, 2.0));
            float neb = fbm(d.xz * 6.0 / (d.y + 0.3)) * band;
            col += (vec3(s) * 1.6 + vec3(0.18, 0.2, 0.32) * neb * 0.45) * uNight * smoothstep(0.0, 0.2, h) * (1.0 - uOvercast);
          }
          // Sun disc
          float sunDisc = smoothstep(0.9993, 0.99965, sd);
          col += uSunColor * sunDisc * 22.0 * (1.0 - uOvercast * 0.9) * (1.0 - uDust * 0.7);
          // Moon disc
          float md = max(dot(d, uMoonDir), 0.0);
          float moon = smoothstep(0.99955, 0.9998, md);
          col += vec3(0.8, 0.85, 1.0) * moon * 2.2 * uNight;
          col += vec3(0.25, 0.3, 0.45) * pow(md, 200.0) * 0.4 * uNight;
          // Clouds on a virtual plane
          if (h > 0.0) {
            vec2 uv = d.xz / (h + 0.12) * 1.3 + vec2(uTime * 0.004, uTime * 0.0015);
            float n = fbm(uv * 1.2);
            float cover = mix(uCloudCover, 0.95, uOvercast);
            float c = smoothstep(1.0 - cover, 1.0 - cover + 0.32, n);
            float light = 0.55 + 0.45 * fbm(uv * 1.2 + uSunDir.xz * 0.12);
            vec3 cloudCol = mix(uHorizon * 0.9, vec3(1.0), 0.45) * light;
            cloudCol += uFogSun * pow(sd, 3.0) * 0.8;
            cloudCol = mix(cloudCol, uZenith * 0.35, uNight * 0.8);
            col = mix(col, cloudCol, c * smoothstep(0.0, 0.18, h) * 0.9);
          }
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const geo = new THREE.SphereGeometry(4000, 48, 24);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.name = 'sky';
  }

  /** Cheaper cloud noise for budget GPUs. */
  setLight(on: boolean) {
    const defs = this.material.defines;
    if (on === ('SKY_LOW' in defs)) return;
    if (on) defs.SKY_LOW = '';
    else delete defs.SKY_LOW;
    this.material.needsUpdate = true;
  }

  update(atm: AtmosphereState, cameraPos: THREE.Vector3, overcast: number, dust: number, cloudCover: number) {
    const u = this.material.uniforms;
    u.uZenith.value.copy(atm.zenith);
    u.uHorizon.value.copy(atm.horizon);
    u.uGround.value.copy(atm.fog);
    u.uMoonDir.value.copy(atm.moonDir);
    u.uSunColor.value.copy(atm.lightColor).multiplyScalar(atm.night > 0.5 ? 0.4 : 1);
    if (atm.sunElevation < -0.05) u.uSunColor.value.setRGB(0, 0, 0);
    u.uNight.value = atm.night;
    u.uOvercast.value = overcast;
    u.uDust.value = dust;
    u.uCloudCover.value = cloudCover;
    u.uFogSun.value.copy(atm.fogSun);
    this.mesh.position.copy(cameraPos);
  }
}

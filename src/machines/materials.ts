import * as THREE from 'three';
import type { Slot } from './parts/kit';
import type { PaintPattern, PaintScheme, Rarity } from './types';
import { RARITY_COLOR } from './types';
import { extendMaterial } from '../render/globals';
import { getNoiseTexture } from '../render/textures';

const PATTERN_ID: Record<PaintPattern, number> = { none: 0, stripes: 1, camo: 2, hazard: 3, twotone: 4, digital: 5 };

interface SlotBase {
  color: string;
  metal: number;
  rough: number;
  mode: number; // 0 paint, 1 metal, 2 rubber, 3 hazard, 4 heat
  rustMul: number;
}

const SLOT_BASE: Partial<Record<Slot, SlotBase>> = {
  paint: { color: '#888', metal: 0.25, rough: 0.5, mode: 0, rustMul: 1 },
  paint2: { color: '#888', metal: 0.25, rough: 0.5, mode: 0, rustMul: 1 },
  white: { color: '#e6e7e4', metal: 0.15, rough: 0.35, mode: 0, rustMul: 0.15 },
  metal: { color: '#8b8e91', metal: 0.85, rough: 0.4, mode: 1, rustMul: 0.6 },
  dark: { color: '#2e2f31', metal: 0.7, rough: 0.48, mode: 1, rustMul: 0.5 },
  rust: { color: '#6a3b24', metal: 0.35, rough: 0.85, mode: 1, rustMul: 2.2 },
  rubber: { color: '#1d1c1b', metal: 0.0, rough: 0.92, mode: 2, rustMul: 0 },
  chrome: { color: '#d9d9d9', metal: 1.0, rough: 0.16, mode: 1, rustMul: 0.1 },
  hazard: { color: '#e2a91c', metal: 0.2, rough: 0.55, mode: 3, rustMul: 0.8 },
  copper: { color: '#b56f3e', metal: 0.9, rough: 0.35, mode: 1, rustMul: 0.3 },
  wood: { color: '#6f5236', metal: 0.0, rough: 0.82, mode: 2, rustMul: 0 },
  canvas: { color: '#6c654f', metal: 0.0, rough: 0.95, mode: 2, rustMul: 0 },
  heat: { color: '#3a3533', metal: 0.75, rough: 0.5, mode: 4, rustMul: 0.8 },
};

const noiseTex = () => getNoiseTexture();

function makeSurfaceMaterial(base: SlotBase, color: THREE.Color, shared: MachineUniforms, damage: number) {
  const mat = new THREE.MeshStandardMaterial({
    color,
    metalness: base.metal,
    roughness: base.rough,
  });
  const local = {
    uMode: { value: base.mode },
    uRustMul: { value: base.rustMul },
    uDamage: { value: damage },
  };
  extendMaterial(mat, `machine-surface`, (shader) => {
    Object.assign(shader.uniforms, shared, local, { uNoise: { value: noiseTex() } });
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform mat4 uRootInv;
        varying vec3 vMPos;
        varying vec3 vMNrm;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        {
          vec4 wp = modelMatrix * vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
          #endif
          vMPos = (uRootInv * wp).xyz;
          vMNrm = normalize(mat3(uRootInv) * mat3(modelMatrix) * objectNormal);
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D uNoise;
        uniform float uMode, uRustMul, uDamage, uWear, uPattern, uHeat, uDirt;
        uniform vec3 uPrimary, uSecondary, uAccent;
        varying vec3 vMPos;
        varying vec3 vMNrm;
        float mRough = 0.5;
        float mMetal = 0.5;
        vec4 triN(vec3 p, vec3 n, float s) {
          vec3 w = pow(abs(n), vec3(3.0)); w /= (w.x + w.y + w.z + 1e-5);
          return texture2D(uNoise, p.yz * s) * w.x + texture2D(uNoise, p.xz * s) * w.y + texture2D(uNoise, p.xy * s) * w.z;
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          vec3 p = vMPos;
          vec3 n = normalize(vMNrm);
          vec4 nz = triN(p, n, 0.35);
          vec4 nf = triN(p, n, 1.6);
          vec4 nxf = triN(p, n, 5.0);
          vec3 base = diffuseColor.rgb;
          mRough = roughness;
          mMetal = metalness;
          // ---- paint pattern ----
          if (uMode < 0.5) {
            if (uPattern > 0.5 && uPattern < 1.5) { // stripes along length
              float s = smoothstep(0.02, 0.0, abs(abs(p.x) - 0.16) - 0.07);
              base = mix(base, uSecondary, s);
            } else if (uPattern > 1.5 && uPattern < 2.5) { // camo
              float c1 = smoothstep(0.52, 0.56, nz.g + nz.a * 0.3 - 0.1);
              float c2 = smoothstep(0.6, 0.64, triN(p + 7.3, n, 0.5).g);
              base = mix(base, uSecondary, c1);
              base = mix(base, uAccent * 0.6 + base * 0.2, c2 * 0.85);
            } else if (uPattern > 2.5 && uPattern < 3.5) { // hazard chevrons on lower body
              float band = step(fract((p.x + p.y + p.z * 0.2) * 2.2), 0.5);
              float mask = smoothstep(0.35, 0.3, p.y + nz.r * 0.1);
              base = mix(base, mix(vec3(0.05), uSecondary, band), mask);
            } else if (uPattern > 3.5 && uPattern < 4.5) { // two tone
              base = mix(uSecondary, base, smoothstep(0.35, 0.4, p.y + nz.r * 0.02));
            } else if (uPattern > 4.5) { // digital
              vec3 q = floor(p * 5.0);
              float h = fract(sin(dot(q, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
              base = mix(base, uSecondary, step(0.62, h));
              base = mix(base, uAccent * 0.5, step(0.9, h));
            }
            // chipped paint -> bare metal scratches
            float chips = smoothstep(0.9 - uWear * 0.12, 0.96 - uWear * 0.12, nf.r + nxf.b * 0.2);
            float scratches = smoothstep(0.02, 0.0, abs(nxf.r - 0.5)) * smoothstep(0.55, 0.85, nf.g) * (0.2 + uWear * 0.5);
            float bare = clamp(chips * 0.8 + scratches * 0.6, 0.0, 1.0);
            base = mix(base, vec3(0.42, 0.42, 0.43), bare);
            mMetal = mix(mMetal, 0.85, bare);
            mRough = mix(mRough, 0.38, bare);
            // subtle panel shading variation
            base *= 0.92 + nz.g * 0.16;
          } else if (uMode > 2.5 && uMode < 3.5) { // hazard stripes
            float band = step(fract((p.x + p.y + p.z) * 3.0), 0.5);
            base = mix(vec3(0.04, 0.04, 0.035), base, band);
          } else if (uMode > 1.5 && uMode < 2.5) { // rubber/organic
            base *= 0.85 + nz.g * 0.3;
          } else { // metals
            base *= 0.86 + nf.g * 0.28;
            mRough = clamp(mRough + (nf.r - 0.5) * 0.25, 0.05, 1.0);
          }
          // ---- rust ----
          float streak = texture2D(uNoise, vec2(p.x * 1.3 + p.z * 0.7, p.y * 0.18)).g;
          float rustN = nz.a * 0.55 + nf.g * 0.3 + streak * 0.35;
          float rustAmt = smoothstep(1.12 - uWear * 0.42 * uRustMul, 1.3 - uWear * 0.42 * uRustMul, rustN + (0.3 - p.y) * 0.08);
          rustAmt = clamp(rustAmt * min(uRustMul, 1.5), 0.0, 1.0);
          vec3 rustCol = mix(vec3(0.34, 0.14, 0.06), vec3(0.58, 0.3, 0.12), nxf.g);
          base = mix(base, rustCol, rustAmt);
          mRough = mix(mRough, 0.9, rustAmt);
          mMetal = mix(mMetal, 0.25, rustAmt);
          // ---- dust / dirt (gathers low and on upward faces) ----
          float dirt = smoothstep(0.55, 1.0, nz.g + nf.r * 0.35) * uDirt;
          float low = smoothstep(0.6, -0.2, p.y);
          float up = smoothstep(0.5, 1.0, n.y);
          float dirtAmt = clamp(dirt * (low * 0.9 + up * 0.5) + low * uDirt * 0.25, 0.0, 0.85);
          base = mix(base, vec3(0.45, 0.36, 0.26), dirtAmt);
          mRough = mix(mRough, 0.95, dirtAmt);
          mMetal = mix(mMetal, 0.05, dirtAmt);
          // ---- battle damage ----
          if (uDamage > 0.01) {
            float scorch = smoothstep(0.75 - uDamage * 0.6, 0.95 - uDamage * 0.6, nz.r * 0.6 + nf.a * 0.5);
            base = mix(base, vec3(0.03, 0.025, 0.02), scorch * min(1.0, uDamage * 1.3));
            base *= 1.0 - uDamage * 0.35;
            mRough = mix(mRough, 1.0, scorch * uDamage);
            mMetal = mix(mMetal, 0.2, scorch * uDamage);
          }
          diffuseColor.rgb = base;
        }`,
      )
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = mRough;`)
      .replace('#include <metalnessmap_fragment>', `float metalnessFactor = mMetal;`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        if (uMode > 3.5) {
          float glow = smoothstep(0.35, 1.0, uHeat);
          totalEmissiveRadiance += vec3(1.0, 0.35, 0.08) * glow * glow * 3.0;
        }
        if (uDamage > 0.9) {
          float ember = smoothstep(0.8, 0.95, texture2D(uNoise, vMPos.xz * 1.3 + vec2(0.0, uHeat * 0.1)).r);
          totalEmissiveRadiance += vec3(1.0, 0.3, 0.05) * ember * 0.8;
        }`,
      );
  });
  return mat;
}

export interface MachineUniforms {
  uRootInv: { value: THREE.Matrix4 };
  uPrimary: { value: THREE.Color };
  uSecondary: { value: THREE.Color };
  uAccent: { value: THREE.Color };
  uWear: { value: number };
  uPattern: { value: number };
  uHeat: { value: number };
  uDirt: { value: number };
}

const rarityMats = new Map<Rarity, THREE.MeshStandardMaterial>();
export function getRarityMaterial(r: Rarity) {
  let m = rarityMats.get(r);
  if (!m) {
    const c = new THREE.Color(RARITY_COLOR[r]);
    m = new THREE.MeshStandardMaterial({ color: c.clone().multiplyScalar(0.3), emissive: c, emissiveIntensity: 2.4, roughness: 0.4 });
    rarityMats.set(r, m);
  }
  return m;
}

let glassMat: THREE.MeshStandardMaterial | null = null;
function getGlass() {
  if (!glassMat) {
    glassMat = new THREE.MeshStandardMaterial({ color: '#35505c', metalness: 0.25, roughness: 0.04, envMapIntensity: 2.2, transparent: true, opacity: 0.82 });
  }
  return glassMat;
}

/** Material set for one machine (paint colours, wear, heat, lights state). */
export class MachineMaterials {
  uniforms: MachineUniforms;
  private cache = new Map<string, THREE.Material>();
  lampMat: THREE.MeshStandardMaterial;
  glowMat: THREE.MeshStandardMaterial;

  constructor(paint: PaintScheme) {
    this.uniforms = {
      uRootInv: { value: new THREE.Matrix4() },
      uPrimary: { value: new THREE.Color(paint.primary) },
      uSecondary: { value: new THREE.Color(paint.secondary) },
      uAccent: { value: new THREE.Color(paint.accent) },
      uWear: { value: paint.wear },
      uPattern: { value: PATTERN_ID[paint.pattern] ?? 0 },
      uHeat: { value: 0 },
      uDirt: { value: 0.35 + paint.wear * 0.4 },
    };
    this.lampMat = new THREE.MeshStandardMaterial({ color: '#fff6dd', emissive: new THREE.Color('#fff1c9'), emissiveIntensity: 0.2, roughness: 0.1 });
    this.glowMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(paint.accent).multiplyScalar(0.3),
      emissive: new THREE.Color(paint.accent),
      emissiveIntensity: 2.2,
      roughness: 0.4,
    });
  }

  setPaint(paint: PaintScheme) {
    this.uniforms.uPrimary.value.set(paint.primary);
    this.uniforms.uSecondary.value.set(paint.secondary);
    this.uniforms.uAccent.value.set(paint.accent);
    this.uniforms.uWear.value = paint.wear;
    this.uniforms.uPattern.value = PATTERN_ID[paint.pattern] ?? 0;
    this.uniforms.uDirt.value = 0.35 + paint.wear * 0.4;
    this.glowMat.emissive.set(paint.accent);
    this.glowMat.color.set(paint.accent).multiplyScalar(0.3);
    for (const [key, mat] of this.cache) {
      const slot = key.split(':')[0] as Slot;
      if (slot === 'paint') (mat as THREE.MeshStandardMaterial).color.set(paint.primary);
      if (slot === 'paint2') (mat as THREE.MeshStandardMaterial).color.set(paint.secondary);
    }
  }

  get(slot: Slot, damageLevel = 0, rarity: Rarity = 'common'): THREE.Material {
    if (slot === 'glass') return getGlass();
    if (slot === 'rarity') return getRarityMaterial(rarity);
    if (slot === 'lamp') return this.lampMat;
    if (slot === 'glow') return this.glowMat;
    const key = `${slot}:${damageLevel}`;
    let m = this.cache.get(key);
    if (m) return m;
    const base = SLOT_BASE[slot] ?? SLOT_BASE.metal!;
    let color: THREE.Color;
    if (slot === 'paint') color = this.uniforms.uPrimary.value.clone();
    else if (slot === 'paint2') color = this.uniforms.uSecondary.value.clone();
    else color = new THREE.Color(base.color);
    const dmg = damageLevel === 0 ? 0 : damageLevel === 1 ? 0.45 : 1;
    m = makeSurfaceMaterial(base, color, this.uniforms, dmg);
    this.cache.set(key, m);
    return m;
  }

  setLights(on: boolean) {
    this.lampMat.emissiveIntensity = on ? 6 : 0.15;
  }

  dispose() {
    for (const m of this.cache.values()) m.dispose();
    this.lampMat.dispose();
    this.glowMat.dispose();
  }
}

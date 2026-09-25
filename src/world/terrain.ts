import * as THREE from 'three';
import { CELL, GRID, generateHeightfield, HeightfieldData, naturalHeight, sampleHeight, sampleSplat, Surface } from './heightfield';
import { HALF_WORLD, PLATEAU } from './layout';
import { extendMaterial, G } from '../render/globals';
import { getDetailNormalTexture, getNoiseTexture } from '../render/textures';
import { clamp } from '../core/math';

const CHUNK_CELLS = 64; // 128 m chunks
const LOD_STEPS = [1, 2, 4, 8];
const LOD_DIST = [0, 230, 520, 950];

export class Terrain {
  data!: HeightfieldData;
  aoShadow!: Uint8Array; // R: road distance, G: AO, B: far shadow, A: unused
  group = new THREE.Group();
  material!: THREE.MeshStandardMaterial;
  splatTex!: THREE.DataTexture;
  auxTex!: THREE.DataTexture;
  private splatScratch = [0, 0, 0, 0];

  generate(onProgress?: (p: number) => void) {
    this.data = generateHeightfield((p) => onProgress?.(p * 0.8));
    this.computeAux();
    onProgress?.(0.9);
  }

  heightAt(x: number, z: number) {
    if (Math.abs(x) > HALF_WORLD || Math.abs(z) > HALF_WORLD) return naturalHeight(x, z);
    return sampleHeight(this.data.heights, x, z);
  }

  normalAt(x: number, z: number, out = new THREE.Vector3()) {
    const e = 1.5;
    const hl = this.heightAt(x - e, z);
    const hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e);
    const hu = this.heightAt(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  /** Dominant surface at a point, used for tyre grip, foot sounds and dust colour. */
  surfaceAt(x: number, z: number): Surface {
    const s = sampleSplat(this.data.splat, x, z, this.splatScratch);
    if (s[0] > 0.5) return 'asphalt';
    if (s[1] > 0.5) return 'gravel';
    const ny = this.normalAt(x, z, _n).y;
    if (ny < 0.72) return 'rock';
    if (s[2] > 0.45) return 'sand';
    if (s[3] > 0.5) return 'packed';
    return 'dirt';
  }

  sandAmount(x: number, z: number) {
    return sampleSplat(this.data.splat, x, z, this.splatScratch)[2];
  }

  private computeAux() {
    const { heights, roadDist } = this.data;
    const aux = new Uint8Array(GRID * GRID * 4);
    const dirs = 8;
    const dists = [4, 12, 30];
    for (let iz = 0; iz < GRID; iz++) {
      for (let ix = 0; ix < GRID; ix++) {
        const idx = iz * GRID + ix;
        aux[idx * 4] = Math.round(clamp(roadDist[idx] / 12, 0, 1) * 255);
        aux[idx * 4 + 2] = 255;
        aux[idx * 4 + 3] = 255;
      }
    }
    // AO at half resolution then splat to full
    const step = 2;
    for (let iz = 0; iz < GRID; iz += step) {
      for (let ix = 0; ix < GRID; ix += step) {
        const h0 = heights[iz * GRID + ix];
        let occ = 0;
        for (let d = 0; d < dirs; d++) {
          const a = (d / dirs) * Math.PI * 2;
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          let maxSlope = 0;
          for (const dist of dists) {
            const sx = clamp(Math.round(ix + (ca * dist) / CELL), 0, GRID - 1);
            const sz = clamp(Math.round(iz + (sa * dist) / CELL), 0, GRID - 1);
            const dh = heights[sz * GRID + sx] - h0;
            const slope = dh / dist;
            if (slope > maxSlope) maxSlope = slope;
          }
          occ += Math.atan(maxSlope) / (Math.PI / 2);
        }
        occ /= dirs;
        const ao = Math.round(clamp(1 - occ * 1.6, 0.2, 1) * 255);
        for (let oz = 0; oz < step && iz + oz < GRID; oz++)
          for (let ox = 0; ox < step && ix + ox < GRID; ox++) aux[((iz + oz) * GRID + ix + ox) * 4 + 1] = ao;
      }
    }
    this.aoShadow = aux;
  }

  /** Recompute distant terrain shadows by marching the heightfield toward the light. */
  updateFarShadow(lightDir: THREE.Vector3, rows?: [number, number]) {
    const heights = this.data.heights;
    const aux = this.aoShadow;
    const L = new THREE.Vector3().copy(lightDir).normalize();
    const horiz = Math.hypot(L.x, L.z);
    const r0 = rows ? rows[0] : 0;
    const r1 = rows ? rows[1] : GRID;
    if (L.y <= 0.02 || horiz < 1e-3) {
      for (let iz = r0; iz < r1; iz++) for (let ix = 0; ix < GRID; ix++) aux[(iz * GRID + ix) * 4 + 2] = L.y <= 0.02 ? 60 : 255;
      return;
    }
    const stepLen = 6;
    const dx = (L.x / horiz) * stepLen;
    const dz = (L.z / horiz) * stepLen;
    const dy = (L.y / horiz) * stepLen;
    const maxSteps = 90;
    const sub = 2; // compute every 2nd vertex
    for (let iz = r0 - (r0 % sub); iz < r1; iz += sub) {
      for (let ix = 0; ix < GRID; ix += sub) {
        let x = -HALF_WORLD + ix * CELL;
        let z = -HALF_WORLD + iz * CELL;
        let y = heights[iz * GRID + ix] + 1.0;
        let lit = 1;
        for (let s = 0; s < maxSteps; s++) {
          x += dx;
          z += dz;
          y += dy;
          if (x < -HALF_WORLD || x > HALF_WORLD || z < -HALF_WORLD || z > HALF_WORLD) break;
          const h = sampleHeight(heights, x, z);
          if (h > y) {
            lit = Math.max(0, 1 - (h - y) / 3) * 0.3;
            if (h - y > 3) {
              lit = 0;
              break;
            }
          }
          if (y > 260) break;
        }
        const v = Math.round(lit * 255);
        for (let oz = 0; oz < sub && iz + oz < GRID; oz++)
          for (let ox = 0; ox < sub && ix + ox < GRID; ox++) aux[((iz + oz) * GRID + ix + ox) * 4 + 2] = v;
      }
    }
    if (this.auxTex) this.auxTex.needsUpdate = true;
  }

  buildMeshes(anisotropy = 8) {
    this.splatTex = new THREE.DataTexture(this.data.splat, GRID, GRID, THREE.RGBAFormat);
    this.splatTex.magFilter = THREE.LinearFilter;
    this.splatTex.minFilter = THREE.LinearFilter;
    this.splatTex.needsUpdate = true;
    this.auxTex = new THREE.DataTexture(this.aoShadow, GRID, GRID, THREE.RGBAFormat);
    this.auxTex.magFilter = THREE.LinearFilter;
    this.auxTex.minFilter = THREE.LinearFilter;
    this.auxTex.needsUpdate = true;
    const noiseT = getNoiseTexture();
    const detailN = getDetailNormalTexture();
    detailN.anisotropy = anisotropy;

    this.material = createTerrainMaterial(this.splatTex, this.auxTex, noiseT, detailN);

    const chunks = (GRID - 1) / CHUNK_CELLS;
    for (let cz = 0; cz < chunks; cz++) {
      for (let cx = 0; cx < chunks; cx++) {
        const lod = new THREE.LOD();
        for (let l = 0; l < LOD_STEPS.length; l++) {
          const geo = this.buildChunkGeometry(cx * CHUNK_CELLS, cz * CHUNK_CELLS, LOD_STEPS[l]);
          const mesh = new THREE.Mesh(geo, this.material);
          mesh.receiveShadow = true;
          mesh.castShadow = l <= 1;
          mesh.matrixAutoUpdate = false;
          lod.addLevel(mesh, LOD_DIST[l], 0.08);
        }
        lod.autoUpdate = true;
        lod.name = `terrain_${cx}_${cz}`;
        this.group.add(lod);
      }
    }
    this.group.add(this.buildBackdrop());
  }

  private buildChunkGeometry(ix0: number, iz0: number, step: number) {
    const n = CHUNK_CELLS / step + 1;
    const heights = this.data.heights;
    const vertCount = n * n + 4 * n; // + skirts
    const pos = new Float32Array(vertCount * 3);
    const nor = new Float32Array(vertCount * 3);
    const indices: number[] = [];
    const nrm = new THREE.Vector3();
    const hAt = (ix: number, iz: number) =>
      heights[clamp(iz, 0, GRID - 1) * GRID + clamp(ix, 0, GRID - 1)];
    let v = 0;
    const writeVert = (ix: number, iz: number, drop: number) => {
      const x = -HALF_WORLD + ix * CELL;
      const z = -HALF_WORLD + iz * CELL;
      const h = hAt(ix, iz);
      pos[v * 3] = x;
      pos[v * 3 + 1] = h - drop;
      pos[v * 3 + 2] = z;
      const s = step;
      nrm.set(hAt(ix - s, iz) - hAt(ix + s, iz), 2 * s * CELL, hAt(ix, iz - s) - hAt(ix, iz + s)).normalize();
      nor[v * 3] = nrm.x;
      nor[v * 3 + 1] = nrm.y;
      nor[v * 3 + 2] = nrm.z;
      return v++;
    };
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) writeVert(ix0 + i * step, iz0 + j * step, 0);
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        // diagonal b-c matches physics triangulation
        indices.push(a, c, b, b, c, d);
      }
    }
    // skirts
    const skirt = (edge: number[]) => {
      const start = v;
      for (const idx of edge) {
        const ix = ix0 + (idx % n) * step;
        const iz = iz0 + Math.floor(idx / n) * step;
        writeVert(ix, iz, 3 + step * 0.8);
      }
      for (let k = 0; k < edge.length - 1; k++) {
        const t0 = edge[k];
        const t1 = edge[k + 1];
        const s0 = start + k;
        const s1 = start + k + 1;
        indices.push(t0, s0, t1, t1, s0, s1);
        indices.push(t0, t1, s0, t1, s1, s0);
      }
    };
    const top = Array.from({ length: n }, (_, i) => i);
    const bottom = Array.from({ length: n }, (_, i) => (n - 1) * n + i);
    const left = Array.from({ length: n }, (_, j) => j * n);
    const right = Array.from({ length: n }, (_, j) => j * n + n - 1);
    skirt(top);
    skirt(bottom);
    skirt(left);
    skirt(right);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, v * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, v * 3), 3));
    geo.setIndex(indices);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  }

  private buildBackdrop() {
    const extent = 3600;
    const cell = 48;
    const n = Math.floor((extent * 2) / cell) + 1;
    const pos = new Float32Array(n * n * 3);
    const indices: number[] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -extent + i * cell;
        const z = -extent + j * cell;
        const inside = Math.max(Math.abs(x), Math.abs(z)) < HALF_WORLD - cell * 1.5;
        const h = inside ? -120 : naturalHeight(x, z) - (Math.max(Math.abs(x), Math.abs(z)) < HALF_WORLD + cell ? 1.5 : 0);
        const k = (j * n + i) * 3;
        pos[k] = x;
        pos[k + 1] = h;
        pos[k + 2] = z;
      }
    }
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i;
        indices.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    mesh.name = 'terrain_backdrop';
    return mesh;
  }
}

const _n = new THREE.Vector3();

function createTerrainMaterial(
  splat: THREE.Texture,
  aux: THREE.Texture,
  noiseT: THREE.Texture,
  detailN: THREE.Texture,
) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0.0 });
  const uniforms = {
    uSplat: { value: splat },
    uAux: { value: aux },
    uNoise: { value: noiseT },
    uDetailN: { value: detailN },
    uWorldHalf: { value: HALF_WORLD },
    uPlateau: { value: new THREE.Vector3(PLATEAU.x, PLATEAU.z, PLATEAU.radius) },
    uWetness: G.wetness,
    uNight: G.nightFactor,
  };
  extendMaterial(mat, 'terrain-v1', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vTWorldPos;
        varying vec3 vTWorldNormal;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vTWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vTWorldPos;
        varying vec3 vTWorldNormal;
        uniform sampler2D uSplat, uAux, uNoise, uDetailN;
        uniform float uWorldHalf, uWetness, uNight;
        uniform vec3 uPlateau;
        float tAO = 1.0;
        float tFarShadow = 1.0;
        vec3 tDetailN = vec3(0.0);
        float tRough = 0.9;
        vec3 triNoise(vec3 p, vec3 n, float scale) {
          vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
          vec4 a = texture2D(uNoise, p.yz * scale);
          vec4 b = texture2D(uNoise, p.xz * scale);
          vec4 c = texture2D(uNoise, p.xy * scale);
          return (a * w.x + b * w.y + c * w.z).rgb;
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `
        vec2 wuv = (vTWorldPos.xz + uWorldHalf) / (2.0 * uWorldHalf);
        vec4 sp = texture2D(uSplat, wuv);
        vec4 ax = texture2D(uAux, wuv);
        bool outside = abs(vTWorldPos.x) > uWorldHalf || abs(vTWorldPos.z) > uWorldHalf;
        if (outside) { sp = vec4(0.0); ax = vec4(1.0, 0.8, 1.0, 1.0); }
        tAO = ax.g;
        tFarShadow = ax.b;
        vec3 wn = normalize(vTWorldNormal);
        vec3 p = vTWorldPos;
        vec4 nA = texture2D(uNoise, p.xz * 0.013);
        vec4 nB = texture2D(uNoise, p.xz * 0.061);
        vec4 nC = texture2D(uNoise, p.xz * 0.27);
        float macro = nA.a * 0.6 + nA.g * 0.4;
        // --- dirt base (reddish desert soil) ---
        vec3 dirt = mix(vec3(0.36, 0.25, 0.17), vec3(0.5, 0.37, 0.26), macro);
        dirt = mix(dirt, vec3(0.36, 0.27, 0.2), smoothstep(0.55, 0.8, nB.g) * 0.5);
        dirt *= 0.88 + 0.24 * nC.r;
        // dry scrub/grass tint patches
        float scrub = smoothstep(0.58, 0.72, nA.g + nB.r * 0.25) * smoothstep(0.85, 0.95, wn.y);
        dirt = mix(dirt, vec3(0.47, 0.43, 0.27), scrub * 0.55);
        // --- sand ---
        vec3 sand = mix(vec3(0.7, 0.49, 0.3), vec3(0.79, 0.58, 0.37), nB.g);
        sand *= 0.93 + 0.1 * nC.r;
        // wind ripples
        float ripple = sin(dot(p.xz, vec2(0.8, 0.6)) * 2.6 + nB.r * 6.0) * 0.5 + 0.5;
        sand *= 0.95 + 0.07 * ripple;
        // --- rock with strata ---
        float plateauD = length(p.xz - uPlateau.xy);
        float redness = smoothstep(uPlateau.z + 260.0, uPlateau.z - 50.0, plateauD);
        float strata = sin(p.y * 1.35 + nA.g * 5.0 + nB.r * 1.6) * 0.5 + 0.5;
        float strata2 = sin(p.y * 4.1 + nB.g * 3.0) * 0.5 + 0.5;
        vec3 tri = triNoise(p, wn, 0.09);
        vec3 rockGrey = mix(vec3(0.4, 0.31, 0.25), vec3(0.58, 0.46, 0.36), strata * 0.25 + tri.g * 0.75);
        vec3 rockRed = mix(vec3(0.52, 0.25, 0.15), vec3(0.78, 0.46, 0.28), strata);
        rockRed = mix(rockRed, vec3(0.86, 0.66, 0.46), smoothstep(0.75, 0.95, strata2) * 0.6);
        vec3 rock = mix(rockGrey, rockRed, redness);
        rock *= 0.78 + 0.35 * tri.r;
        rock = mix(rock, rock * 0.7, smoothstep(0.35, 0.05, tri.b) * 0.6);
        // --- asphalt ---
        vec3 asphalt = mix(vec3(0.16, 0.16, 0.17), vec3(0.26, 0.255, 0.25), nB.g * 0.7 + nC.r * 0.3);
        float cracks = smoothstep(0.06, 0.0, texture2D(uNoise, p.xz * 0.07).b);
        asphalt = mix(asphalt, vec3(0.07), cracks * 0.8);
        asphalt = mix(asphalt, dirt * 0.8, smoothstep(0.62, 0.8, nA.g) * 0.5); // sand drift over road
        // lane markings from distance to highway centre
        float rd = ax.r * 12.0;
        float edgeLine = smoothstep(0.18, 0.05, abs(rd - 5.9));
        float dash = step(0.45, fract((p.x + p.z * 0.3) * 0.075));
        float centre = smoothstep(0.2, 0.08, rd) * dash;
        float wear = smoothstep(0.35, 0.6, nB.r + nC.g * 0.3);
        vec3 paint = mix(vec3(0.85, 0.82, 0.74), vec3(0.85, 0.66, 0.18), step(rd, 1.0));
        asphalt = mix(asphalt, paint, max(edgeLine, centre) * wear * sp.r);
        // --- gravel road ---
        vec3 gravel = mix(vec3(0.5, 0.44, 0.37), vec3(0.62, 0.56, 0.47), nC.r);
        gravel *= 0.85 + 0.3 * texture2D(uNoise, p.xz * 0.9).r;
        // --- packed/industrial ground ---
        vec3 packed = mix(vec3(0.4, 0.31, 0.23), vec3(0.5, 0.4, 0.3), nB.g);
        packed = mix(packed, vec3(0.12, 0.1, 0.09), smoothstep(0.8, 0.95, nA.r * 0.5 + nB.g * 0.5) * 0.6); // oil stains
        // --- blend ---
        vec3 col = dirt;
        float sandW = sp.b;
        col = mix(col, sand, sandW);
        col = mix(col, packed, sp.a * (1.0 - sp.r));
        col = mix(col, gravel, sp.g * (1.0 - sp.r));
        col = mix(col, asphalt, sp.r);
        float rockW = smoothstep(0.83, 0.68, wn.y + (nB.g - 0.5) * 0.12);
        rockW = max(rockW, redness * smoothstep(0.9, 0.8, wn.y) * 0.5);
        rockW = max(rockW, smoothstep(45.0, 85.0, p.y + nA.g * 20.0) * 0.85);
        col = mix(col, rock, rockW * (1.0 - sp.r));
        tRough = mix(0.93, 0.82, rockW);
        tRough = mix(tRough, 0.78, sp.r);
        tRough = mix(tRough, 0.98, sandW * (1.0 - rockW));
        // wet darkening
        col *= mix(1.0, 0.6, uWetness * (1.0 - sandW * 0.5));
        tRough = mix(tRough, 0.35, uWetness * 0.8);
        // detail normal: triplanar
        vec3 dn;
        {
          vec3 w = pow(abs(wn), vec3(4.0)); w /= (w.x + w.y + w.z);
          float sc = mix(0.35, 0.18, rockW);
          vec3 a = texture2D(uDetailN, p.zy * sc).xyz * 2.0 - 1.0;
          vec3 b = texture2D(uDetailN, p.xz * sc).xyz * 2.0 - 1.0;
          vec3 c = texture2D(uDetailN, p.xy * sc).xyz * 2.0 - 1.0;
          vec3 fine = texture2D(uDetailN, p.xz * 1.7).xyz * 2.0 - 1.0;
          dn = vec3(0.0, a.y, a.x) * w.x + vec3(b.x, 0.0, b.y) * w.y + vec3(c.x, c.y, 0.0) * w.z;
          dn += vec3(fine.x, 0.0, fine.y) * 0.35 * (1.0 - sp.r);
          float strength = mix(0.8, 1.5, rockW) * mix(1.0, 0.35, sp.r) * mix(1.0, 0.55, sandW);
          tDetailN = dn * strength;
          // micro albedo: pebbles and grain catch light, crevices darken
          float hA = texture2D(uDetailN, p.xz * 0.35).a;
          float hB = texture2D(uDetailN, p.xz * 1.7).a;
          float grain = mix(hA, hB, 0.5);
          col *= mix(0.78, 1.12, grain) * mix(1.0, 0.92, sp.r);
          float pebbles = smoothstep(0.7, 0.85, texture2D(uNoise, p.xz * 0.9).r) * (1.0 - sandW) * (1.0 - sp.r) * (1.0 - rockW);
          col = mix(col, col * vec3(0.72, 0.68, 0.64), pebbles * 0.6);
        }
        diffuseColor.rgb = col;
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = tRough;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec3 dnView = (viewMatrix * vec4(tDetailN, 0.0)).xyz;
          normal = normalize(normal + dnView * 0.6);
        }`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        {
          float fs = mix(tFarShadow, 1.0, uNight);
          reflectedLight.directDiffuse *= fs;
          reflectedLight.directSpecular *= fs;
          reflectedLight.indirectDiffuse *= tAO;
          reflectedLight.directDiffuse *= mix(1.0, tAO, 0.35);
        }`,
      );
  });
  return mat;
}

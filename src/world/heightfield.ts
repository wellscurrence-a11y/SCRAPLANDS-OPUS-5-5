/**
 * Procedural heightfield + surface splat for the Kessler Basin.
 * Pure data module (no three.js), so it can run in workers/tests.
 */
import { Noise } from '../core/noise';
import { clamp, clamp01, lerp, smoothstep } from '../core/math';
import {
  CANYONS,
  DUNES,
  HALF_WORLD,
  LOCATIONS,
  PIT,
  PIT_RAMP,
  PLATEAU,
  ROADS,
  WORLD_SIZE,
} from './layout';

export const GRID = 1025; // vertices per side
export const CELL = WORLD_SIZE / (GRID - 1); // 2 m

export type Surface = 'asphalt' | 'gravel' | 'sand' | 'dirt' | 'rock' | 'packed';

export interface HeightfieldData {
  heights: Float32Array; // row-major [iz * GRID + ix]
  splat: Uint8Array; // RGBA per vertex: asphalt, gravel, sand, packed
  roadDist: Float32Array; // distance to nearest highway centreline (clamped), for markings
}

const n = new Noise(4242);
const n2 = new Noise(777);

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = clamp01(t);
  const cx = ax + dx * t - px;
  const cz = az + dz * t - pz;
  return { d: Math.sqrt(cx * cx + cz * cz), t };
}

function distToPolyline(px: number, pz: number, pts: [number, number][]) {
  let best = 1e9;
  for (let i = 0; i < pts.length - 1; i++) {
    const r = distToSegment(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (r.d < best) best = r.d;
  }
  return best;
}

/** Rolling base terrain without features; also used for canyon floors and far backdrop. */
export function rollingHeight(x: number, z: number) {
  let h = 10 * n.fbm2(x / 700, z / 700, 4) + 4 * n.fbm2(x / 180, z / 180, 3) + 0.8 * n.fbm2(x / 40, z / 40, 2);
  // gentle bowl so the centre sits lower than the rim
  const r = Math.sqrt(x * x + z * z);
  h += smoothstep(200, 900, r) * 8;
  return h;
}

function mountainRing(x: number, z: number) {
  const ax = Math.abs(x) / 1.0;
  const az = Math.abs(z) / 1.0;
  const r = Math.pow(Math.pow(ax, 4) + Math.pow(az, 4), 0.25);
  const wobble = n2.fbm2(x / 260, z / 260, 3) * 70;
  const edge = smoothstep(830 + wobble, 1010 + wobble, r);
  if (edge <= 0) return 0;
  const ridge = n.ridged2(x / 520, z / 520, 4);
  const base = n.fbm2(x / 380 + 7, z / 380 - 3, 3) * 0.5 + 0.5;
  return edge * (45 + 120 * Math.pow(ridge, 1.2) * (0.5 + base) + 25 * base) + edge * edge * 30;
}

function duneHeight(x: number, z: number) {
  const dx = x - DUNES.x;
  const dz = z - DUNES.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  const mask = smoothstep(DUNES.radius + 120, DUNES.radius - 60, d + n.fbm2(x / 200, z / 200, 2) * 80);
  if (mask <= 0) return { h: 0, mask: 0 };
  // Wind from the north-west: asymmetric crests
  const warp = n.fbm2(x / 260, z / 260, 3) * 60;
  const u = (x * 0.8 + z * 0.6 + warp) / 58;
  const ph = u - Math.floor(u);
  const profile = ph < 0.7 ? smoothstep(0, 0.7, ph) : 1 - smoothstep(0.7, 1.0, ph);
  const secondary = 0.5 + 0.5 * n.noise2(x / 90, z / 90);
  const h = (profile * 9 + secondary * 4) * mask;
  return { h, mask };
}

function plateauMask(x: number, z: number) {
  const dx = x - PLATEAU.x;
  const dz = z - PLATEAU.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  const irregular = n2.fbm2(x / 140, z / 140, 3) * 70 + n.noise2(x / 35, z / 35) * 10;
  // steep escarpment
  return smoothstep(PLATEAU.radius + 20, PLATEAU.radius - 10, d + irregular);
}

function terrace(h: number, step: number, sharp: number) {
  const k = h / step;
  const f = Math.floor(k);
  const t = k - f;
  return (f + Math.pow(t, sharp)) * step;
}

/** Scattered buttes in the southern plains. */
function butteHeight(x: number, z: number) {
  // only in south-west quadrant outskirts & north-east badlands
  const v = n2.noise2(x / 110 + 30, z / 110 - 12);
  const regionA = smoothstep(-100, -350, x) * smoothstep(250, 380, z) * (1 - plateauMask(x, z));
  const regionB = smoothstep(200, 350, x) * smoothstep(-100, -250, z) * smoothstep(-800, -600, z) * 0.7;
  const region = Math.max(regionA, regionB);
  if (region <= 0 || v < 0.55) return 0;
  const k = smoothstep(0.55, 0.62, v);
  return k * region * (18 + 14 * n.noise2(x / 50, z / 50));
}

let pitBase: number | null = null;
/** Rim level of the quarry: the gentle desert height at its centre, ignoring buttes and mountains. */
function pitBaseHeight() {
  if (pitBase === null) pitBase = rollingHeight(PIT.x, PIT.z) + 2;
  return pitBase;
}

/**
 * The Pit: an open-cast mine cut to a fixed rim level, so buttes and the foot of the mountain ring
 * are quarried away around it (leaving a cut face on the mountain side), with five benches and a
 * haul ramp down to the floor.
 */
function pitHeight(x: number, z: number, h: number) {
  const dx = x - PIT.x;
  const dz = z - PIT.z;
  const d = Math.sqrt(dx * dx + dz * dz) + n.noise2(x / 40, z / 40) * 6;
  const apronOuter = PIT.radius + 70;
  if (d > apronOuter) return h;
  const base = pitBaseHeight();
  // level working apron around the rim
  const apron = smoothstep(apronOuter, PIT.radius + 18, d);
  const hApron = lerp(h, base + 0.8 * n.fbm2(x / 30, z / 30, 2), apron);
  const t = clamp01(d / PIT.radius);
  // five benches
  const depthT = 1 - smoothstep(0.28, 1.0, t);
  const stepped = terrace(depthT * 5, 1, 7) / 5;
  let ph = base - PIT.depth * stepped + 0.6 * n.noise2(x / 12, z / 12) * (1 - stepped);
  // haul ramp
  const r = distToSegment(x, z, PIT_RAMP.ax, PIT_RAMP.az, PIT_RAMP.bx, PIT_RAMP.bz);
  if (r.d < PIT_RAMP.width + 8) {
    const target = lerp(base, base - PIT.depth, clamp01((r.t - 0.03) / 0.94)); // constant grade
    const k = smoothstep(PIT_RAMP.width + 8, PIT_RAMP.width, r.d);
    ph = lerp(ph, Math.min(target, hApron), k);
  }
  const blend = smoothstep(PIT.radius + 20, PIT.radius, d);
  let out = lerp(hApron, ph, blend);
  // spoil heaps of overburden dumped along the apron
  for (let i = 0; i < 6; i++) {
    const a = 2.1 + i * 0.52;
    const hx = PIT.x + Math.cos(a) * (PIT.radius + 42);
    const hz = PIT.z + Math.sin(a) * (PIT.radius + 42);
    const hd = Math.hypot(x - hx, z - hz) + n.noise2(x / 9, z / 9) * 3;
    const heap = (1 - smoothstep(0, 17 - (i % 3) * 3, hd)) * (7 + (i % 3) * 2.5);
    if (heap > 0) out = Math.max(out, base + heap * apron);
  }
  return out;
}

/** 0..1 inside the quarry (benches, floor and apron), for surface painting. */
export function pitMask(x: number, z: number) {
  const d = Math.hypot(x - PIT.x, z - PIT.z);
  return smoothstep(PIT.radius + 60, PIT.radius + 10, d);
}

export function naturalHeight(x: number, z: number): number {
  let h = rollingHeight(x, z);
  const dune = duneHeight(x, z);
  h += dune.h;
  h += butteHeight(x, z);
  // Plateau & canyons
  const pm = plateauMask(x, z);
  if (pm > 0) {
    let ph = PLATEAU.height + 4 * n.fbm2(x / 150, z / 150, 3) + h * 0.2;
    ph = terrace(ph, 7, 2.5);
    let cd = 1e9;
    let cw = 30;
    for (const c of CANYONS) {
      const d = distToPolyline(x, z, c.points);
      if (d < cd) {
        cd = d;
        cw = c.width;
      }
    }
    const wob = n.noise2(x / 45, z / 45) * 5;
    const floorH = h + 1.5 * n.noise2(x / 25, z / 25);
    const carve = 1 - smoothstep(cw * 0.42, cw * 0.62 + 6, cd + wob);
    // stepped walls
    const wall = terrace(carve * 4, 1, 2.2) / 4;
    ph = lerp(ph, floorH, clamp01(wall));
    h = lerp(h, ph, pm);
  }
  h += mountainRing(x, z);
  h = pitHeight(x, z, h);
  return h;
}

export function generateHeightfield(onProgress?: (p: number) => void): HeightfieldData {
  const heights = new Float32Array(GRID * GRID);
  const splat = new Uint8Array(GRID * GRID * 4);
  const roadDist = new Float32Array(GRID * GRID).fill(99);
  const sandMask = new Float32Array(GRID * GRID);

  for (let iz = 0; iz < GRID; iz++) {
    const z = -HALF_WORLD + iz * CELL;
    for (let ix = 0; ix < GRID; ix++) {
      const x = -HALF_WORLD + ix * CELL;
      heights[iz * GRID + ix] = naturalHeight(x, z);
      sandMask[iz * GRID + ix] = duneHeight(x, z).mask;
    }
    if (onProgress && iz % 64 === 0) onProgress((iz / GRID) * 0.7);
  }

  const sample = (x: number, z: number) => sampleHeight(heights, x, z);

  // Flatten location pads
  for (const loc of LOCATIONS) {
    if (!loc.flatten) continue;
    let base = 0;
    let cnt = 0;
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      base += sample(loc.x + Math.cos(ang) * loc.flatten * 0.4, loc.z + Math.sin(ang) * loc.flatten * 0.4);
      cnt++;
    }
    base = base / cnt + (loc.flattenHeight ?? 0);
    const r = loc.flatten;
    const i0 = Math.max(0, Math.floor((loc.x - r * 1.4 + HALF_WORLD) / CELL));
    const i1 = Math.min(GRID - 1, Math.ceil((loc.x + r * 1.4 + HALF_WORLD) / CELL));
    const j0 = Math.max(0, Math.floor((loc.z - r * 1.4 + HALF_WORLD) / CELL));
    const j1 = Math.min(GRID - 1, Math.ceil((loc.z + r * 1.4 + HALF_WORLD) / CELL));
    for (let iz = j0; iz <= j1; iz++) {
      for (let ix = i0; ix <= i1; ix++) {
        const x = -HALF_WORLD + ix * CELL;
        const z = -HALF_WORLD + iz * CELL;
        const d = Math.hypot(x - loc.x, z - loc.z) + n.noise2(x / 30, z / 30) * 8;
        const k = smoothstep(r * 1.35, r * 0.8, d);
        if (k <= 0) continue;
        const idx = iz * GRID + ix;
        heights[idx] = lerp(heights[idx], base + n.noise2(x / 20, z / 20) * 0.25, k);
        const packed = smoothstep(r * 1.1, r * 0.6, d);
        splat[idx * 4 + 3] = Math.max(splat[idx * 4 + 3], Math.round(packed * 255));
        sandMask[idx] *= 1 - k;
      }
    }
  }
  // The quarry: gravel benches and floor, no drifting sand
  {
    const r = PIT.radius + 60;
    const i0 = Math.max(0, Math.floor((PIT.x - r + HALF_WORLD) / CELL));
    const i1 = Math.min(GRID - 1, Math.ceil((PIT.x + r + HALF_WORLD) / CELL));
    const j0 = Math.max(0, Math.floor((PIT.z - r + HALF_WORLD) / CELL));
    const j1 = Math.min(GRID - 1, Math.ceil((PIT.z + r + HALF_WORLD) / CELL));
    for (let iz = j0; iz <= j1; iz++) {
      for (let ix = i0; ix <= i1; ix++) {
        const x = -HALF_WORLD + ix * CELL;
        const z = -HALF_WORLD + iz * CELL;
        const k = pitMask(x, z);
        if (k <= 0) continue;
        const idx = iz * GRID + ix;
        const grit = 0.55 + 0.45 * n.noise2(x / 18, z / 18);
        splat[idx * 4 + 1] = Math.max(splat[idx * 4 + 1], Math.round(k * grit * 230));
        sandMask[idx] *= 1 - k;
      }
    }
  }
  onProgress?.(0.78);

  // Roads: smoothed elevation profile, then rasterise corridor.
  for (const road of ROADS) {
    const pts = road.points;
    // resample polyline every 4m
    const samples: { x: number; z: number; h: number }[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(1, Math.ceil(len / 4));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const x = lerp(ax, bx, t);
        const z = lerp(az, bz, t);
        samples.push({ x, z, h: sample(x, z) });
      }
    }
    samples.push({ x: pts[pts.length - 1][0], z: pts[pts.length - 1][1], h: sample(pts[pts.length - 1][0], pts[pts.length - 1][1]) });
    // Smooth profile: window average (grade limiting)
    const win = road.kind === 'highway' ? 14 : 8;
    const smoothH = samples.map((_, i) => {
      let s = 0,
        c = 0;
      for (let k = -win; k <= win; k++) {
        const j = i + k;
        if (j < 0 || j >= samples.length) continue;
        const w = 1 - Math.abs(k) / (win + 1);
        s += samples[j].h * w;
        c += w;
      }
      return s / c;
    });
    const half = road.width / 2;
    const shoulder = road.kind === 'highway' ? 9 : 6;
    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i];
      const b = samples[i + 1];
      const minX = Math.min(a.x, b.x) - half - shoulder;
      const maxX = Math.max(a.x, b.x) + half + shoulder;
      const minZ = Math.min(a.z, b.z) - half - shoulder;
      const maxZ = Math.max(a.z, b.z) + half + shoulder;
      const i0 = Math.max(0, Math.floor((minX + HALF_WORLD) / CELL));
      const i1 = Math.min(GRID - 1, Math.ceil((maxX + HALF_WORLD) / CELL));
      const j0 = Math.max(0, Math.floor((minZ + HALF_WORLD) / CELL));
      const j1 = Math.min(GRID - 1, Math.ceil((maxZ + HALF_WORLD) / CELL));
      for (let iz = j0; iz <= j1; iz++) {
        for (let ix = i0; ix <= i1; ix++) {
          const x = -HALF_WORLD + ix * CELL;
          const z = -HALF_WORLD + iz * CELL;
          const r = distToSegment(x, z, a.x, a.z, b.x, b.z);
          const idx = iz * GRID + ix;
          if (road.kind === 'highway' && r.d < roadDist[idx]) roadDist[idx] = r.d;
          if (r.d > half + shoulder) continue;
          const rh = lerp(smoothH[i], smoothH[i + 1], r.t);
          const k = 1 - smoothstep(half, half + shoulder, r.d);
          // Mark the best (closest) road influence
          const prev = splat[idx * 4 + (road.kind === 'highway' ? 0 : 1)] / 255;
          const core = 1 - smoothstep(half - 1.2, half + 0.6, r.d + n.noise2(x / 6, z / 6) * (road.kind === 'dirt' ? 1.5 : 0.4));
          if (road.kind === 'highway') {
            splat[idx * 4 + 0] = Math.max(prev, core) * 255;
            const sh = (1 - smoothstep(half, half + 3, r.d)) * 0.8;
            splat[idx * 4 + 1] = Math.max(splat[idx * 4 + 1], sh * 255);
          } else {
            splat[idx * 4 + 1] = Math.max(prev, core) * 255;
          }
          sandMask[idx] *= 1 - core;
          heights[idx] = lerp(heights[idx], rh - 0.05, k * k * (3 - 2 * k));
        }
      }
    }
  }
  onProgress?.(0.92);

  // Final sand channel + extra drift sand in low basins
  for (let iz = 0; iz < GRID; iz++) {
    for (let ix = 0; ix < GRID; ix++) {
      const idx = iz * GRID + ix;
      const x = -HALF_WORLD + ix * CELL;
      const z = -HALF_WORLD + iz * CELL;
      const drift = smoothstep(0.35, 0.7, n2.fbm2(x / 120, z / 120, 3) * 0.5 + 0.5) * 0.55;
      const s = clamp01(Math.max(sandMask[idx], drift * (1 - splat[idx * 4 + 3] / 255) * (1 - pitMask(x, z))));
      splat[idx * 4 + 2] = Math.round(s * (1 - splat[idx * 4] / 255) * 255);
    }
  }
  onProgress?.(1);
  return { heights, splat, roadDist };
}

export function sampleHeight(heights: Float32Array, x: number, z: number): number {
  const fx = clamp((x + HALF_WORLD) / CELL, 0, GRID - 1.0001);
  const fz = clamp((z + HALF_WORLD) / CELL, 0, GRID - 1.0001);
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const i = iz * GRID + ix;
  // Match the triangulation used by the mesh/physics (split along the diagonal)
  const h00 = heights[i];
  const h10 = heights[i + 1];
  const h01 = heights[i + GRID];
  const h11 = heights[i + GRID + 1];
  if (tx + tz <= 1) return h00 + (h10 - h00) * tx + (h01 - h00) * tz;
  return h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
}

export function sampleSplat(splat: Uint8Array, x: number, z: number, out: number[]) {
  const ix = clamp(Math.round((x + HALF_WORLD) / CELL), 0, GRID - 1);
  const iz = clamp(Math.round((z + HALF_WORLD) / CELL), 0, GRID - 1);
  const i = (iz * GRID + ix) * 4;
  out[0] = splat[i] / 255;
  out[1] = splat[i + 1] / 255;
  out[2] = splat[i + 2] / 255;
  out[3] = splat[i + 3] / 255;
  return out;
}

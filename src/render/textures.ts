import * as THREE from 'three';
import { RNG } from '../core/random';

/** Periodic value noise on a lattice that wraps at `period`. */
function makePeriodicNoise(seed: number, period: number) {
  const rng = new RNG(seed);
  const lat = new Float32Array(period * period);
  for (let i = 0; i < lat.length; i++) lat[i] = rng.next();
  return (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const x0 = ((xi % period) + period) % period;
    const y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period;
    const y1 = (y0 + 1) % period;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = lat[y0 * period + x0];
    const b = lat[y0 * period + x1];
    const c = lat[y1 * period + x0];
    const d = lat[y1 * period + x1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

function tileableFbm(size: number, seed: number, baseFreq: number, octaves: number) {
  const out = new Float32Array(size * size);
  const noises = Array.from({ length: octaves }, (_, o) => makePeriodicNoise(seed + o * 31, baseFreq << o));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let s = 0,
        a = 0.5,
        norm = 0;
      for (let o = 0; o < octaves; o++) {
        const f = (baseFreq << o) / size;
        s += noises[o](x * f, y * f) * a;
        norm += a;
        a *= 0.5;
      }
      out[y * size + x] = s / norm;
    }
  }
  return out;
}

/** Worley/cellular noise (tileable) – returns crack-like edges in [0,1]. */
function tileableCells(size: number, seed: number, cells: number) {
  const rng = new RNG(seed);
  const pts: [number, number][] = [];
  for (let i = 0; i < cells * cells; i++) pts.push([rng.next(), rng.next()]);
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = (x / size) * cells;
      const py = (y / size) * cells;
      const cx = Math.floor(px);
      const cy = Math.floor(py);
      let d1 = 9,
        d2 = 9;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const gx = (((cx + ox) % cells) + cells) % cells;
          const gy = (((cy + oy) % cells) + cells) % cells;
          const p = pts[gy * cells + gx];
          const dx = cx + ox + p[0] - px;
          const dy = cy + oy + p[1] - py;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < d1) {
            d2 = d1;
            d1 = d;
          } else if (d < d2) d2 = d;
        }
      }
      out[y * size + x] = Math.min(1, (d2 - d1) * 2.2);
    }
  }
  return out;
}

let noiseTex: THREE.DataTexture | null = null;
let detailNormalTex: THREE.DataTexture | null = null;

/**
 * RGBA noise atlas: R fine fbm, G medium fbm, B cellular cracks, A coarse fbm. Tiles seamlessly.
 */
export function getNoiseTexture() {
  if (noiseTex) return noiseTex;
  const size = 256;
  const r = tileableFbm(size, 11, 16, 4);
  const g = tileableFbm(size, 23, 4, 5);
  const b = tileableCells(size, 37, 8);
  const a = tileableFbm(size, 51, 2, 3);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = Math.round(r[i] * 255);
    data[i * 4 + 1] = Math.round(g[i] * 255);
    data[i * 4 + 2] = Math.round(b[i] * 255);
    data[i * 4 + 3] = Math.round(a[i] * 255);
  }
  noiseTex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping;
  noiseTex.magFilter = THREE.LinearFilter;
  noiseTex.minFilter = THREE.LinearMipmapLinearFilter;
  noiseTex.generateMipmaps = true;
  noiseTex.anisotropy = 4;
  noiseTex.needsUpdate = true;
  return noiseTex;
}

/** Tileable detail normal map (grainy rock/sand micro-relief). */
export function getDetailNormalTexture() {
  if (detailNormalTex) return detailNormalTex;
  const size = 512;
  const h1 = tileableFbm(size, 71, 8, 5);
  const h2 = tileableCells(size, 91, 12);
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) h[i] = h1[i] * 0.8 + h2[i] * 0.35;
  const data = new Uint8Array(size * size * 4);
  const s = 6.0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)];
      const r = h[y * size + ((x + 1) % size)];
      const d = h[((y - 1 + size) % size) * size + x];
      const u = h[((y + 1) % size) * size + x];
      let nx = (l - r) * s;
      let ny = (d - u) * s;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * size + x) * 4;
      data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      data[i + 3] = Math.round(h[y * size + x] * 255);
    }
  }
  detailNormalTex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  detailNormalTex.wrapS = detailNormalTex.wrapT = THREE.RepeatWrapping;
  detailNormalTex.minFilter = THREE.LinearMipmapLinearFilter;
  detailNormalTex.magFilter = THREE.LinearFilter;
  detailNormalTex.generateMipmaps = true;
  detailNormalTex.anisotropy = 8;
  detailNormalTex.needsUpdate = true;
  return detailNormalTex;
}

/** Soft round sprite for particles. */
export function makeRadialSprite(size = 64, hard = 0.0) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(Math.max(0.01, hard), 'rgba(255,255,255,0.85)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** Billowy smoke puff sprite sheet (4x4 variations) with alpha. */
export function makeSmokeAtlas(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const rng = new RNG(5);
  const cell = size / 4;
  for (let i = 0; i < 16; i++) {
    const cx = (i % 4) * cell + cell / 2;
    const cy = Math.floor(i / 4) * cell + cell / 2;
    for (let k = 0; k < 22; k++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(0, cell * 0.22);
      const r = rng.range(cell * 0.12, cell * 0.26);
      const x = cx + Math.cos(a) * d;
      const y = cy + Math.sin(a) * d;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      const alpha = rng.range(0.1, 0.22);
      grd.addColorStop(0, `rgba(255,255,255,${alpha})`);
      grd.addColorStop(0.6, `rgba(255,255,255,${alpha * 0.5})`);
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

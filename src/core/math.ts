import * as THREE from 'three';

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => (b === a ? 0 : (v - a) / (b - a));
export const remap = (v: number, a0: number, a1: number, b0: number, b1: number) =>
  lerp(b0, b1, clamp01(invLerp(a0, a1, v)));
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const sign = (v: number) => (v < 0 ? -1 : 1);
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** Framerate-independent exponential smoothing factor. */
export const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

export function dampTo(current: number, target: number, rate: number, dt: number) {
  return lerp(current, target, damp(rate, dt));
}

/** Wrap an angle to [-PI, PI]. */
export function wrapAngle(a: number) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

export function approach(current: number, target: number, maxDelta: number) {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}

export function approachAngle(current: number, target: number, maxDelta: number) {
  const d = wrapAngle(target - current);
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** Scratch objects to avoid per-frame allocations. Never hold references across calls. */
export const tmp = {
  v0: new THREE.Vector3(),
  v1: new THREE.Vector3(),
  v2: new THREE.Vector3(),
  v3: new THREE.Vector3(),
  v4: new THREE.Vector3(),
  v5: new THREE.Vector3(),
  q0: new THREE.Quaternion(),
  q1: new THREE.Quaternion(),
  m0: new THREE.Matrix4(),
  m1: new THREE.Matrix4(),
  e0: new THREE.Euler(),
};

export function formatNumber(n: number, digits = 0) {
  return n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function formatMass(kg: number) {
  if (kg >= 1000) return `${(kg / 1000).toFixed(kg >= 10000 ? 1 : 2)} t`;
  return `${Math.round(kg)} kg`;
}

export function formatPower(kw: number) {
  if (Math.abs(kw) >= 1000) return `${(kw / 1000).toFixed(2)} MW`;
  return `${Math.round(kw)} kW`;
}

export function formatForce(n: number) {
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)} kN`;
  return `${Math.round(n)} N`;
}

export function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

/** Solve symmetric 3x3 eigen decomposition with Jacobi iterations.
 *  Input matrix as [a00,a01,a02,a11,a12,a22]; returns eigenvalues and eigenvector matrix columns. */
export function symmetricEigen3(m: number[]): { values: [number, number, number]; vectors: THREE.Matrix3 } {
  const a = [
    [m[0], m[1], m[2]],
    [m[1], m[3], m[4]],
    [m[2], m[4], m[5]],
  ];
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 24; sweep++) {
    let off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off < 1e-9) break;
    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-12) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const mat = new THREE.Matrix3().set(v[0][0], v[0][1], v[0][2], v[1][0], v[1][1], v[1][2], v[2][0], v[2][1], v[2][2]);
  return { values: [a[0][0], a[1][1], a[2][2]], vectors: mat };
}

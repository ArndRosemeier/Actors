/** Small vector, quaternion and seeded-random helpers (no renderer types). */
export type V3 = [number, number, number];
/** Quaternion [x, y, z, w]. */
export type Q4 = [number, number, number, number];

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0];
};
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const lerp3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
export const smooth = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
/** sign(x)·|x|^p, the superellipse power. */
export const spow = (x: number, p: number): number => Math.sign(x) * Math.pow(Math.abs(x), p);
export const DEG = Math.PI / 180;

export const Q_ID: Q4 = [0, 0, 0, 1];
export function qAxis(axis: V3, angle: number): Q4 {
  const a = norm(axis);
  const s = Math.sin(angle / 2);
  return [a[0] * s, a[1] * s, a[2] * s, Math.cos(angle / 2)];
}
export function qMul(a: Q4, b: Q4): Q4 {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}
export function qRot(q: Q4, v: V3): V3 {
  const [x, y, z, w] = q;
  const u: V3 = [x, y, z];
  const t = mul(cross(u, v), 2);
  return add(add(v, mul(t, w)), cross(u, t));
}
/** Rotation in three.js "XYZ" Euler order (radians). */
export const qEuler = (x: number, y: number, z: number): Q4 => qMul(qMul(qAxis([1, 0, 0], x), qAxis([0, 1, 0], y)), qAxis([0, 0, 1], z));
/** Rotation whose local axes map to the given orthonormal basis vectors. */
export function qBasis(x: V3, y: V3, z: V3): Q4 {
  const m00 = x[0], m01 = y[0], m02 = z[0];
  const m10 = x[1], m11 = y[1], m12 = z[1];
  const m20 = x[2], m21 = y[2], m22 = z[2];
  const tr = m00 + m11 + m22;
  let q: Q4;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  const l = Math.hypot(...q);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}
/** A frame with local +Y along `up` and local +Z as close to `forward` as possible. */
export function qFrame(up: V3, forward: V3 = [0, 0, 1]): Q4 {
  const y = norm(up);
  let z = sub(forward, mul(y, dot(forward, y)));
  if (len(z) < 1e-4) z = sub([1, 0, 0], mul(y, y[0]));
  z = norm(z);
  return qBasis(cross(y, z), y, z);
}

/** Seeded random numbers (mulberry32) with named sub-streams. */
export class Rng {
  private s: number;
  constructor(readonly seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length) % items.length];
  }
  /** Picks a key by weight. */
  weighted<K extends string>(w: Partial<Record<K, number>>): K {
    const entries = Object.entries(w) as [K, number][];
    const total = entries.reduce((s, [, v]) => s + v, 0);
    let r = this.next() * total;
    for (const [k, v] of entries) if ((r -= v) < 0) return k;
    return entries[entries.length - 1][0];
  }
  /** An independent stream, so one block's choices don't shift when another block changes. */
  fork(label: string): Rng {
    let h = this.seed ^ 0x811c9dc5;
    for (let i = 0; i < label.length; i++) h = Math.imul(h ^ label.charCodeAt(i), 0x01000193);
    return new Rng(h >>> 0);
  }
}

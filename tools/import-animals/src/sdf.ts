/**
 * Signed distance primitives for building an animal body around its skeleton
 * (the "blobby skin" approach of Spore's creature editor): tapered capsules
 * along bones and ellipsoids for muscle and fat masses, joined with smooth
 * unions so the joins form soft fillets, and carved with smooth differences
 * (mouth slit, eye sockets).
 */
import { type Vec3, normalize } from "@actors/core";

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Smooth minimum (polynomial, blend width k in meters). */
export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  // Cubic polynomial blend (C2): softer fillets than the quadratic one.
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * h * k * (1 / 6);
}

/** Smooth subtraction of b from a. */
export function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}

/** An orthonormal frame: w along the primitive's main axis, u its "side" axis. */
export interface Frame {
  u: Vec3;
  v: Vec3;
  w: Vec3;
}

/** Frame with w along `axis` and u as close to `side` as possible. */
export function frameFrom(axis: Vec3, side: Vec3 = [1, 0, 0]): Frame {
  const w = normalize(axis);
  let u = sub(side, w.map((c) => c * dot(side, w)) as Vec3);
  if (Math.hypot(...u) < 1e-6) u = Math.abs(w[1]) < 0.9 ? cross([0, 1, 0], w) : cross([1, 0, 0], w);
  u = normalize(u);
  return { u, v: cross(w, u), w };
}

export interface Primitive {
  name: string;
  /** Distance from point p (negative inside). */
  distance(p: Vec3): number;
  /** Axis-aligned bounds (already grown by the primitive's blend width). */
  min: Vec3;
  max: Vec3;
}

/**
 * Ellipsoid with semi-axes (ru along u, rv along v, rw along w) around `center`.
 * Uses the usual bound-corrected approximation (exact on the axes).
 */
export function ellipsoid(name: string, center: Vec3, frame: Frame, r: Vec3): Primitive {
  const ext = Math.max(...r);
  return {
    name,
    min: center.map((c) => c - ext) as Vec3,
    max: center.map((c) => c + ext) as Vec3,
    distance(p) {
      const d = sub(p, center);
      const x = dot(d, frame.u) / r[0], y = dot(d, frame.v) / r[1], z = dot(d, frame.w) / r[2];
      const k0 = Math.hypot(x, y, z);
      const k1 = Math.hypot(x / r[0], y / r[1], z / r[2]);
      if (k1 < 1e-12) return -Math.min(...r);
      return (k0 * (k0 - 1)) / k1;
    },
  };
}

/**
 * Tapered capsule from a (radius ra) to b (radius rb). `flat` squashes the
 * cross-section: [scale along the frame's u, scale along v] (1 = round).
 */
export function capsule(name: string, a: Vec3, b: Vec3, ra: number, rb: number, side: Vec3 = [1, 0, 0], flat: [number, number] = [1, 1]): Primitive {
  const axis = sub(b, a);
  const L = Math.hypot(...axis);
  const f = frameFrom(axis, side);
  const ext = Math.max(ra, rb) * Math.max(1, ...flat);
  const lo = [0, 1, 2].map((k) => Math.min(a[k], b[k]) - ext) as Vec3;
  const hi = [0, 1, 2].map((k) => Math.max(a[k], b[k]) + ext) as Vec3;
  const sMin = Math.min(...flat);
  return {
    name,
    min: lo,
    max: hi,
    distance(p) {
      const d = sub(p, a);
      // Local coordinates; the cross-section is scaled to a circle.
      const x = dot(d, f.u) / flat[0], y = dot(d, f.v) / flat[1], z = dot(d, f.w);
      // Exact round cone (iq): a sphere of ra at 0 swept to rb at L.
      const q = Math.hypot(x, y);
      const bb = (ra - rb) / L;
      const aa = Math.sqrt(Math.max(0, 1 - bb * bb));
      const k = -q * bb + z * aa; // dot((q, z), (-b, a))
      let dist: number;
      if (k < 0) dist = Math.hypot(q, z) - ra;
      else if (k > aa * L) dist = Math.hypot(q, z - L) - rb;
      else dist = q * aa + z * bb - ra;
      return dist * sMin;
    },
  };
}

/** Half-space slab of thickness 2·half around a plane through `point` with normal n, limited to a box of half extents along the frame axes. */
export function box(name: string, center: Vec3, frame: Frame, half: Vec3, round = 0): Primitive {
  const ext = Math.hypot(...half) + round;
  return {
    name,
    min: center.map((c) => c - ext) as Vec3,
    max: center.map((c) => c + ext) as Vec3,
    distance(p) {
      const d = sub(p, center);
      const q = [Math.abs(dot(d, frame.u)) - half[0], Math.abs(dot(d, frame.v)) - half[1], Math.abs(dot(d, frame.w)) - half[2]];
      const out = Math.hypot(Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0));
      return out + Math.min(Math.max(q[0], q[1], q[2]), 0) - round;
    },
  };
}

/** A part of the body: a primitive, how strongly it blends into what came before, and whether it adds or carves. */
export interface Part {
  prim: Primitive;
  /** Blend width with the body built so far (meters). */
  k: number;
  carve?: boolean;
}

/** Evaluates the body (parts in order) at p; parts whose bounds don't contain p are skipped. */
export function bodyDistance(parts: Part[], p: Vec3): number {
  let d = Infinity;
  // Far outside its bounds a part cannot change the surface: any blend reaches the widest k at most.
  let m = 0.02;
  for (const part of parts) m = Math.max(m, 2 * part.k + 0.02);
  for (const { prim, k, carve } of parts) {
    if (p[0] < prim.min[0] - m || p[1] < prim.min[1] - m || p[2] < prim.min[2] - m || p[0] > prim.max[0] + m || p[1] > prim.max[1] + m || p[2] > prim.max[2] + m) continue;
    const e = prim.distance(p);
    d = carve ? smax(d, -e, k) : d === Infinity ? e : smin(d, e, k);
  }
  return d === Infinity ? 1 : d;
}

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

/** A cross-section of a loft: where it sits and its size (half width, height above and depth below the path). */
export interface LoftKey {
  at: Vec3;
  w: number;
  up: number;
  down: number;
  /** Superellipse exponent (2: ellipse, higher: boxier). */
  n?: number;
}

const catmull = (a: number, b: number, c: number, d: number, t: number) =>
  0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);

/**
 * A generalized cylinder: cross-sections (`keys`) swept along a smooth path
 * through their centres, sizes blended smoothly between them. Each section is
 * a superellipse that can be deeper below the path than above it, which is
 * how a trunk or neck profile is drawn (top line, under line, width). The
 * section's "up" is the path's normal closest to +Y (or `upHint`). Ends are
 * closed flat with rounded rims; keep end sections small or buried.
 */
export function loft(name: string, keys: LoftKey[], upHint: Vec3 = [0, 1, 0], perSpan = 16): Primitive {
  const k = keys.length;
  const key = (i: number) => keys[Math.max(0, Math.min(k - 1, i))];
  const samples: { c: Vec3; t: Vec3; u: Vec3; v: Vec3; w: number; up: number; down: number; n: number }[] = [];
  for (let i = 0; i < k - 1; i++) {
    for (let s = 0; s < (i === k - 2 ? perSpan + 1 : perSpan); s++) {
      const t = s / perSpan;
      const a = key(i - 1), b = key(i), c = key(i + 1), d = key(i + 2);
      const f = (g: (x: LoftKey) => number) => catmull(g(a), g(b), g(c), g(d), t);
      samples.push({
        c: [f((x) => x.at[0]), f((x) => x.at[1]), f((x) => x.at[2])],
        t: [0, 0, 0], u: [0, 0, 0], v: [0, 0, 0],
        w: f((x) => x.w), up: f((x) => x.up), down: f((x) => x.down), n: f((x) => x.n ?? 2),
      });
    }
  }
  samples.forEach((s, i) => {
    const a = samples[Math.max(0, i - 1)].c, b = samples[Math.min(samples.length - 1, i + 1)].c;
    s.t = normalize(sub(b, a));
    s.u = normalize(cross(upHint, s.t));
    s.v = cross(s.t, s.u);
  });
  let ext = 0;
  for (const s of samples) ext = Math.max(ext, s.w, s.up, s.down);
  const lo = [0, 1, 2].map((c) => Math.min(...samples.map((s) => s.c[c])) - ext) as Vec3;
  const hi = [0, 1, 2].map((c) => Math.max(...samples.map((s) => s.c[c])) + ext) as Vec3;
  const last = samples.length - 1;
  return {
    name,
    min: lo,
    max: hi,
    distance(p) {
      // Closest point on the path polyline.
      let best = Infinity, bi = 0, bt = 0;
      // Coarse pass over every 4th sample, then the segments around the best one.
      let coarse = 0, cb = Infinity;
      for (let i = 0; i <= last; i += 4) {
        const c = samples[i].c;
        const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (d < cb) {
          cb = d;
          coarse = i;
        }
      }
      for (let i = Math.max(0, coarse - 6); i < Math.min(last, coarse + 6); i++) {
        const a = samples[i].c, b = samples[i + 1].c;
        const ab = sub(b, a), ap = sub(p, a);
        const t = Math.max(0, Math.min(1, dot(ap, ab) / (dot(ab, ab) || 1e-12)));
        const d = (ap[0] - ab[0] * t) ** 2 + (ap[1] - ab[1] * t) ** 2 + (ap[2] - ab[2] * t) ** 2;
        if (d < best) {
          best = d;
          bi = i;
          bt = t;
        }
      }
      const A = samples[bi], B = samples[bi + 1];
      const mix = (x: number, y: number) => x + (y - x) * bt;
      const c: Vec3 = [mix(A.c[0], B.c[0]), mix(A.c[1], B.c[1]), mix(A.c[2], B.c[2])];
      const u = normalize([mix(A.u[0], B.u[0]), mix(A.u[1], B.u[1]), mix(A.u[2], B.u[2])]);
      const tt = normalize([mix(A.t[0], B.t[0]), mix(A.t[1], B.t[1]), mix(A.t[2], B.t[2])]);
      const v = cross(tt, u);
      const d = sub(p, c);
      const x = dot(d, u), y = dot(d, v), axial = dot(d, tt);
      const w = mix(A.w, B.w), h = y > 0 ? mix(A.up, B.up) : mix(A.down, B.down), n = mix(A.n, B.n);
      const r = Math.pow(Math.pow(Math.abs(x) / w, n) + Math.pow(Math.abs(y) / h, n), 1 / n);
      const rho = Math.hypot(x, y);
      const dc = r > 1e-6 ? rho * (1 - 1 / r) : -Math.min(w, h);
      // Beyond an end: flat cap.
      const beyond = (bi === 0 && bt === 0 && axial < 0) ? -axial : (bi === last - 1 && bt === 1 && axial > 0) ? axial : 0;
      if (beyond <= 0) return dc;
      return dc > 0 ? Math.hypot(dc, beyond) : Math.max(dc, beyond);
    },
  };
}

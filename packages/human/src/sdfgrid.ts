/**
 * Small signed-distance toolkit for generated bones: primitives (ellipsoids,
 * tapered capsules, boxes), a sampled grid they are blended into (each
 * primitive only touches the cells near its own bounds, so many small
 * primitives stay cheap), and Surface Nets meshing of the grid with smooth
 * normals from the field's gradient.
 *
 * Renderer-free and deterministic. Units: meters.
 */
import { Builder, type Weights } from "./parts";

export type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Smooth minimum (cubic polynomial, blend width k). */
export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * h * k * (1 / 6);
}

/** Smooth maximum (smooth intersection / subtraction). */
export const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);

/** An orthonormal frame: w along the main axis, u the side axis, v = w × u. */
export interface Frame {
  u: V3;
  v: V3;
  w: V3;
}

/** Frame with w along `axis` and u as close to `side` as possible. */
export function frameFrom(axis: V3, side: V3 = [1, 0, 0]): Frame {
  const w = norm(axis);
  let u = sub(side, [w[0] * dot(side, w), w[1] * dot(side, w), w[2] * dot(side, w)]);
  if (Math.hypot(...u) < 1e-6) u = Math.abs(w[1]) < 0.9 ? cross([0, 1, 0], w) : cross([1, 0, 0], w);
  u = norm(u);
  return { u, v: cross(w, u), w };
}

export interface Prim {
  /** Signed distance (negative inside). */
  d(p: V3): number;
  min: V3;
  max: V3;
  /** Tighter bounds for turned grids: within `ext` of these points (default: the box). */
  hull?: { pts: V3[]; ext: number };
}

const bounds = (c: V3, e: number): [V3, V3] => [[c[0] - e, c[1] - e, c[2] - e], [c[0] + e, c[1] + e, c[2] + e]];

/** Ellipsoid with semi-axes r (along u, v, w of `f`). */
export function ellipsoid(c: V3, f: Frame, r: V3): Prim {
  const [min, max] = bounds(c, Math.max(...r));
  const [u0, u1, u2] = f.u, [v0, v1, v2] = f.v, [w0, w1, w2] = f.w;
  const i0 = 1 / r[0], i1 = 1 / r[1], i2 = 1 / r[2], rmin = Math.min(...r);
  return {
    min,
    max,
    hull: { pts: [c], ext: Math.max(...r) },
    d(p) {
      const qx = p[0] - c[0], qy = p[1] - c[1], qz = p[2] - c[2];
      const x = (qx * u0 + qy * u1 + qz * u2) * i0, y = (qx * v0 + qy * v1 + qz * v2) * i1, z = (qx * w0 + qy * w1 + qz * w2) * i2;
      const k0 = Math.sqrt(x * x + y * y + z * z);
      const a = x * i0, b = y * i1, e = z * i2;
      const k1 = Math.sqrt(a * a + b * b + e * e);
      return k1 < 1e-12 ? -rmin : (k0 * (k0 - 1)) / k1;
    },
  };
}

/** Axis-aligned-in-world ellipsoid. */
export const blob = (c: V3, r: V3) => ellipsoid(c, AXES, r);
export const AXES: Frame = { u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] };

/**
 * Tapered capsule from a (radius ra) to b (radius rb). `flat` scales the
 * cross-section along the frame's u and v (side = u hint).
 */
export function capsule(a: V3, b: V3, ra: number, rb: number, side: V3 = [1, 0, 0], flat: [number, number] = [1, 1]): Prim {
  const axis = sub(b, a);
  const L = Math.hypot(...axis) || 1e-6;
  const f = frameFrom(axis, side);
  const ext = Math.max(ra, rb) * Math.max(1, ...flat);
  const sMin = Math.min(1, ...flat);
  const bb = (ra - rb) / L, aa = Math.sqrt(Math.max(0, 1 - bb * bb));
  const [u0, u1, u2] = f.u, [v0, v1, v2] = f.v, [w0, w1, w2] = f.w;
  const if0 = 1 / flat[0], if1 = 1 / flat[1];
  return {
    min: [0, 1, 2].map((k) => Math.min(a[k], b[k]) - ext) as V3,
    max: [0, 1, 2].map((k) => Math.max(a[k], b[k]) + ext) as V3,
    hull: { pts: [a, b], ext },
    d(p) {
      const qx = p[0] - a[0], qy = p[1] - a[1], qz = p[2] - a[2];
      const x = (qx * u0 + qy * u1 + qz * u2) * if0, y = (qx * v0 + qy * v1 + qz * v2) * if1, z = qx * w0 + qy * w1 + qz * w2;
      const r = Math.sqrt(x * x + y * y);
      const k = -r * bb + z * aa;
      let dist: number;
      if (k < 0) dist = Math.sqrt(r * r + z * z) - ra;
      else if (k > aa * L) dist = Math.sqrt(r * r + (z - L) * (z - L)) - rb;
      else dist = r * aa + z * bb - ra;
      return dist * sMin;
    },
  };
}

/** Rounded box with half extents `h` along the frame axes. */
export function box(c: V3, f: Frame, h: V3, round = 0): Prim {
  const [min, max] = bounds(c, Math.hypot(...h) + round);
  return {
    min,
    max,
    hull: { pts: [c], ext: Math.hypot(...h) + round },
    d(p) {
      const qx = p[0] - c[0], qy = p[1] - c[1], qz = p[2] - c[2];
      const x = Math.abs(qx * f.u[0] + qy * f.u[1] + qz * f.u[2]) - h[0], y = Math.abs(qx * f.v[0] + qy * f.v[1] + qz * f.v[2]) - h[1], z = Math.abs(qx * f.w[0] + qy * f.w[1] + qz * f.w[2]) - h[2];
      const ox = x > 0 ? x : 0, oy = y > 0 ? y : 0, oz = z > 0 ? z : 0;
      return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(x, y, z), 0) - round;
    },
  };
}

/** A rounded cylinder along the frame's w (half height h) with an elliptical section (rx along u, ry along v). */
export function disc(c: V3, f: Frame, rx: number, ry: number, h: number, round = 0.001): Prim {
  const ext = Math.max(rx, ry, h);
  const [min, max] = bounds(c, ext * 1.5);
  const sm = Math.min(rx, ry), kx = sm / rx, ky = sm / ry;
  return {
    min,
    max,
    hull: { pts: [c], ext: Math.hypot(Math.max(rx, ry), h) },
    d(p) {
      const qx = p[0] - c[0], qy = p[1] - c[1], qz = p[2] - c[2];
      const x = (qx * f.u[0] + qy * f.u[1] + qz * f.u[2]) * kx, y = (qx * f.v[0] + qy * f.v[1] + qz * f.v[2]) * ky, z = qx * f.w[0] + qy * f.w[1] + qz * f.w[2];
      const dx = Math.sqrt(x * x + y * y) - sm + round, dz = Math.abs(z) - h + round;
      const ox = dx > 0 ? dx : 0, oz = dz > 0 ? dz : 0;
      return Math.min(Math.max(dx, dz), 0) + Math.sqrt(ox * ox + oz * oz) - round;
    },
  };
}

/** A tube through `pts` (tapered capsules between consecutive points) with radius per point. */
export function chain(pts: V3[], radii: number[], side: V3 = [1, 0, 0], flat: [number, number] = [1, 1]): Prim[] {
  const out: Prim[] = [];
  for (let i = 0; i + 1 < pts.length; i++) out.push(capsule(pts[i], pts[i + 1], radii[i], radii[i + 1], side, flat));
  return out;
}

function hash3(i: number, j: number, k: number, seed: number): number {
  let n = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1274126177) ^ Math.imul(seed | 0, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) & 0xffff) / 32767.5 - 1;
}

/** Hash-based value noise in [-1, 1] (deterministic, smooth). */
export function noise3(x: number, y: number, z: number, seed = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const a0 = hash3(xi, yi, zi, seed), a1 = hash3(xi + 1, yi, zi, seed);
  const b0 = hash3(xi, yi + 1, zi, seed), b1 = hash3(xi + 1, yi + 1, zi, seed);
  const c0 = hash3(xi, yi, zi + 1, seed), c1 = hash3(xi + 1, yi, zi + 1, seed);
  const d0 = hash3(xi, yi + 1, zi + 1, seed), d1 = hash3(xi + 1, yi + 1, zi + 1, seed);
  const ab = a0 + (a1 - a0) * u, bb = b0 + (b1 - b0) * u, cc = c0 + (c1 - c0) * u, dd = d0 + (d1 - d0) * u;
  const lo = ab + (bb - ab) * v, hi = cc + (dd - cc) * v;
  return lo + (hi - lo) * w;
}

const FAR = 0.05;

const toLocal = (f: Frame, p: V3): V3 => [dot(p, f.u), dot(p, f.v), dot(p, f.w)];
const toWorld = (f: Frame, q: V3): V3 => [
  f.u[0] * q[0] + f.v[0] * q[1] + f.w[0] * q[2],
  f.u[1] * q[0] + f.v[1] * q[1] + f.w[1] * q[2],
  f.u[2] * q[0] + f.v[2] * q[1] + f.w[2] * q[2],
];

/** Bounds of a primitive in a frame's coordinates. */
function localBounds(f: Frame, p: Prim): [V3, V3] {
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  if (f === AXES) return [p.min, p.max];
  if (p.hull) {
    for (const pt of p.hull.pts) {
      const q = toLocal(f, pt);
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], q[k] - p.hull.ext);
        hi[k] = Math.max(hi[k], q[k] + p.hull.ext);
      }
    }
    return [lo, hi];
  }
  const { min, max } = p;
  for (let c = 0; c < 8; c++) {
    const q = toLocal(f, [c & 1 ? max[0] : min[0], c & 2 ? max[1] : min[1], c & 4 ? max[2] : min[2]]);
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], q[k]);
      hi[k] = Math.max(hi[k], q[k]);
    }
  }
  return [lo, hi];
}

/**
 * A sampled distance field over a box; primitives are blended in one by one.
 * The box may be turned (`frame`: its axes in world space), e.g. along a long
 * bone, so slanted pieces don't pay for an axis-aligned box. `min` and the
 * cells are in the frame's coordinates; primitives and results are in world space.
 */
export class Grid {
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly v: Float32Array;
  constructor(readonly min: V3, max: V3, readonly cell: number, readonly frame: Frame = AXES) {
    this.nx = Math.max(2, Math.ceil((max[0] - min[0]) / cell) + 1);
    this.ny = Math.max(2, Math.ceil((max[1] - min[1]) / cell) + 1);
    this.nz = Math.max(2, Math.ceil((max[2] - min[2]) / cell) + 1);
    this.v = new Float32Array(this.nx * this.ny * this.nz).fill(FAR);
  }

  /** A grid around the bounds of `prims` (plus `pad`). */
  static around(prims: Prim[], cell: number, pad = 0.006, frame: Frame = AXES): Grid {
    const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
    for (const p of prims) {
      const [a, b] = localBounds(frame, p);
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], a[k]);
        hi[k] = Math.max(hi[k], b[k]);
      }
    }
    const e = pad + cell * 2;
    return new Grid([lo[0] - e, lo[1] - e, lo[2] - e], [hi[0] + e, hi[1] + e, hi[2] + e], cell, frame);
  }

  /** Visits every grid point within `pad` of the primitive's bounds. */
  private each(p: Prim, pad: number, fn: (i: number, q: V3) => void) {
    const { nx, ny, nz, cell, min, frame: f } = this;
    const [lo, hi] = localBounds(f, p);
    const r = (k: number, n: number) => [Math.max(0, Math.floor((lo[k] - pad - min[k]) / cell)), Math.min(n - 1, Math.ceil((hi[k] + pad - min[k]) / cell))];
    const [x0, x1] = r(0, nx), [y0, y1] = r(1, ny), [z0, z1] = r(2, nz);
    const q: V3 = [0, 0, 0];
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++) {
        let i = (z * ny + y) * nx + x0;
        for (let x = x0; x <= x1; x++, i++) {
          const a = min[0] + x * cell, b = min[1] + y * cell, c = min[2] + z * cell;
          q[0] = f.u[0] * a + f.v[0] * b + f.w[0] * c;
          q[1] = f.u[1] * a + f.v[1] * b + f.w[1] * c;
          q[2] = f.u[2] * a + f.v[2] * b + f.w[2] * c;
          fn(i, q);
        }
      }
  }

  /** World position of a grid point. */
  private world(x: number, y: number, z: number): V3 {
    const { min, cell } = this;
    return toWorld(this.frame, [min[0] + x * cell, min[1] + y * cell, min[2] + z * cell]);
  }

  /** Smooth union with blend width k. */
  add(p: Prim, k = 0) {
    const v = this.v;
    this.each(p, k + this.cell * 2, (i, q) => (v[i] = smin(v[i], p.d(q), k)));
  }

  addAll(ps: Prim[], k = 0) {
    for (const p of ps) this.add(p, k);
  }

  /** Smooth subtraction with blend width k. */
  carve(p: Prim, k = 0) {
    const v = this.v;
    this.each(p, k + this.cell * 2, (i, q) => (v[i] = smax(v[i], -p.d(q), k)));
  }

  /** Smooth intersection with a primitive: only cells inside `p` (by its bounds) keep material. */
  clip(p: Prim, k = 0) {
    const { v, nx, ny, nz, cell } = this;
    for (let z = 0, i = 0; z < nz; z++)
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++, i++) {
          if (v[i] > cell * 3) continue;
          v[i] = smax(v[i], p.d(this.world(x, y, z)), k);
        }
  }

  /** Softens creases: each value near the surface moves towards the mean of its six neighbours. */
  smooth(amount = 0.5, band = 0.004) {
    const { v, nx, ny, nz } = this;
    const src = v.slice();
    const sy = nx, sz = nx * ny;
    for (let z = 1; z < nz - 1; z++)
      for (let y = 1; y < ny - 1; y++)
        for (let x = 1, i = (z * ny + y) * nx + 1; x < nx - 1; x++, i++) {
          const c = src[i];
          if (c > band || c < -band) continue;
          const m = (src[i - 1] + src[i + 1] + src[i - sy] + src[i + sy] + src[i - sz] + src[i + sz]) / 6;
          v[i] = c + (m - c) * amount;
        }
  }

  /** Adds `f(q)` to every value near the surface (displacement, e.g. erosion noise). */
  displace(f: (q: V3) => number, band = 0.006) {
    const { v, nx, ny, nz } = this;
    for (let z = 0, i = 0; z < nz; z++)
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++, i++) {
          if (Math.abs(v[i]) > band) continue;
          v[i] += f(this.world(x, y, z));
        }
  }

  /** Trilinear sample at a world point (FAR outside). */
  sample(p: V3): number {
    const f = this.frame;
    return this.at(p[0] * f.u[0] + p[1] * f.u[1] + p[2] * f.u[2], p[0] * f.v[0] + p[1] * f.v[1] + p[2] * f.v[2], p[0] * f.w[0] + p[1] * f.w[1] + p[2] * f.w[2]);
  }

  /** Trilinear sample at a point in the grid's frame. */
  private at(px: number, py: number, pz: number): number {
    const { nx, ny, nz, cell, min, v } = this;
    const fx = (px - min[0]) / cell, fy = (py - min[1]) / cell, fz = (pz - min[2]) / cell;
    if (fx < 0 || fy < 0 || fz < 0 || fx >= nx - 1 || fy >= ny - 1 || fz >= nz - 1) return FAR;
    const x = fx | 0, y = fy | 0, z = fz | 0;
    const a = fx - x, b = fy - y, c = fz - z;
    const i = (z * ny + y) * nx + x, sy = nx, sz = nx * ny;
    const p00 = v[i] + (v[i + 1] - v[i]) * a, p10 = v[i + sy] + (v[i + sy + 1] - v[i + sy]) * a;
    const p01 = v[i + sz] + (v[i + sz + 1] - v[i + sz]) * a, p11 = v[i + sz + sy] + (v[i + sz + sy + 1] - v[i + sz + sy]) * a;
    const q0 = p00 + (p10 - p00) * b, q1 = p01 + (p11 - p01) * b;
    return q0 + (q1 - q0) * c;
  }

  /** Unit gradient at a point in the grid's frame, written to `out`. */
  private grad(px: number, py: number, pz: number, out: Float64Array) {
    const h = this.cell * 0.75;
    const gx = this.at(px + h, py, pz) - this.at(px - h, py, pz);
    const gy = this.at(px, py + h, pz) - this.at(px, py - h, pz);
    const gz = this.at(px, py, pz + h) - this.at(px, py, pz - h);
    const l = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    out[0] = gx / l;
    out[1] = gy / l;
    out[2] = gz / l;
  }

  /** Unit gradient at a world point. */
  gradient(p: V3): V3 {
    const g = new Float64Array(3);
    const l = toLocal(this.frame, p);
    this.grad(l[0], l[1], l[2], g);
    return toWorld(this.frame, [g[0], g[1], g[2]]);
  }

  /**
   * Meshes the zero surface into `bld` (Surface Nets, vertices projected onto
   * the field, normals from its gradient), rigid on weights `w`. `shade` gives
   * the per-vertex brightness (default: a cavity term from the field).
   * Returns the number of triangles added.
   */
  mesh(bld: Builder, w: Weights, shade?: (p: V3, n: V3, cavity: number) => number): number {
    const { nx, ny, nz, cell, min, v } = this;
    const cx = nx - 1, cy = ny - 1;
    const cellVertex = new Int32Array(cx * cy * (nz - 1)).fill(-1);
    const CX = [0, 1, 0, 1, 0, 1, 0, 1], CY = [0, 0, 1, 1, 0, 0, 1, 1], CZ = [0, 0, 0, 0, 1, 1, 1, 1];
    const EA = [0, 2, 4, 6, 0, 1, 4, 5, 0, 1, 2, 3], EB = [1, 3, 5, 7, 2, 3, 6, 7, 4, 5, 6, 7];
    const off = CX.map((_, c) => CX[c] + CY[c] * nx + CZ[c] * nx * ny);
    const val = new Float64Array(8);
    const pts: number[] = [];
    for (let z = 0; z < nz - 1; z++)
      for (let y = 0; y < ny - 1; y++) {
        let i0 = (z * ny + y) * nx;
        for (let x = 0; x < nx - 1; x++, i0++) {
          let inside = 0;
          for (let c = 0; c < 8; c++) {
            const q = v[i0 + off[c]];
            val[c] = q;
            if (q < 0) inside++;
          }
          if (inside === 0 || inside === 8) continue;
          let sx = 0, sy = 0, sz = 0, n = 0;
          for (let e = 0; e < 12; e++) {
            const a = EA[e], b = EB[e];
            if (val[a] < 0 === val[b] < 0) continue;
            const t = val[a] / (val[a] - val[b]);
            sx += CX[a] + (CX[b] - CX[a]) * t;
            sy += CY[a] + (CY[b] - CY[a]) * t;
            sz += CZ[a] + (CZ[b] - CZ[a]) * t;
            n++;
          }
          cellVertex[(z * cy + y) * cx + x] = pts.length / 3;
          pts.push(min[0] + (x + sx / n) * cell, min[1] + (y + sy / n) * cell, min[2] + (z + sz / n) * cell);
        }
      }
    const count = pts.length / 3;
    if (!count) return 0;
    const cid = (x: number, y: number, z: number) => cellVertex[(z * cy + y) * cx + x];
    const tris: number[] = [];
    const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
      if (a < 0 || b < 0 || c < 0 || d < 0) return;
      if (flip) tris.push(a, d, c, a, c, b);
      else tris.push(a, b, c, a, c, d);
    };
    for (let z = 1; z < nz - 1; z++)
      for (let y = 1; y < ny - 1; y++)
        for (let x = 1; x < nx - 1; x++) {
          const i = (z * ny + y) * nx + x;
          const ain = v[i] < 0;
          if (ain !== v[i + 1] < 0) quad(cid(x, y - 1, z - 1), cid(x, y, z - 1), cid(x, y, z), cid(x, y - 1, z), !ain);
          if (ain !== v[i + nx] < 0) quad(cid(x - 1, y, z - 1), cid(x - 1, y, z), cid(x, y, z), cid(x, y, z - 1), !ain);
          if (ain !== v[i + nx * ny] < 0) quad(cid(x - 1, y - 1, z), cid(x, y - 1, z), cid(x, y, z), cid(x - 1, y, z), !ain);
        }
    // Project onto the surface (two Newton steps on the sampled field).
    const f = this.frame;
    const g = new Float64Array(3);
    const base = bld.count;
    const r = Math.max(cell * 2, 0.003);
    for (let k = 0; k < count; k++) {
      let px = pts[k * 3], py = pts[k * 3 + 1], pz = pts[k * 3 + 2];
      for (let s = 0; s < 2; s++) {
        const d = this.at(px, py, pz);
        this.grad(px, py, pz, g);
        const step = d < -cell ? -cell : d > cell ? cell : d;
        px -= g[0] * step;
        py -= g[1] * step;
        pz -= g[2] * step;
      }
      this.grad(px, py, pz, g);
      // Cavity: how much material lies just outside along the normal (0 open, 1 enclosed), at three scales (crevices to sockets).
      let cavity = 0;
      for (let j = 0; j < 3; j++) {
        const rr = r * (j === 0 ? 1 : j === 1 ? 3 : 7);
        const open = this.at(px + g[0] * rr, py + g[1] * rr, pz + g[2] * rr) / rr;
        cavity = Math.max(cavity, (open > 1 ? 0 : open < 0 ? 1 : 1 - open) * (j === 0 ? 1 : j === 1 ? 0.9 : 0.8));
      }
      const wp: V3 = [f.u[0] * px + f.v[0] * py + f.w[0] * pz, f.u[1] * px + f.v[1] * py + f.w[1] * pz, f.u[2] * px + f.v[2] * py + f.w[2] * pz];
      const wn: V3 = [f.u[0] * g[0] + f.v[0] * g[1] + f.w[0] * g[2], f.u[1] * g[0] + f.v[1] * g[1] + f.w[1] * g[2], f.u[2] * g[0] + f.v[2] * g[1] + f.w[2] * g[2]];
      const s = shade ? shade(wp, wn, cavity) : 1 - cavity * 0.5;
      bld.vert(wp, wn, 0, 0, s, w);
    }
    for (const t of tris) bld.idx.push(base + t);
    return tris.length / 3;
  }
}

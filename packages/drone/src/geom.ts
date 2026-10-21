/**
 * Hard-surface mesh primitives for the drone parts: rounded boxes,
 * superellipsoids, lathes (revolved profiles), sweeps (lofted cross sections),
 * extruded plates and helpers to place them. Everything is plain arrays so it
 * runs anywhere; the three.js adapter turns them into BufferGeometry.
 */
import { type Q4, type V3, Q_ID, add, cross, dot, len, mul, norm, qRot, spow, sub } from "./math";

export interface Geom {
  p: number[];
  n: number[];
  i: number[];
  /** Optional 0..1 value per vertex (0 at the base of an exhaust plume or beam, 1 at its tip). */
  f?: number[];
}

/** Translation, rotation, scale (applied scale first). */
export interface Xf {
  p?: V3;
  q?: Q4;
  s?: V3 | number;
}

export const empty = (): Geom => ({ p: [], n: [], i: [] });

/** Appends `src` transformed by `xf` to `dst`. */
export function append(dst: Geom, src: Geom, xf: Xf = {}): Geom {
  const base = dst.p.length / 3;
  const q = xf.q ?? Q_ID;
  const t = xf.p ?? [0, 0, 0];
  const s: V3 = typeof xf.s === "number" ? [xf.s, xf.s, xf.s] : (xf.s ?? [1, 1, 1]);
  for (let k = 0; k < src.p.length; k += 3) {
    const v = qRot(q, [src.p[k] * s[0], src.p[k + 1] * s[1], src.p[k + 2] * s[2]]);
    dst.p.push(v[0] + t[0], v[1] + t[1], v[2] + t[2]);
    const nn = norm(qRot(q, [src.n[k] / s[0], src.n[k + 1] / s[1], src.n[k + 2] / s[2]]));
    dst.n.push(nn[0], nn[1], nn[2]);
  }
  const flip = s[0] * s[1] * s[2] < 0;
  for (let k = 0; k < src.i.length; k += 3) {
    if (flip) dst.i.push(src.i[k] + base, src.i[k + 2] + base, src.i[k + 1] + base);
    else dst.i.push(src.i[k] + base, src.i[k + 1] + base, src.i[k + 2] + base);
  }
  if (src.f || dst.f) {
    dst.f ??= new Array(base).fill(0);
    for (let k = 0; k < src.p.length / 3; k++) dst.f.push(src.f ? src.f[k] : 0);
  }
  return dst;
}

const vert = (g: Geom, k: number): V3 => [g.p[3 * k], g.p[3 * k + 1], g.p[3 * k + 2]];
const nrm = (g: Geom, k: number): V3 => [g.n[3 * k], g.n[3 * k + 1], g.n[3 * k + 2]];

/** Flips triangles whose winding disagrees with their vertex normals. */
export function orientToNormals(g: Geom): Geom {
  for (let k = 0; k < g.i.length; k += 3) {
    const [a, b, c] = [g.i[k], g.i[k + 1], g.i[k + 2]];
    const fn = cross(sub(vert(g, b), vert(g, a)), sub(vert(g, c), vert(g, a)));
    const vn = add(add(nrm(g, a), nrm(g, b)), nrm(g, c));
    if (dot(fn, vn) < 0) {
      g.i[k + 1] = c;
      g.i[k + 2] = b;
    }
  }
  return g;
}

/** Smooth vertex normals from the triangles (area weighted). */
export function computeNormals(g: Geom): Geom {
  const n = new Array(g.p.length).fill(0);
  for (let k = 0; k < g.i.length; k += 3) {
    const [a, b, c] = [g.i[k], g.i[k + 1], g.i[k + 2]];
    const fn = cross(sub(vert(g, b), vert(g, a)), sub(vert(g, c), vert(g, a)));
    for (const v of [a, b, c]) for (let d = 0; d < 3; d++) n[3 * v + d] += fn[d];
  }
  for (let k = 0; k < n.length; k += 3) {
    const v = norm([n[k], n[k + 1], n[k + 2]]);
    n[k] = v[0];
    n[k + 1] = v[1];
    n[k + 2] = v[2];
  }
  g.n = n;
  return g;
}

/** Flips a closed mesh inside out when its signed volume is negative. */
function orientOutward(g: Geom): Geom {
  let vol = 0;
  for (let k = 0; k < g.i.length; k += 3) {
    vol += dot(vert(g, g.i[k]), cross(vert(g, g.i[k + 1]), vert(g, g.i[k + 2])));
  }
  if (vol < 0) for (let k = 0; k < g.i.length; k += 3) [g.i[k + 1], g.i[k + 2]] = [g.i[k + 2], g.i[k + 1]];
  return g;
}

/** Quads of a (cols+1) x (rows+1) vertex grid starting at `base`. */
function grid(g: Geom, base: number, cols: number, rows: number, wrapCols = false): void {
  const stride = wrapCols ? cols : cols + 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const c1 = wrapCols ? (c + 1) % cols : c + 1;
      const a = base + r * stride + c, b = base + r * stride + c1, d = base + (r + 1) * stride + c, e = base + (r + 1) * stride + c1;
      g.i.push(a, b, e, a, e, d);
    }
  }
}

function samples(h: number, r: number, s: number, inner: number): number[] {
  if (r <= 1e-6) {
    const out = [];
    for (let k = 0; k <= inner; k++) out.push(-h + (2 * h * k) / inner);
    return out;
  }
  const c = h - r;
  const out: number[] = [];
  for (let k = s; k >= 1; k--) out.push(-c - r * Math.tan(((k / s) * Math.PI) / 4));
  for (let k = 0; k <= inner; k++) out.push(-c + (2 * c * k) / inner);
  for (let k = 1; k <= s; k++) out.push(c + r * Math.tan(((k / s) * Math.PI) / 4));
  return out;
}

/** Box of size w x h x d with edges rounded by radius r (r = 0: sharp box). */
export function box(w: number, h: number, d: number, r = 0, segs = 2): Geom {
  const H: V3 = [w / 2, h / 2, d / 2];
  r = Math.min(r, H[0] * 0.98, H[1] * 0.98, H[2] * 0.98);
  const g = empty();
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3, c = (a + 2) % 3;
    const Sb = samples(H[b], r, segs, 1), Sc = samples(H[c], r, segs, 1);
    for (const sg of [1, -1]) {
      const base = g.p.length / 3;
      for (const uc of Sc) {
        for (const ub of Sb) {
          const P: V3 = [0, 0, 0];
          P[a] = sg * H[a];
          P[b] = ub;
          P[c] = uc;
          if (r > 1e-6) {
            const q: V3 = [0, 0, 0];
            for (let d = 0; d < 3; d++) q[d] = Math.max(-(H[d] - r), Math.min(H[d] - r, P[d]));
            const n = norm(sub(P, q));
            const pos = add(q, mul(n, r));
            g.p.push(...pos);
            g.n.push(...n);
          } else {
            const n: V3 = [0, 0, 0];
            n[a] = sg;
            g.p.push(...P);
            g.n.push(...n);
          }
        }
      }
      grid(g, base, Sb.length - 1, Sc.length - 1);
    }
  }
  return orientToNormals(g);
}

/**
 * Superellipsoid with radii rx, ry, rz; e1 shapes the vertical profile and
 * e2 the horizontal one (1 = ellipsoid, < 1 boxier, > 1 pinched).
 * `vMin`/`vMax` (-1..1) cut it to a band (0..1 = upper half).
 */
export function superellipsoid(rx: number, ry: number, rz: number, e1 = 1, e2 = 1, su = 32, sv = 16, vMin = -1, vMax = 1): Geom {
  const g = empty();
  for (let j = 0; j <= sv; j++) {
    const v = ((vMin + ((vMax - vMin) * j) / sv) * Math.PI) / 2;
    for (let i = 0; i < su; i++) {
      const u = -Math.PI + (2 * Math.PI * i) / su;
      const cv = Math.cos(v), sn = Math.sin(v), cu = Math.cos(u), snu = Math.sin(u);
      g.p.push(rx * spow(cv, e1) * spow(cu, e2), ry * spow(sn, e1), rz * spow(cv, e1) * spow(snu, e2));
      let n: V3 = [(spow(cv, 2 - e1) * spow(cu, 2 - e2)) / rx, spow(sn, 2 - e1) / ry, (spow(cv, 2 - e1) * spow(snu, 2 - e2)) / rz];
      if (len(n) < 1e-9) n = [0, Math.sign(sn) || 1, 0];
      g.n.push(...norm(n));
    }
  }
  grid(g, 0, su, sv, true);
  return orientToNormals(g);
}

export interface ProfilePoint {
  r: number;
  y: number;
  /** A crease here (separate normals on both sides). */
  sharp?: boolean;
}

/**
 * Revolves a profile in the (r, y) plane around +Y. Walk the profile
 * counter-clockwise (outer wall upwards) so the normals point outwards.
 */
export function lathe(profile: ProfilePoint[], seg = 32, closed = false): Geom {
  const src = closed ? [...profile, profile[0]] : profile;
  const segN = (a: ProfilePoint, b: ProfilePoint): [number, number] => {
    const dr = b.r - a.r, dy = b.y - a.y;
    const l = Math.hypot(dr, dy) || 1;
    return [dy / l, -dr / l];
  };
  const avg = (a: [number, number], b: [number, number]): [number, number] => {
    const l = Math.hypot(a[0] + b[0], a[1] + b[1]) || 1;
    return [(a[0] + b[0]) / l, (a[1] + b[1]) / l];
  };
  // One ring per point; sharp points get two rings (one normal per side) with no faces between them.
  const rings: { r: number; y: number; n: [number, number]; join: boolean }[] = [];
  const last = src.length - 1;
  for (let k = 0; k <= last; k++) {
    const p = src[k];
    const prev = k > 0 ? segN(src[k - 1], p) : closed ? segN(src[last - 1], src[last]) : null;
    const next = k < last ? segN(p, src[k + 1]) : closed ? segN(src[0], src[1]) : null;
    const sharp = closed && (k === 0 || k === last) ? !!src[0].sharp : !!p.sharp;
    if (sharp && prev && next) {
      if (k > 0) rings.push({ r: p.r, y: p.y, n: prev, join: true });
      if (k < last) rings.push({ r: p.r, y: p.y, n: next, join: k === 0 });
    } else {
      rings.push({ r: p.r, y: p.y, n: prev && next ? avg(prev, next) : (prev ?? next ?? [1, 0]), join: k > 0 });
    }
  }
  const g = empty();
  for (const ring of rings) {
    for (let s = 0; s < seg; s++) {
      const a = (2 * Math.PI * s) / seg;
      const c = Math.cos(a), sn = Math.sin(a);
      g.p.push(ring.r * c, ring.y, ring.r * sn);
      g.n.push(ring.n[0] * c, ring.n[1], ring.n[0] * sn);
    }
  }
  for (let k = 1; k < rings.length; k++) {
    if (!rings[k].join) continue;
    for (let s = 0; s < seg; s++) {
      const s1 = (s + 1) % seg;
      const a = (k - 1) * seg + s, b = (k - 1) * seg + s1, d = k * seg + s, e = k * seg + s1;
      g.i.push(a, b, e, a, e, d);
    }
  }
  return orientToNormals(g);
}

/** Closed rounded rectangle in the (r, y) plane, counter-clockwise, for `lathe(..., true)`. */
export function roundedRect(r0: number, r1: number, y0: number, y1: number, cr: number, segs = 3): ProfilePoint[] {
  cr = Math.min(cr, (r1 - r0) / 2 - 1e-5, (y1 - y0) / 2 - 1e-5);
  const out: ProfilePoint[] = [];
  const corners: [number, number, number][] = [
    [r1 - cr, y0 + cr, -90],
    [r1 - cr, y1 - cr, 0],
    [r0 + cr, y1 - cr, 90],
    [r0 + cr, y0 + cr, 180],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let k = 0; k <= segs; k++) {
      const a = ((a0 + (90 * k) / segs) * Math.PI) / 180;
      out.push({ r: cx + cr * Math.cos(a), y: cy + cr * Math.sin(a) });
    }
  }
  return out;
}

export interface Section {
  /** Centre of the cross section. */
  o: V3;
  /** Width axis (unit). */
  u: V3;
  /** Height axis (unit). */
  v: V3;
  /** Half width. */
  w: number;
  /** Half height above and below the centre. */
  up: number;
  down: number;
  /** Superellipse exponent: 2 = ellipse, 4+ = rounded rectangle. */
  n?: number;
}

/** Lofts superellipse cross sections into a closed tube with end caps. */
export function sweep(sections: Section[], seg = 24, caps = true): Geom {
  const g = empty();
  for (const s of sections) {
    const e = 2 / (s.n ?? 2);
    for (let k = 0; k < seg; k++) {
      const a = (2 * Math.PI * k) / seg;
      const x = s.w * spow(Math.cos(a), e);
      const sn = Math.sin(a);
      const y = (sn >= 0 ? s.up : s.down) * spow(sn, e);
      g.p.push(s.o[0] + s.u[0] * x + s.v[0] * y, s.o[1] + s.u[1] * x + s.v[1] * y, s.o[2] + s.u[2] * x + s.v[2] * y);
    }
  }
  grid(g, 0, seg, sections.length - 1, true);
  if (caps) {
    for (const end of [0, sections.length - 1]) {
      const s = sections[end];
      const c = g.p.length / 3;
      g.p.push(...s.o);
      for (let k = 0; k < seg; k++) {
        const a = end * seg + k, b = end * seg + ((k + 1) % seg);
        g.i.push(c, b, a);
      }
    }
  }
  orientOutward(g);
  computeNormals(g);
  return g;
}

/** Straight (optionally tapered) beam from a to b with a superellipse section. */
export function beam(a: V3, b: V3, w0: number, h0: number, w1 = w0, h1 = h0, n = 4, up: V3 = [0, 1, 0], seg = 16): Geom {
  const d = norm(sub(b, a));
  let v = sub(up, mul(d, dot(up, d)));
  if (len(v) < 1e-4) v = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
  v = norm(v);
  const u = norm(cross(v, d));
  return sweep(
    [
      { o: a, u, v, w: w0 / 2, up: h0 / 2, down: h0 / 2, n },
      { o: b, u, v, w: w1 / 2, up: h1 / 2, down: h1 / 2, n },
    ],
    seg,
  );
}

/** Convex outline in the XZ plane extruded along Y (flat plates, fins, wings). */
export function plate(outline: [number, number][], thickness: number, bevel = 0): Geom {
  const g = empty();
  const t = thickness / 2;
  const cx = outline.reduce((s, p) => s + p[0], 0) / outline.length;
  const cz = outline.reduce((s, p) => s + p[1], 0) / outline.length;
  // Top and bottom, slightly inset when bevelled so the rim catches light.
  for (const sg of [1, -1]) {
    const base = g.p.length / 3;
    for (const [x, z] of outline) {
      g.p.push(x + (cx - x) * bevel, sg * t, z + (cz - z) * bevel);
      g.n.push(0, sg, 0);
    }
    for (let k = 1; k < outline.length - 1; k++) g.i.push(base, base + k, base + k + 1);
  }
  for (let k = 0; k < outline.length; k++) {
    const [x0, z0] = outline[k], [x1, z1] = outline[(k + 1) % outline.length];
    let n: V3 = norm([z1 - z0, 0, -(x1 - x0)]);
    if (dot(n, [(x0 + x1) / 2 - cx, 0, (z0 + z1) / 2 - cz]) < 0) n = mul(n, -1);
    const base = g.p.length / 3;
    const ys = bevel > 0 ? [t, t * 0.4, -t * 0.4, -t] : [t, -t];
    for (const y of ys) {
      const inset = bevel > 0 && Math.abs(y) === t ? bevel : 0;
      const nn = bevel > 0 && Math.abs(y) === t ? norm(add(n, [0, Math.sign(y) * 0.8, 0])) : n;
      g.p.push(x0 + (cx - x0) * inset, y, z0 + (cz - z0) * inset, x1 + (cx - x1) * inset, y, z1 + (cz - z1) * inset);
      g.n.push(...nn, ...nn);
    }
    for (let r = 0; r < ys.length - 1; r++) {
      const a = base + 2 * r;
      g.i.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }
  return orientToNormals(g);
}

/** Cylinder along +Y, centred, with sharp rims. */
export const cylinder = (r: number, h: number, seg = 24, r2 = r): Geom =>
  lathe(
    [
      { r: 0, y: -h / 2 },
      { r, y: -h / 2, sharp: true },
      { r: r2, y: h / 2, sharp: true },
      { r: 0, y: h / 2 },
    ],
    seg,
  );

/** Torus around +Y with a round tube. */
export function torus(R: number, r: number, seg = 40, tube = 10): Geom {
  const prof: ProfilePoint[] = [];
  for (let k = 0; k < tube; k++) {
    const a = -Math.PI / 2 + (2 * Math.PI * k) / tube;
    prof.push({ r: R + r * Math.cos(a), y: r * Math.sin(a) });
  }
  return lathe(prof, seg, true);
}

/** Cone along -Y from radius r at y = 0 to a point at y = -h, with a 0..1 fade attribute (plumes, beams). */
export function plume(r: number, h: number, seg = 20, rTip = 0): Geom {
  const g = empty();
  g.f = [];
  const rows = 6;
  for (let k = 0; k <= rows; k++) {
    const t = k / rows;
    const rr = r + (rTip - r) * t;
    for (let s = 0; s < seg; s++) {
      const a = (2 * Math.PI * s) / seg;
      g.p.push(rr * Math.cos(a), -h * t, rr * Math.sin(a));
      g.n.push(...norm([Math.cos(a) * h, r - rTip, Math.sin(a) * h]));
      g.f.push(t);
    }
  }
  grid(g, 0, seg, rows, true);
  return orientToNormals(g);
}

/** Triangle count of a geometry. */
export const tris = (g: Geom): number => g.i.length / 3;

/** Ray / mesh intersection (Möller–Trumbore): nearest hit and the face normal. */
export function raycast(g: Geom, origin: V3, dir: V3): { p: V3; n: V3; t: number } | null {
  let best: { p: V3; n: V3; t: number } | null = null;
  for (let k = 0; k < g.i.length; k += 3) {
    const a = vert(g, g.i[k]), b = vert(g, g.i[k + 1]), c = vert(g, g.i[k + 2]);
    const e1 = sub(b, a), e2 = sub(c, a);
    const h = cross(dir, e2);
    const det = dot(e1, h);
    if (Math.abs(det) < 1e-12) continue;
    const f = 1 / det;
    const s = sub(origin, a);
    const u = f * dot(s, h);
    if (u < 0 || u > 1) continue;
    const q = cross(s, e1);
    const v = f * dot(dir, q);
    if (v < 0 || u + v > 1) continue;
    const t = f * dot(e2, q);
    if (t > 1e-6 && (!best || t < best.t)) {
      let n = norm(cross(e1, e2));
      if (dot(n, dir) > 0) n = mul(n, -1);
      best = { p: add(origin, mul(dir, t)), n, t };
    }
  }
  return best;
}

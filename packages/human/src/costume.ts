/**
 * Hero costume parts, generated from the current body shape like the race add-ons in parts.ts:
 * a cape (with a collar) on a chain of bones so it can swing, masks (domino, bandit, cowl), a
 * belt (plain, with a buckle, or a utility belt with pouches) and a raised chest emblem.
 *
 * Masks, belts, buckles and emblems are shells cut from the body surface: the body triangles of
 * a region, subdivided, cut cleanly along a signed field (an iso-line, so the edge does not follow
 * the mesh), lifted off the skin and given a thin edge wall. The emblem plate's outline is the
 * same field as its texture (emblem.ts). The cape is draped over the back: at each height it lies
 * just outside the furthest-back point of the body above it, as cloth hangs, with flare and folds.
 *
 * Renderer-free and deterministic (no randomness at all); actors-human `costume.rs` mirrors it.
 */
import type { PartBone, PartMesh } from "@actors/core";
import { Builder, NO_ANCHOR, type PartsBody, type Weights } from "./parts";
import { type EmblemShape, type EmblemSymbol, EMBLEM_SHAPES, EMBLEM_SYMBOLS, plateDistance } from "./emblem";

export type CapeStyle = "none" | "short" | "classic" | "long" | "scalloped" | "pointed";
export type CollarStyle = "none" | "standing" | "flared";
export type MaskStyle = "none" | "domino" | "bandit" | "cowl";
export type BeltStyle = "none" | "plain" | "buckle" | "utility";

export const CAPE_STYLES: CapeStyle[] = ["none", "short", "classic", "long", "scalloped", "pointed"];
export const COLLAR_STYLES: CollarStyle[] = ["none", "standing", "flared"];
export const MASK_STYLES: MaskStyle[] = ["none", "domino", "bandit", "cowl"];
export const BELT_STYLES: BeltStyle[] = ["none", "plain", "buckle", "utility"];
export { EMBLEM_SHAPES, EMBLEM_SYMBOLS };

type RGB = [number, number, number];

/** The costume pieces of a character (colours sRGB 0..1). */
export interface CostumeParts {
  cape: CapeStyle;
  /** A collar on the cape (no cape, no collar). */
  collar: CollarStyle;
  capeColor: RGB;
  liningColor: RGB;
  mask: MaskStyle;
  maskColor: RGB;
  belt: BeltStyle;
  beltColor: RGB;
  buckleColor: RGB;
  emblem: EmblemShape;
  /** The symbol on the emblem; a "cutout" emblem has the symbol's outline. */
  symbol: EmblemSymbol;
  /** 0..1 */
  emblemSize: number;
  /** Colour of the emblem's raised rim. */
  rimColor: RGB;
}

/** Cape bone chains (right, centre, left as the wearer sees them), each root to hem. */
export const CAPE_CHAINS = ["r", "c", "l"] as const;
export const CAPE_LINKS = 5;
export const CAPE_BONES = CAPE_CHAINS.flatMap((s) => Array.from({ length: CAPE_LINKS }, (_, k) => `cape_${s}_${k + 1}`));

/** True if the costume adds any part. */
export function hasCostume(c: CostumeParts | undefined): boolean {
  return !!c && (c.cape !== "none" || c.mask !== "none" || c.belt !== "none" || c.emblem !== "none");
}

/** A cowl covers the head: the hair (and brows) under it are not drawn. */
export function costumeHidesHair(c: CostumeParts | undefined): boolean {
  return !!c && c.mask === "cowl";
}

type V3 = [number, number, number];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** What the costume builders read from the body. */
interface Body {
  b: PartsBody;
  n: number;
  /** Dominant bone per base vertex (-1 off the body surface). */
  dom: Int32Array;
  bone: (name: string) => number;
  head: (name: string) => V3;
  /** Eye midpoint and eye distance (face coordinates). */
  mid: V3;
  ipd: number;
  height: number;
}

function bodyOf(b: PartsBody): Body {
  const n = b.positions.length / 3;
  const dom = new Int32Array(n).fill(-1);
  let top = -Infinity, bottom = Infinity;
  for (let v = 0; v < n; v++) {
    if (!b.isBody[v]) continue;
    let best = 0;
    for (let k = 1; k < 4; k++) if (b.weights[v * 4 + k] > b.weights[v * 4 + best]) best = k;
    dom[v] = b.joints[v * 4 + best];
    top = Math.max(top, b.positions[v * 3 + 1]);
    bottom = Math.min(bottom, b.positions[v * 3 + 1]);
  }
  const names = b.skeleton.names;
  const bone = (name: string) => Math.max(0, names.indexOf(name));
  const head = (name: string): V3 => [...b.skeleton.heads[bone(name)]] as V3;
  const [eL, eR] = b.eyes;
  return { b, n, dom, bone, head, mid: mul(add(eL, eR), 0.5), ipd: len(sub(eL, eR)) || 0.064, height: top - bottom };
}

const at = (a: Float32Array, v: number): V3 => [a[v * 3], a[v * 3 + 1], a[v * 3 + 2]];

/** Skin weights as up to four [bone, weight] pairs, heaviest first (ties: lower bone first). */
function top4(w: Map<number, number>): Weights {
  const list = [...w.entries()].filter(([, x]) => x > 1e-6).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  return list.slice(0, 4);
}

// ------------------------------------------------------------------ shells cut from the body

/** A point of a shell: on the body surface, with its skinning and the base vertex it follows. */
interface SV {
  p: V3;
  n: V3;
  w: Map<number, number>;
  a: number;
  key: string;
}

interface ShellOpts {
  /** Base vertices the shell may cover (all three corners of a triangle must). */
  pick: (v: number) => boolean;
  /** Signed field in meters: > 0 on the shell. */
  value: (p: V3, n: V3) => number;
  /** Lift off the skin (m). */
  offset: number;
  /** Midpoint subdivisions of the body triangles before cutting. */
  subdiv: number;
  /** Depth of the edge wall toward the skin (m); 0 for none. */
  rim: number;
  uv?: (p: V3) => [number, number];
  /** Follow face morphs (masks): each vertex follows its nearest base vertex. */
  follow?: boolean;
  shade?: number;
  /** A stiff plate: no vertex of the shell's face lies behind this depth at (x, y). */
  front?: (x: number, y: number) => number;
}

const mix = (a: SV, b: SV, t: number, key: string): SV => {
  const w = new Map<number, number>();
  for (const [j, x] of a.w) w.set(j, (w.get(j) ?? 0) + x * (1 - t));
  for (const [j, x] of b.w) w.set(j, (w.get(j) ?? 0) + x * t);
  return { p: add(a.p, mul(sub(b.p, a.p), t)), n: norm(add(mul(a.n, 1 - t), mul(b.n, t))), w, a: t < 0.5 ? a.a : b.a, key };
};

function baseSV(B: Body, v: number): SV {
  const w = new Map<number, number>();
  for (let k = 0; k < 4; k++) {
    const x = B.b.weights[v * 4 + k];
    if (x > 0) w.set(B.b.joints[v * 4 + k], (w.get(B.b.joints[v * 4 + k]) ?? 0) + x);
  }
  return { p: at(B.b.positions, v), n: norm(at(B.b.normals, v)), w, a: v, key: `${v}` };
}

/** Cuts a shell from the body (see ShellOpts) into `out`. */
function shell(B: Body, out: Builder, o: ShellOpts) {
  const tris = B.b.triangles;
  const base = new Map<number, SV>();
  const sv = (v: number) => {
    let s = base.get(v);
    if (!s) base.set(v, (s = baseSV(B, v)));
    return s;
  };
  const values = new Map<string, number>();
  const value = (s: SV) => {
    let x = values.get(s.key);
    if (x === undefined) values.set(s.key, (x = o.value(s.p, s.n)));
    return x;
  };
  const mids = new Map<string, SV>();
  const mid = (a: SV, b: SV) => {
    const [p, q] = a.key < b.key ? [a, b] : [b, a];
    const key = `${p.key}|${q.key}`;
    let m = mids.get(key);
    if (!m) mids.set(key, (m = mix(p, q, 0.5, key)));
    return m;
  };
  const index = new Map<string, number>();
  const start = out.count;
  const emit = (s: SV) => {
    let i = index.get(s.key);
    if (i !== undefined) return i;
    i = out.count;
    index.set(s.key, i);
    const uv = o.uv ? o.uv(s.p) : [0.5, 0.5];
    out.follow = o.follow ? s.a : NO_ANCHOR;
    const p = add(s.p, mul(s.n, o.offset));
    if (o.front) p[2] = Math.max(p[2], o.front(p[0], p[1]));
    out.vert(p, s.n, uv[0], uv[1], o.shade ?? 1, top4(s.w));
    return i;
  };
  const tri: number[] = [];
  const cut = (a: SV, b: SV): SV => {
    const [p, q] = a.key < b.key ? [a, b] : [b, a];
    const vp = value(p), vq = value(q);
    return mix(p, q, vp / (vp - vq), `${p.key}~${q.key}`);
  };
  const clip = (t: SV[]) => {
    const poly: SV[] = [];
    for (let i = 0; i < 3; i++) {
      const a = t[i], b = t[(i + 1) % 3];
      const va = value(a), vb = value(b);
      if (va >= 0) poly.push(a);
      if (va >= 0 !== vb >= 0) poly.push(cut(a, b));
    }
    if (poly.length < 3) return;
    const ids = poly.map(emit);
    for (let i = 1; i + 1 < ids.length; i++) tri.push(ids[0], ids[i], ids[i + 1]);
  };
  const split = (t: SV[], depth: number) => {
    if (depth === 0) return clip(t);
    const [a, b, c] = t, ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    split([a, ab, ca], depth - 1);
    split([ab, b, bc], depth - 1);
    split([ca, bc, c], depth - 1);
    split([ab, bc, ca], depth - 1);
  };
  for (let t = 0; t < tris.length; t += 3) {
    const v = [tris[t], tris[t + 1], tris[t + 2]];
    if (!v.every((x) => B.b.isBody[x] && o.pick(x))) continue;
    const s = v.map(sv);
    if (Math.max(...s.map(value)) < -0.03) continue;
    split(s, o.subdiv);
  }
  out.idx.push(...tri);
  if (o.rim > 0) edgeWall(out, tri, start, o.rim);
}

/** A wall down from the open edges of the triangles `tri` (vertex indices into `b`). */
function edgeWall(b: Builder, tri: number[], start: number, depth: number) {
  const count = new Map<string, number>();
  const key = (i: number, j: number) => (i < j ? `${i},${j}` : `${j},${i}`);
  for (let t = 0; t < tri.length; t += 3) for (let k = 0; k < 3; k++) count.set(key(tri[t + k], tri[t + ((k + 1) % 3)]), (count.get(key(tri[t + k], tri[t + ((k + 1) % 3)])) ?? 0) + 1);
  const P = (i: number): V3 => [b.pos[i * 3], b.pos[i * 3 + 1], b.pos[i * 3 + 2]];
  const N = (i: number): V3 => [b.nrm[i * 3], b.nrm[i * 3 + 1], b.nrm[i * 3 + 2]];
  const W = (i: number): Weights => {
    const w: Weights = [];
    for (let k = 0; k < 4; k++) if (b.jw[i * 4 + k] > 0) w.push([b.ji[i * 4 + k], b.jw[i * 4 + k]]);
    return w;
  };
  for (let t = 0; t < tri.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const i = tri[t + k], j = tri[t + ((k + 1) % 3)];
      if (i < start || j < start || count.get(key(i, j)) !== 1) continue;
      const e = sub(P(j), P(i));
      const nAvg = norm(add(N(i), N(j)));
      const side = norm(cross(e, nAvg));
      const q = b.count;
      for (const [v, down] of [[i, 0], [i, 1], [j, 1], [j, 0]] as const) {
        b.follow = b.anchor[v];
        b.vert(add(P(v), mul(N(v), -depth * down)), side, b.uv[v * 2], b.uv[v * 2 + 1], b.shade[v] * 0.82, W(v));
      }
      b.idx.push(q, q + 1, q + 3, q + 3, q + 1, q + 2);
    }
}

// ------------------------------------------------------------------ masks

const isArm = (name: string) => /^(clavicle|upperarm|lowerarm|hand|index|middle|ring|pinky|thumb)/.test(name);

/** Face coordinates: (p - eye midpoint) / eye distance, z forward. */
const faceOf = (B: Body, p: V3): V3 => mul(sub(p, B.mid), 1 / B.ipd);

/** Distance outside an eye hole (face units, > 0 outside) for either eye. */
function eyeHoles(f: V3, rx: number, ry: number): number {
  const d = (cx: number) => Math.hypot((f[0] - cx) / rx, (f[1] - 0.03) / ry) - 1;
  // Only in the face: the back of the head at eye height has no holes.
  return f[2] < -0.6 ? 1 : Math.min(d(0.5), d(-0.5)) * Math.min(rx, ry);
}

function buildMask(B: Body, style: MaskStyle, out: Builder) {
  const head = B.bone("head"), neck = B.bone("neck_01");
  const neckBase = B.head("neck_01");
  const spine = B.bone("spine_03");
  // The head and neck, and the top of the back the neck's edge runs over.
  const onHead = (v: number) => B.dom[v] === head || B.dom[v] === neck || (B.dom[v] === spine && B.b.positions[v * 3 + 1] > neckBase[1] - 0.05);
  const k = B.ipd;
  if (style === "domino" || style === "bandit") {
    const value = (p: V3) => {
      const f = faceOf(B, p);
      const ax = Math.abs(f[0]);
      let band: number;
      if (style === "domino") {
        // Swept-up wings at the temples, a dip under each eye and a narrow bridge over the nose.
        const top = 0.36 + 0.3 * smoothstep(0.55, 1.4, ax) - 0.06 * smoothstep(0.35, 0, ax);
        const bottom = -0.3 - 0.12 * smoothstep(0.15, 0.5, ax) * (1 - smoothstep(0.75, 1.25, ax)) + 0.42 * smoothstep(0.9, 1.45, ax) + 0.05 * smoothstep(0.2, 0, ax);
        band = Math.min(f[1] - bottom, top - f[1], 1.5 - ax, f[2] + 1.1);
      } else {
        // A cloth band all round the head.
        band = Math.min(f[1] + 0.34, 0.42 - f[1]);
      }
      return Math.min(band, eyeHoles(f, 0.3, 0.2)) * k;
    };
    shell(B, out, { pick: onHead, value, offset: 0.0045, subdiv: 1, rim: 0.0035, follow: true });
    if (style === "bandit") banditTails(B, out);
    return;
  }
  // Cowl: the whole head and neck but the eyes and the lower face, down to the base of the neck.
  const value = (p: V3) => {
    const f = faceOf(B, p);
    // The lower face is open where it is inside the ellipse and in front of the jaw.
    const mouth = Math.hypot(f[0] / 0.95, (f[1] + 1.42) / 0.72) - 1;
    const front = f[2] + 0.55;
    return Math.min(Math.max(mouth * 0.7, -front * 0.5), eyeHoles(f, 0.34, 0.24), (p[1] - (neckBase[1] - 0.012)) / k) * k;
  };
  shell(B, out, { pick: onHead, value, offset: 0.0055, subdiv: 0, rim: 0.004, follow: true });
}

/** The knot and two tails of a bandit mask at the back of the head. */
function banditTails(B: Body, out: Builder) {
  const head = B.bone("head"), neck = B.bone("neck_01");
  // The back of the head at eye height.
  let best = -1, bz = Infinity;
  for (let v = 0; v < B.n; v++) {
    if (!B.b.isBody[v] || B.dom[v] !== head) continue;
    const p = at(B.b.positions, v);
    if (Math.abs(p[0]) > 0.02 || Math.abs(p[1] - B.mid[1]) > 0.015) continue;
    if (p[2] < bz) {
      bz = p[2];
      best = v;
    }
  }
  if (best < 0) return;
  const knot: V3 = [0, B.mid[1], bz - 0.012];
  for (const s of [-1, 1]) {
    const pts: V3[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pts.push(add(knot, [s * (0.01 + 0.035 * t), -0.16 * t - 0.02 * t * t, -0.025 * Math.sin(t * Math.PI) - 0.01 * t]));
    }
    const base = out.count;
    for (let i = 0; i < pts.length; i++) {
      const t = i / (pts.length - 1);
      const w: Weights = [[head, 1 - 0.6 * t], [neck, 0.6 * t]];
      const width = 0.022 * (1 - 0.3 * t);
      const side: V3 = norm([1, 0, s * 0.3]);
      const nrm: V3 = norm(cross(side, [0, -1, 0]));
      out.follow = NO_ANCHOR;
      out.vert(add(pts[i], mul(side, -width / 2)), nrm, 0, t, 0.92, w);
      out.vert(add(pts[i], mul(side, width / 2)), nrm, 1, t, 0.92, w);
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = base + i * 2;
      out.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      // Both sides: the tails are thin cloth.
      out.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
}

// ------------------------------------------------------------------ belt, buckle, emblem

function waist(B: Body): { y: number; z: number } {
  const pelvis = B.head("pelvis"), spine = B.head("spine_01");
  return { y: lerp(pelvis[1], spine[1], 0.35), z: lerp(pelvis[2], spine[2], 0.35) };
}

const torsoPick = (B: Body) => {
  const names = B.b.skeleton.names;
  return (v: number) => B.dom[v] >= 0 && !isArm(names[B.dom[v]]) && B.dom[v] !== B.bone("head") && B.dom[v] !== B.bone("neck_01");
};

/** Rounded rectangle, negative inside. */
const roundRect = (x: number, y: number, hx: number, hy: number, r: number) => {
  const qx = Math.abs(x) - hx + r, qy = Math.abs(y) - hy + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};

function buildBelt(B: Body, style: BeltStyle, belt: Builder, buckle: Builder) {
  const s = B.height / 1.75;
  const { y: wy } = waist(B);
  const half = 0.026 * s;
  const pick = torsoPick(B);
  shell(B, belt, { pick, value: (p) => Math.min(p[1] - (wy - half), wy + half - p[1]), offset: 0.02, subdiv: 1, rim: 0.012, shade: 1 });
  if (style === "plain") return;
  // Buckle on the front of the belt.
  const front = (p: V3, n: V3) => (n[2] > 0.2 ? 1 : -1);
  const plate = style === "utility" ? (x: number, y: number) => roundRect(x, y, 0.05 * s, 0.032 * s, 0.008 * s) : (x: number, y: number) => roundRect(x, y, 0.042 * s, 0.034 * s, 0.016 * s);
  shell(B, buckle, { pick, value: (p, n) => Math.min(-plate(p[0], p[1] - wy), front(p, n)), offset: 0.029, subdiv: 2, rim: 0.012, shade: 1 });
  if (style !== "utility") return;
  // Pouches round the belt.
  for (const a of [0.85, 1.45, 2.2]) {
    for (const side of [-1, 1]) {
      const ang = a * side;
      const value = (p: V3) => {
        const r = Math.hypot(p[0], p[2]);
        const t = Math.atan2(p[0], p[2]);
        let d = t - ang;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        return -roundRect(d * r, p[1] - (wy - 0.006 * s), 0.034 * s, 0.03 * s, 0.008 * s);
      };
      shell(B, belt, { pick, value, offset: 0.042, subdiv: 2, rim: 0.03, shade: 0.94 });
    }
  }
}

/** Centre and half size of the chest emblem. */
function emblemPlace(B: Body, size: number): { cx: number; cy: number; half: number } {
  const s3 = B.head("spine_03"), nk = B.head("neck_01");
  return { cx: 0, cy: lerp(s3[1], nk[1], 0.3), half: (0.075 + 0.055 * clamp(size, 0, 1)) * (B.height / 1.75) };
}

function buildEmblem(B: Body, c: CostumeParts, plate: Builder, rim: Builder) {
  const { cx, cy, half } = emblemPlace(B, c.emblemSize);
  const chest = B.head("spine_03")[2];
  const pick = torsoPick(B);
  const d = (p: V3) => plateDistance(c.emblem, c.symbol, (p[0] - cx) / half, (p[1] - cy) / half) * half;
  const front = (p: V3, n: V3) => (n[2] > 0.15 && p[2] > chest ? 1 : -1);
  const rimW = c.emblem === "cutout" ? 0.004 : 0.008 * (half / 0.1);
  const uv = (p: V3): [number, number] => [0.5 + (p[0] - cx) / (2 * half), 0.5 + (p[1] - cy) / (2 * half)];
  // The plate is stiff: it bridges the hollow between the pecs (and clothes there) instead of
  // sinking into it, curving back gently toward its sides.
  let zMax = -Infinity;
  for (let v = 0; v < B.n; v++) {
    if (!B.b.isBody[v] || !pick(v)) continue;
    const p = at(B.b.positions, v);
    if (p[2] > chest && d(p) < 0) zMax = Math.max(zMax, p[2]);
  }
  const stiff = (offset: number) =>
    Number.isFinite(zMax) ? (x: number, y: number) => zMax + offset - 2.2 * (x - cx) ** 2 - 0.8 * (y - cy) ** 2 : undefined;
  shell(B, plate, { pick, value: (p, n) => Math.min(-d(p) - rimW, front(p, n)), offset: 0.017, subdiv: 2, rim: 0.012, uv, front: stiff(0.017) });
  shell(B, rim, { pick, value: (p, n) => Math.min(-d(p), d(p) + rimW + 0.0015, front(p, n)), offset: 0.0195, subdiv: 2, rim: 0.016, uv, front: stiff(0.0195) });
}

// ------------------------------------------------------------------ cape

interface CapeGrid {
  cols: number;
  rows: number;
  /** Grid points (rows × cols), normals, shade. */
  p: V3[];
  n: V3[];
  shade: number[];
  /** Normalized column position -1..1 and row 0..1 per point. */
  s: number[];
  v: number[];
}

function capeGrid(B: Body, style: CapeStyle): CapeGrid {
  const H = B.height, k = H / 1.75;
  const names = B.b.skeleton.names;
  // The axis the cape wraps round: the middle of the chest (the spine's joints lie near the back).
  const zA = B.head("spine_03")[2] + 0.07 * k;
  const shoulderY = B.head("upperarm_l")[1];
  const pos = B.b.positions;
  // The body the cape rests on: torso, hips, legs and the tops of the shoulders.
  const cand: { phi: number; r: number; y: number }[] = [];
  for (let v = 0; v < B.n; v++) {
    const d = B.dom[v];
    if (d < 0) continue;
    const name = names[d];
    if (name === "head" || /^(lowerarm|hand|index|middle|ring|pinky|thumb)/.test(name)) continue;
    const p = at(pos, v);
    // The neck's weights reach down over the trapezius: keep those, not the neck itself.
    if (name === "neck_01" && p[1] > B.head("neck_01")[1] + 0.01 * k) continue;
    if (name.startsWith("upperarm") && p[1] < shoulderY - 0.03 * k) continue;
    const dz = p[2] - zA;
    cand.push({ phi: Math.atan2(p[0], -dz), r: Math.hypot(p[0], dz), y: p[1] });
  }
  const sector = 0.09;
  const yTopAt = (phi: number) => {
    let y = -Infinity;
    for (const q of cand) if (Math.abs(q.phi - phi) < sector && q.r > 0.03 && q.y > y) y = q.y;
    return Number.isFinite(y) ? y : shoulderY;
  };
  const knee = B.head("calf_l")[1], ankle = B.head("foot_l")[1], hip = B.head("pelvis")[1];
  const hem0 = style === "short" ? hip + 0.03 * k : style === "long" ? ankle + 0.1 * k : knee - 0.03 * k;
  const flare = style === "short" ? 0.035 : style === "long" ? 0.11 : 0.075;
  const cols = 33, rows = style === "short" ? 24 : style === "long" ? 52 : 42;
  const phiMax = (v: number) => lerp(1.42, 1.2, smoothstep(0, 0.35, v));
  const hemAt = (s: number) => {
    if (style === "scalloped") {
      // Bat-wing scallops: points hang between shallow arcs.
      const t = ((s + 1) / 2) * 5;
      const f = t - Math.floor(t);
      return hem0 + 0.075 * k * (1 - Math.pow(Math.abs(2 * f - 1), 0.6)) * 0.9 - 0.02 * k;
    }
    if (style === "pointed") return hem0 + 0.1 * k * Math.abs(s) - 0.08 * k;
    return hem0 + 0.02 * k * s * s;
  };
  const grid: CapeGrid = { cols, rows, p: [], n: [], shade: [], s: [], v: [] };
  // Column tops, then rows down with a running maximum of the body's reach (cloth falls from the
  // furthest-back point above it).
  const reach = new Array(cols).fill(0);
  const yTop: number[] = [], phis: number[][] = [];
  const rawTop: number[] = [];
  const neckY = B.head("neck_01")[1];
  for (let j = 0; j < cols; j++) rawTop.push(Math.min(neckY, yTopAt(((j / (cols - 1)) * 2 - 1) * phiMax(0))));
  // A smooth shoulder line (no notch or spike where the neck meets the back).
  for (let j = 0; j < cols; j++) {
    let sum = 0, wsum = 0;
    for (let d = -4; d <= 4; d++) {
      const o = clamp(j + d, 0, cols - 1), w = Math.exp(-(d * d) / 8);
      sum += rawTop[o] * w;
      wsum += w;
    }
    yTop.push(sum / wsum + 0.016 * k);
  }
  for (let i = 0; i < rows; i++) {
    const v = i / (rows - 1);
    const row: number[] = [];
    for (let j = 0; j < cols; j++) {
      const s = (j / (cols - 1)) * 2 - 1;
      const phi = s * phiMax(v);
      row.push(phi);
      const y = lerp(yTop[j], hemAt(s), v);
      let r = reach[j];
      for (const q of cand) {
        // Near the top the cloth also clears the curve of the back just below it.
        if (q.y < y - (0.015 + 0.03 * (1 - v) ** 3) * k || Math.abs(q.phi - phi) > sector) continue;
        const proj = q.r * Math.cos(q.phi - phi);
        if (proj > r) r = proj;
      }
      reach[j] = r;
    }
    // Cloth bridges hollows (the groove of the spine): each column reaches at least as far as
    // its neighbours' reach seen from its own angle.
    const bridged = reach.map((r, j) => {
      let m = r;
      for (let d = -5; d <= 5; d++) {
        const o = j + d;
        if (o < 0 || o >= cols || d === 0) continue;
        m = Math.max(m, reach[o] * Math.cos(row[o] - row[j]));
      }
      return m;
    });
    for (let j = 0; j < cols; j++) reach[j] = bridged[j];
    for (let j = 0; j < cols; j++) {
      const s = (j / (cols - 1)) * 2 - 1;
      const phi = row[j];
      const y = lerp(yTop[j], hemAt(s), v);
      const r = reach[j];
      const fold = smoothstep(0.06, 0.55, v);
      const wave = 0.5 + 0.5 * Math.cos(s * Math.PI * 3.5);
      const R = r + (0.016 + 0.008 * v) * k + flare * k * Math.pow(v, 1.3) + 0.03 * k * fold * wave;
      grid.p.push([Math.sin(phi) * R, y, zA - Math.cos(phi) * R]);
      grid.shade.push(1 - 0.14 * fold * (1 - wave));
      grid.s.push(s);
      grid.v.push(v);
    }
    phis.push(row);
  }
  // Normals from the grid, pointing away from the body.
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++) {
      const P = (a: number, b: number) => grid.p[clamp(a, 0, rows - 1) * cols + clamp(b, 0, cols - 1)];
      const du = sub(P(i, j + 1), P(i, j - 1)), dv = sub(P(i + 1, j), P(i - 1, j));
      let n = norm(cross(du, dv));
      const phi = phis[i][j];
      if (dot(n, [Math.sin(phi), 0, -Math.cos(phi)]) < 0) n = mul(n, -1);
      grid.n.push(n);
    }
  return grid;
}

/** Bone rows (grid rows of each link's head) and chain columns (normalized). */
const CHAIN_S = [-0.64, 0, 0.64];
const LINK_V = [0.1, 0.28, 0.46, 0.64, 0.82];

function capeWeights(B: Body, s: number, v: number, boneBase: number): Weights {
  // Columns: between the two nearest chains.
  const cw: [number, number][] = [];
  if (s <= CHAIN_S[0]) cw.push([0, 1]);
  else if (s >= CHAIN_S[2]) cw.push([2, 1]);
  else {
    const c = s < 0 ? 0 : 1;
    const t = (s - CHAIN_S[c]) / (CHAIN_S[c + 1] - CHAIN_S[c]);
    cw.push([c, 1 - t], [c + 1, t]);
  }
  // Rows: the link and its nearer neighbour.
  const link = (chain: number, k: number) => boneBase + chain * CAPE_LINKS + k;
  const w = new Map<number, number>();
  const put = (j: number, x: number) => w.set(j, (w.get(j) ?? 0) + x);
  const spine = B.bone("spine_03");
  const clav = B.bone(s > 0 ? "clavicle_l" : "clavicle_r");
  if (v <= LINK_V[0]) {
    // The top band rides on the upper back and shoulders, blending into the first links.
    const t = smoothstep(0.03, LINK_V[0], v) * 0.5;
    put(spine, (1 - t) * (1 - 0.45 * Math.abs(s)));
    put(clav, (1 - t) * 0.45 * Math.abs(s));
    for (const [c, x] of cw) put(link(c, 0), t * x);
    return top4(w);
  }
  let k = 0;
  while (k + 1 < LINK_V.length && v >= LINK_V[k + 1]) k++;
  const next = k + 1 < LINK_V.length ? LINK_V[k + 1] : 1;
  const f = (v - LINK_V[k]) / (next - LINK_V[k]);
  // At a link's head the cloth is shared half and half with the link above.
  let pair: [number, number, number];
  if (f < 0.5) pair = [k - 1, k, 0.5 * (1 - smoothstep(0, 0.5, f))];
  else pair = [k + 1, k, k + 1 < CAPE_LINKS ? 0.5 * smoothstep(0.5, 1, f) : 0];
  for (const [c, x] of cw) {
    const [other, own, share] = pair;
    if (other < 0) {
      // Above the first link's head: shared with the spine.
      put(spine, x * share);
      put(link(c, own), x * (1 - share));
    } else {
      put(link(c, other), x * share);
      put(link(c, own), x * (1 - share));
    }
  }
  return top4(w);
}

function buildCape(B: Body, c: CostumeParts, outer: Builder, lining: Builder, boneBase: number) {
  const g = capeGrid(B, c.cape);
  const { cols, rows } = g;
  const k = B.height / 1.75;
  // Bones: three chains down the back, parented to the upper spine.
  const bones: PartBone[] = [];
  CAPE_CHAINS.forEach((side, ci) => {
    for (let l = 0; l < CAPE_LINKS; l++) {
      const i = Math.round(LINK_V[l] * (rows - 1));
      const j = Math.round(((CHAIN_S[ci] + 1) / 2) * (cols - 1));
      const p = g.p[i * cols + j];
      bones.push({ name: `cape_${side}_${l + 1}`, parent: l ? `cape_${side}_${l}` : "spine_03", head: [p[0], p[1], p[2]] });
    }
  });
  outer.bones = bones;
  const thick = 0.0045 * k;
  const W = g.p.map((_, i) => capeWeights(B, g.s[i], g.v[i], boneBase));
  const uvOf = (i: number): [number, number] => [(g.s[i] + 1) / 2, g.v[i]];
  // Outside and lining.
  const o0 = outer.count, l0 = lining.count;
  for (let i = 0; i < g.p.length; i++) {
    outer.follow = lining.follow = NO_ANCHOR;
    outer.vert(g.p[i], g.n[i], uvOf(i)[0], uvOf(i)[1], g.shade[i], W[i]);
    lining.vert(sub(g.p[i], mul(g.n[i], thick)), mul(g.n[i], -1), uvOf(i)[0], uvOf(i)[1], g.shade[i] * 0.95, W[i]);
  }
  for (let i = 0; i + 1 < rows; i++)
    for (let j = 0; j + 1 < cols; j++) {
      const a = i * cols + j, b = a + 1, d = a + cols, e = d + 1;
      outer.idx.push(o0 + a, o0 + b, o0 + d, o0 + b, o0 + e, o0 + d);
      lining.idx.push(l0 + a, l0 + d, l0 + b, l0 + b, l0 + d, l0 + e);
    }
  // The cloth's edge: hem and sides, a strip between outside and lining.
  const edge = (ids: number[], dir: (i: number) => V3) => {
    const q0 = outer.count;
    for (const i of ids) {
      const n = dir(i);
      outer.follow = NO_ANCHOR;
      outer.vert(g.p[i], n, uvOf(i)[0], uvOf(i)[1], g.shade[i] * 0.9, W[i]);
      outer.vert(sub(g.p[i], mul(g.n[i], thick)), n, uvOf(i)[0], uvOf(i)[1], g.shade[i] * 0.9, W[i]);
    }
    for (let m = 0; m + 1 < ids.length; m++) {
      const a = q0 + m * 2;
      const n = dir(ids[m]);
      const ab = sub(g.p[ids[m + 1]], g.p[ids[m]]);
      // Wind the strip so it faces along `dir`.
      const face = dot(cross(ab, mul(g.n[ids[m]], -1)), n) > 0;
      if (face) outer.idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      else outer.idx.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
    }
  };
  const P = (i: number, j: number) => g.p[clamp(i, 0, rows - 1) * cols + clamp(j, 0, cols - 1)];
  const hem = Array.from({ length: cols }, (_, j) => (rows - 1) * cols + j);
  edge(hem, (i) => norm(sub(g.p[i], P(rows - 2, i % cols))));
  for (const j of [0, cols - 1]) {
    const ids = Array.from({ length: rows }, (_, i) => i * cols + j);
    edge(ids, (i) => norm(sub(g.p[i], P(Math.floor(i / cols), j === 0 ? 1 : cols - 2))));
  }
  const top = Array.from({ length: cols }, (_, j) => j);
  edge(top, (i) => norm(sub(g.p[i], P(1, i))));
  if (c.collar !== "none") buildCollar(B, c.collar, outer, lining);
}

function buildCollar(B: Body, style: CollarStyle, outer: Builder, lining: Builder) {
  const k = B.height / 1.75;
  const nk = B.head("neck_01"), spine = B.bone("spine_03"), neck = B.bone("neck_01");
  const names = B.b.skeleton.names;
  const zN = nk[2];
  // Neck reach per direction just above the neck base.
  const cand: { phi: number; r: number }[] = [];
  for (let v = 0; v < B.n; v++) {
    const d = B.dom[v];
    if (d < 0 || (names[d] !== "neck_01" && names[d] !== "spine_03")) continue;
    const p = at(B.b.positions, v);
    if (Math.abs(p[1] - (nk[1] + 0.025 * k)) > 0.02 * k) continue;
    cand.push({ phi: Math.atan2(p[0], -(p[2] - zN)), r: Math.hypot(p[0], p[2] - zN) });
  }
  const cols = 41, rows = 9;
  const span = style === "flared" ? 2.1 : 1.95;
  const thick = 0.004 * k;
  const o0 = outer.count, l0 = lining.count;
  const pts: V3[] = [], nrm: V3[] = [], W: Weights[] = [];
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1);
    for (let j = 0; j < cols; j++) {
      const s = (j / (cols - 1)) * 2 - 1;
      const phi = s * span;
      let r = 0.05 * k;
      for (const q of cand) if (Math.abs(q.phi - phi) < 0.2) r = Math.max(r, q.r * Math.cos(q.phi - phi));
      const front = (Math.abs(s) * span / 2) ** 2;
      const h = style === "flared" ? (0.12 + 0.05 * front) * k : (0.07 - 0.015 * front) * k;
      const out = style === "flared" ? 0.075 * k * Math.pow(t, 1.6) * (0.7 + 0.3 * front) : 0.012 * k * t;
      const R = r + 0.022 * k + out;
      const y = nk[1] - 0.012 * k - 0.03 * k * front + h * t;
      pts.push([Math.sin(phi) * R, y, zN - Math.cos(phi) * R]);
      W.push(top4(new Map([[spine, 1 - 0.55 * t], [neck, 0.55 * t]])));
    }
  }
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++) {
      const P = (a: number, b: number) => pts[clamp(a, 0, rows - 1) * cols + clamp(b, 0, cols - 1)];
      let n = norm(cross(sub(P(i, j + 1), P(i, j - 1)), sub(P(i + 1, j), P(i - 1, j))));
      const phi = ((j / (cols - 1)) * 2 - 1) * span;
      if (dot(n, [Math.sin(phi), 0, -Math.cos(phi)]) < 0) n = mul(n, -1);
      nrm.push(n);
    }
  for (let i = 0; i < pts.length; i++) {
    const uv: [number, number] = [(i % cols) / (cols - 1), Math.floor(i / cols) / (rows - 1)];
    outer.follow = lining.follow = NO_ANCHOR;
    outer.vert(pts[i], nrm[i], uv[0], uv[1], 1, W[i]);
    lining.vert(sub(pts[i], mul(nrm[i], thick)), mul(nrm[i], -1), uv[0], uv[1], 0.95, W[i]);
  }
  for (let i = 0; i + 1 < rows; i++)
    for (let j = 0; j + 1 < cols; j++) {
      const a = i * cols + j, b = a + 1, d = a + cols, e = d + 1;
      outer.idx.push(o0 + a, o0 + d, o0 + b, o0 + b, o0 + d, o0 + e);
      lining.idx.push(l0 + a, l0 + b, l0 + d, l0 + b, l0 + e, l0 + d);
    }
  // A rolled top edge joining outside and lining.
  const q0 = outer.count;
  for (let j = 0; j < cols; j++) {
    const i = (rows - 1) * cols + j;
    const up = norm(sub(pts[i], pts[i - cols]));
    outer.vert(pts[i], up, 0, 1, 0.9, W[i]);
    outer.vert(sub(pts[i], mul(nrm[i], thick)), up, 0, 1, 0.9, W[i]);
  }
  for (let j = 0; j + 1 < cols; j++) {
    const a = q0 + j * 2;
    outer.idx.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
  }
}

// ------------------------------------------------------------------ all

/**
 * The costume's meshes. `boneBase` is the joint index the first cape bone gets (the pack
 * skeleton's size plus the bones of the parts built before).
 */
export function buildCostume(body: PartsBody, c: CostumeParts, boneBase: number): PartMesh[] {
  if (!hasCostume(c)) return [];
  const B = bodyOf(body);
  const out: PartMesh[] = [];
  const done = (b: Builder, name: string, kind: PartMesh["kind"], color?: RGB) => {
    if (b.count) out.push(b.build(name, kind, color));
  };
  if (c.cape !== "none") {
    const outer = new Builder(), lining = new Builder();
    buildCape(B, c, outer, lining, boneBase);
    done(outer, "cape", "cloth", c.capeColor);
    done(lining, "cape-lining", "cloth", c.liningColor);
  }
  if (c.mask !== "none") {
    const m = new Builder();
    buildMask(B, c.mask, m);
    done(m, "mask", "cloth", c.maskColor);
  }
  if (c.belt !== "none") {
    const belt = new Builder(), buckle = new Builder();
    buildBelt(B, c.belt, belt, buckle);
    done(belt, "belt", "cloth", c.beltColor);
    done(buckle, "buckle", "cloth", c.buckleColor);
  }
  if (c.emblem !== "none") {
    const plate = new Builder(), rim = new Builder();
    buildEmblem(B, c, plate, rim);
    done(plate, "emblem", "emblem");
    done(rim, "emblem-rim", "cloth", c.rimColor);
  }
  return out;
}

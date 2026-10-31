/**
 * Fantasy-race add-ons, generated from the current body shape: horns, tusks,
 * tails, beards, sylvan leaf hair and the drakeborn crest. Ported from Norgo
 * (same author) to this pack's skeleton and axes (+Z forward, +X = the
 * actor's left).
 *
 * Every part is skinned to existing bones (head, pelvis...), so animation,
 * retargeting and glTF export need nothing extra. Beards are a shell over the
 * skin with wide locks on it, leaves are cards grown from roots sampled on the
 * morphed skin; horns, tusks and
 * tails are tubes along curves. Renderer-free and deterministic from `seed`.
 */
import type { ActorShape, FittedSkeleton, MeshData, PartBone, PartKind, PartMesh } from "@actors/core";

/** `PartMesh.anchors` value for vertices that don't follow face morphs. */
export const NO_ANCHOR = 0xffffffff;
import type { HornStyle, TailStyle } from "./races";
export type BeardStyle = "none" | "short" | "full" | "long" | "braided" | "forked" | "goatee" | "mustache" | "mutton" | "chinstrap";
/** Procedural hair styles (the pack's hair meshes cover the rest). */
export type HairPart = "none" | "leaves" | "crest";

export const HORN_STYLES: HornStyle[] = ["none", "ram", "straight", "swept", "antler", "crown"];
export const TAIL_STYLES: TailStyle[] = ["none", "reptile", "furred", "thin"];
export const BEARD_STYLES: BeardStyle[] = ["none", "short", "full", "long", "braided", "forked", "goatee", "mustache", "mutton", "chinstrap"];
export const HAIR_PARTS: HairPart[] = ["none", "leaves", "crest"];

export interface PartsConfig {
  seed: number;
  /** Overall race scale (bigger races get slightly longer beards and bigger horns). */
  scale: number;
  horns: HornStyle;
  /** 0..1 */
  hornSize: number;
  /** sRGB 0..1 */
  hornColor: [number, number, number];
  /** 0..1, 0 = none. */
  tusks: number;
  tail: TailStyle;
  /** 0..1 of the body height × 0.62. */
  tailLength: number;
  beard: BeardStyle;
  hair: HairPart;
}

/** What the builders need from the body: the evaluated shape and its landmarks. */
export interface PartsBody {
  /** Per base vertex (the actor shape). */
  positions: Float32Array;
  normals: Float32Array;
  /** Body triangles as base vertex indices. */
  triangles: Uint32Array;
  /** Per base vertex skin influences (4 each). */
  joints: Uint16Array;
  weights: Float32Array;
  /** Per base vertex UV (for skin-material parts). */
  uvs: Float32Array;
  /** 1 for base vertices of the body surface (the base mesh also holds helper geometry). */
  isBody: Uint8Array;
  skeleton: Pick<FittedSkeleton, "names" | "heads">;
  /** Eye centres (actor's left and right). */
  eyes: [V3, V3];
  /** Between the ears. */
  earMid: V3;
  /** Middle of the upper lip. */
  mouth: V3;
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
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const UP: V3 = [0, 1, 0], DOWN: V3 = [0, -1, 0], FWD: V3 = [0, 0, 1], BACK: V3 = [0, 0, -1];

class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = (Math.floor(seed * 4294967295) ^ 0x9e3779b9) >>> 0;
  }
  float(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) {
    return a + (b - a) * this.float();
  }
  gaussian(mean: number, sd: number) {
    const u = Math.max(1e-9, this.float()), v = this.float();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

/** Skin influences as [bone index, weight] pairs (normalized when written). */
export type Weights = [number, number][];

/** Collects a part's vertices, skinning and triangles (shared by the part builders and robot.ts). */
export class Builder {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  shade: number[] = [];
  ji: number[] = [];
  jw: number[] = [];
  idx: number[] = [];
  anchor: number[] = [];
  /** Base vertex the next vertices follow in face morphs (NO_ANCHOR = rigid). */
  follow = NO_ANCHOR;
  bones: PartBone[] = [];
  get count() {
    return this.pos.length / 3;
  }
  vert(p: V3, n: V3, u: number, v: number, shade: number, w: Weights) {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.uv.push(u, v);
    this.shade.push(shade);
    this.anchor.push(this.follow);
    const m = Math.min(4, w.length);
    let total = 0;
    for (let k = 0; k < m; k++) total += w[k][1];
    total = total || 1;
    for (let k = 0; k < 4; k++) {
      this.ji.push(k < m ? w[k][0] : 0);
      this.jw.push(k < m ? w[k][1] / total : 0);
    }
  }
  build(name: string, kind: PartKind, color?: [number, number, number]): PartMesh {
    return {
      name,
      kind,
      color,
      positions: Float32Array.from(this.pos),
      normals: Float32Array.from(this.nrm),
      uvs: Float32Array.from(this.uv),
      shade: Float32Array.from(this.shade),
      joints: Uint16Array.from(this.ji),
      weights: Float32Array.from(this.jw),
      indices: Uint32Array.from(this.idx),
      ...(this.anchor.some((a) => a !== NO_ANCHOR) ? { anchors: Uint32Array.from(this.anchor) } : {}),
      ...(this.bones.length ? { bones: this.bones } : {}),
    };
  }
}

// ------------------------------------------------------------------ body context

interface Ctx {
  body: PartsBody;
  rng: Rng;
  /** Head sphere. */
  C: V3;
  R: number;
  ipd: number;
  /** Face coordinates per base vertex: (p - eye midpoint) / eye distance, z forward. */
  face: Float32Array;
  bone: (name: string) => number;
  head: (name: string) => V3;
  grid: Map<number, number[]>;
  cell: number;
  height: number;
}

const gridKey = (x: number, y: number, z: number) => (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);

function context(body: PartsBody, seed: number, scale: number): Ctx {
  const { positions: pos, skeleton } = body;
  const n = pos.length / 3;
  const bone = (name: string) => Math.max(0, skeleton.names.indexOf(name));
  const head = (name: string): V3 => [...skeleton.heads[bone(name)]] as V3;
  const [eL, eR] = body.eyes;
  const mid = mul(add(eL, eR), 0.5), ipd = len(sub(eL, eR)) || 0.064;
  const face = new Float32Array(n * 3);
  let top = -Infinity, bottom = Infinity;
  for (let v = 0; v < n; v++) {
    if (!body.isBody[v]) continue;
    face[v * 3] = (pos[v * 3] - mid[0]) / ipd;
    face[v * 3 + 1] = (pos[v * 3 + 1] - mid[1]) / ipd;
    face[v * 3 + 2] = (pos[v * 3 + 2] - mid[2]) / ipd;
    top = Math.max(top, pos[v * 3 + 1]);
    bottom = Math.min(bottom, pos[v * 3 + 1]);
  }
  // Head sphere: mean distance of skull vertices above the ears (rigidly on the head bone).
  const hb = bone("head"), E = body.earMid;
  let hr = 0, hn = 0;
  for (let v = 0; v < n; v++) {
    if (!body.isBody[v] || body.joints[v * 4] !== hb || body.weights[v * 4] < 0.9 || pos[v * 3 + 1] < E[1] + 0.01) continue;
    hr += Math.hypot(pos[v * 3] - E[0], pos[v * 3 + 1] - E[1], pos[v * 3 + 2] - E[2]);
    hn++;
  }
  const R = hn ? hr / hn : 0.1;
  const C: V3 = [E[0], E[1] + R * 0.12, E[2] + R * 0.08];
  const cell = 0.03 * Math.max(0.5, scale);
  const grid = new Map<number, number[]>();
  for (let v = 0; v < n; v++) {
    if (!body.isBody[v]) continue;
    const k = gridKey(Math.floor(pos[v * 3] / cell), Math.floor(pos[v * 3 + 1] / cell), Math.floor(pos[v * 3 + 2] / cell));
    let l = grid.get(k);
    if (!l) grid.set(k, (l = []));
    l.push(v);
  }
  return { body, rng: new Rng(seed), C, R, ipd, face, bone, head, grid, cell, height: top - bottom };
}

/** Area-weighted random surface samples on body triangles where `weight(face coords)` > 0. */
function sampleSurface(ctx: Ctx, count: number, weight: (x: number, y: number, z: number) => number): { p: V3; n: V3; f: V3; v: number }[] {
  const { body, face, rng } = ctx;
  const tris = body.triangles, pos = body.positions, nrm = body.normals;
  const cdf: number[] = [], ids: number[] = [];
  const vw = new Map<number, number>();
  const w = (v: number) => {
    let x = vw.get(v);
    if (x === undefined) vw.set(v, (x = weight(face[v * 3], face[v * 3 + 1], face[v * 3 + 2])));
    return x;
  };
  let total = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    const wt = (w(a) + w(b) + w(c)) / 3;
    if (wt <= 0.02) continue;
    const pa: V3 = [pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]];
    const ab = sub([pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]], pa), ac = sub([pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]], pa);
    total += (len(cross(ab, ac)) / 2) * wt;
    cdf.push(total);
    ids.push(t);
  }
  const out: { p: V3; n: V3; f: V3; v: number }[] = [];
  if (!ids.length) return out;
  for (let i = 0; i < count; i++) {
    const r = rng.float() * total;
    let lo = 0, hi = cdf.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (cdf[m] < r) lo = m + 1;
      else hi = m;
    }
    const t = ids[lo];
    let u = rng.float(), v = rng.float();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    const vs = [tris[t], tris[t + 1], tris[t + 2]];
    const ws = [1 - u - v, u, v];
    const p: V3 = [0, 0, 0], n: V3 = [0, 0, 0], f: V3 = [0, 0, 0];
    for (let k = 0; k < 3; k++)
      for (let j = 0; j < 3; j++) {
        p[j] += pos[vs[k] * 3 + j] * ws[k];
        n[j] += nrm[vs[k] * 3 + j] * ws[k];
        f[j] += face[vs[k] * 3 + j] * ws[k];
      }
    out.push({ p, n: norm(n), f, v: vs[ws[0] > ws[1] ? (ws[0] > ws[2] ? 0 : 2) : ws[1] > ws[2] ? 1 : 2] });
  }
  return out;
}

/** The body vertex nearest to `p`. */
function nearestVertex(ctx: Ctx, p: V3): number {
  const { cell, grid, body } = ctx;
  const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell), cz = Math.floor(p[2] / cell);
  let best = -1, bd = Infinity;
  for (let r = 1; r <= 4 && best < 0; r++) {
    for (let x = cx - r; x <= cx + r; x++)
      for (let y = cy - r; y <= cy + r; y++)
        for (let z = cz - r; z <= cz + r; z++) {
          const list = grid.get(gridKey(x, y, z));
          if (!list) continue;
          for (const v of list) {
            const d = (body.positions[v * 3] - p[0]) ** 2 + (body.positions[v * 3 + 1] - p[1]) ** 2 + (body.positions[v * 3 + 2] - p[2]) ** 2;
            if (d < bd) {
              bd = d;
              best = v;
            }
          }
        }
  }
  return best;
}

/** Skin weights of a body vertex. */
function vertexWeights(ctx: Ctx, v: number): Weights {
  if (v < 0) return [[ctx.bone("head"), 1]];
  const out: Weights = [];
  for (let k = 0; k < 4; k++) if (ctx.body.weights[v * 4 + k] > 0) out.push([ctx.body.joints[v * 4 + k], ctx.body.weights[v * 4 + k]]);
  return out.length ? out : [[ctx.bone("head"), 1]];
}

/** Scalp hair weights: rigid to the head, blending into the neck below the jaw. */
function hairWeights(ctx: Ctx, p: V3): Weights {
  const neckTop = ctx.head("head")[1], neckBase = ctx.head("neck_01")[1];
  if (p[1] >= neckTop) return [[ctx.bone("head"), 1]];
  const t = Math.min(1, (neckTop - p[1]) / Math.max(0.01, neckTop - neckBase));
  return [
    [ctx.bone("head"), 1 - t * 0.6],
    [ctx.bone("neck_01"), t * 0.6],
  ];
}

// ------------------------------------------------------------------ strands -> cards

interface StrandOpts {
  segs: number;
  length: number;
  gravity: number;
  /** How long the strand follows its root normal before bending (0..1). */
  stiff: number;
  /** Extra clearance above the head sphere at the tip (m). */
  volume: number;
  curl: number;
  curlFreq: number;
  /** Where combing pulls the strand at a point. */
  comb: (p: V3, t: number) => V3 | null;
  combK: number;
  noise: number;
  collideHead: boolean;
}

function growStrand(ctx: Ctx, root: V3, n: V3, o: StrandOpts): V3[] {
  const { rng } = ctx;
  const pts: V3[] = [add(root, mul(n, -0.0008))];
  // Strands leave the skin at a shallow angle: mostly along the combing direction, lifted by stiffness.
  let c0 = o.comb(root, 0);
  if (!c0) c0 = norm(cross(n, norm([rng.gaussian(0, 1), rng.gaussian(0, 1), rng.gaussian(0, 1)])));
  const c0t = sub(norm(c0), mul(n, dot(norm(c0), n)));
  let dir = norm(add(mul(n, 0.2 + 0.7 * o.stiff), len(c0t) > 1e-4 ? norm(c0t) : n));
  const seg = o.length / o.segs;
  const ph = rng.range(0, Math.PI * 2);
  const side = norm(cross(n, Math.abs(n[1]) > 0.9 ? FWD : UP));
  // Layering: a strand never dips below the radius of its own root, so crown hair lies over the rest.
  const rootR = Math.max(ctx.R * 1.03, len(sub(root, ctx.C)) + 0.0025);
  for (let i = 1; i <= o.segs; i++) {
    const t = i / o.segs;
    const g = o.gravity * Math.min(1, t / Math.max(0.05, o.stiff));
    dir = norm(add(dir, mul(DOWN, g * 0.35)));
    const c = o.comb(pts[i - 1], t);
    if (c) dir = norm(lerp3(dir, norm(c), o.combK));
    if (o.noise) dir = norm(add(dir, [rng.gaussian(0, o.noise), rng.gaussian(0, o.noise * 0.5), rng.gaussian(0, o.noise)]));
    let p = add(pts[i - 1], mul(dir, seg));
    if (o.curl) p = add(p, mul(side, Math.sin(ph + t * o.curlFreq * Math.PI * 2) * o.curl * Math.min(1, t * 3) * seg));
    if (o.collideHead) {
      const rel = sub(p, ctx.C);
      const d = len(rel);
      const minR = rootR + o.volume * Math.min(1, t * 2);
      if (d < minR) p = add(ctx.C, mul(rel, minR / d));
    }
    dir = norm(sub(p, pts[i - 1]));
    pts.push(p);
  }
  return pts;
}

/** A polyline as a ribbon card. `outward(p)` orients the card face and its shading normal. */
function card(b: Builder, pts: V3[], width: (t: number) => number, u0: number, u1: number, shade: number, weights: (p: V3) => Weights, outward: (p: V3) => V3, twist = 0) {
  const base = b.count;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const tan = norm(sub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]));
    const out = outward(pts[i]);
    let s = norm(cross(tan, out));
    if (twist) {
      const a = twist * t;
      const o2 = norm(cross(s, tan));
      s = norm(add(mul(s, Math.cos(a)), mul(o2, Math.sin(a))));
    }
    const w = width(t) / 2;
    const nn = norm(cross(s, tan));
    const facing = dot(nn, out) < 0 ? mul(nn, -1) : nn;
    const wgt = weights(pts[i]);
    b.vert(add(pts[i], mul(s, -w)), facing, u0, t, shade, wgt);
    b.vert(add(pts[i], mul(s, w)), facing, u1, t, shade, wgt);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = base + i * 2;
    b.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
}

// ------------------------------------------------------------------ scalp (leaves) and crest

/** Scalp coverage in face coordinates (1 = scalp). */
function scalpCoverage(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  const hairline = 1.05 + 0.18 * ax * ax;
  const front = smoothstep(hairline - 0.08, hairline + 0.08, y);
  // Above and behind the ears, and the nape.
  const sides = smoothstep(-0.55, -0.85, z) * smoothstep(-0.05, 0.25, y + 0.35 * smoothstep(-1.2, -2.0, z));
  const nape = smoothstep(-1.05, -1.35, z) * smoothstep(-2.2, -1.8, y);
  return Math.min(1, Math.max(front, sides, nape)) * (y > -2.6 ? 1 : 0);
}

/** Sylvan hair: leaf cards swept back over the scalp, a little ruffled. */
function buildLeaves(ctx: Ctx, b: Builder) {
  const { rng, C } = ctx;
  const roots = sampleSurface(ctx, 420, scalpCoverage);
  const comb = (local: V3) => (_p: V3, t: number): V3 => norm(add(BACK, mul(DOWN, 0.35 + t * 0.6 + Math.max(0, -local[2]) * 0.2)));
  for (const r of roots) {
    const local: V3 = mul(sub(r.p, C), 1 / ctx.R);
    const L = rng.range(0.07, 0.13);
    const pts = growStrand(ctx, r.p, r.n, { segs: 4, length: L, gravity: 0.35, stiff: 0.5, volume: 0.02, curl: 0.15, curlFreq: 0.8, noise: 0.25, combK: 0.25, comb: comb(local), collideHead: true });
    const w = rng.range(0.035, 0.05);
    card(b, pts, (t) => w * (0.5 + 0.5 * Math.sin(Math.min(1, t) * Math.PI * 0.9 + 0.2)), 0, 1, rng.range(0.7, 1.25), (p) => hairWeights(ctx, p), (p) => norm(sub(p, C)), rng.range(-1, 1));
  }
}

/** Drakeborn crest: a row of tapering fins along the skull midline. */
function buildCrest(ctx: Ctx, b: Builder) {
  const { C, R, rng } = ctx;
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = -0.35 + (i / (n - 1)) * 2.1; // forehead -> nape
    const base = onSkull(ctx, [0, Math.cos(a), -Math.sin(a)], 0);
    const h = R * (0.35 + 0.35 * Math.sin((i / (n - 1)) * Math.PI)) * rng.range(0.85, 1.15);
    const out = norm(sub(base, C));
    const tip = add(add(base, mul(out, h)), mul(BACK, h * 0.6));
    const sink = add(base, mul(out, -R * 0.06));
    card(b, [sink, lerp3(base, tip, 0.5), tip], (t) => R * 0.32 * (1 - t * 0.95), 0, 1, 1, () => [[ctx.bone("head"), 1]], () => [1, 0, 0]);
  }
}

// ------------------------------------------------------------------ beards

/** Painted-stubble region under each beard style (see `beardCoverage`; -1 none). */
export const BEARD_REGION: Record<BeardStyle, number> = { none: -1, short: 0, full: 0, long: 0, braided: 0, forked: 0, chinstrap: 4, goatee: 1, mustache: 2, mutton: 3 };

/** Beard coverage in face coordinates for a region style (0 full, 1 goatee, 2 mustache, 3 mutton chops, 4 chinstrap). */
export function beardCoverage(style: number, x: number, y: number, z: number): number {
  if (style < 0) return 0;
  const ax = Math.abs(x);
  // Upper edge: the cheek line rising toward the sideburns; lower edge: under the jaw onto the neck.
  const cheek = -0.82 + 0.62 * smoothstep(0.35, 1.25, ax);
  const upper = 1 - smoothstep(cheek - 0.06, cheek + 0.06, y);
  const side = smoothstep(-1.45, -1.05, z); // not behind the ears
  const neck = smoothstep(-2.25, -1.95, y + 0.25 * ax) * (1 - smoothstep(1.3, 1.6, ax));
  const front = upper * side * neck;
  // The lips stay bare.
  const lipZone = smoothstep(0.38, 0.5, Math.hypot(x / 1.1, (y + 1.18) / 0.36));
  const mustache = (1 - smoothstep(0.5, 0.62, ax)) * smoothstep(-1.12, -1.02, y) * (1 - smoothstep(-0.86, -0.78, y)) * side;
  const chin = (1 - smoothstep(0.42, 0.56, ax)) * (1 - smoothstep(-1.36, -1.28, y)) * smoothstep(-2.1, -1.95, y);
  switch (style) {
    case 0:
      return Math.max(front * lipZone, mustache);
    case 1:
      return Math.max(chin, mustache) * side;
    case 2:
      return mustache;
    case 3:
      return front * smoothstep(0.5, 0.75, ax) * lipZone;
    case 4: {
      // A band along the jawline, rising toward the ears.
      const jaw = -1.95 + 1.0 * smoothstep(0.5, 1.35, ax);
      return front * (1 - smoothstep(jaw + 0.32, jaw + 0.48, y)) * lipZone;
    }
  }
  return 0;
}

/**
 * Beard texture layout (see `beardTexture` in @actors/three): locks use u 0..0.5 (one tapered lock
 * splitting into a few points at the tip), the solid mass uses u 0.5..1 with v as its coverage
 * (alpha fades out raggedly toward v = 0).
 */
const LOCK_U: [number, number] = [0, 0.5];

interface BeardLook {
  /** Thickness of the solid mass over the skin (m); 0: none, the skin under it is painted instead (see `beardPaint`). */
  mass: number;
  /** Lock length range (m); 0 = mass only. */
  len: [number, number];
  /** Lock width range (m). */
  width: [number, number];
  /** Locks per beard. */
  locks: number;
}

const BEARD_LOOK: Record<Exclude<BeardStyle, "none">, BeardLook> = {
  short: { mass: 0, len: [0, 0], width: [0, 0], locks: 0 },
  chinstrap: { mass: 0, len: [0, 0], width: [0, 0], locks: 0 },
  full: { mass: 0.011, len: [0.035, 0.06], width: [0.016, 0.026], locks: 540 },
  long: { mass: 0.013, len: [0.1, 0.17], width: [0.02, 0.034], locks: 620 },
  braided: { mass: 0.012, len: [0.08, 0.13], width: [0.02, 0.032], locks: 540 },
  forked: { mass: 0.013, len: [0.09, 0.15], width: [0.02, 0.032], locks: 580 },
  goatee: { mass: 0.008, len: [0.035, 0.065], width: [0.014, 0.022], locks: 200 },
  mustache: { mass: 0.005, len: [0.022, 0.04], width: [0.013, 0.02], locks: 156 },
  mutton: { mass: 0.008, len: [0.022, 0.036], width: [0.013, 0.02], locks: 240 },
};

/**
 * How the skin under a beard is painted (the stubble shader's x and w, see GLSL_STUBBLE):
 * dense stubble fading out over a blurred outline, and for beards without a mass (short,
 * chinstrap) the skin filled with the hair colour. Null without a beard.
 */
export function beardPaint(style: BeardStyle): { amount: number; blur: number } | null {
  if (style === "none" || !BEARD_LOOK[style]) return null;
  return { amount: 2, blur: BEARD_LOOK[style].mass > 0 ? 0.12 : 0.09 };
}

/**
 * Beards are drawn as hair masses, not single hairs: a solid shell over the beard area (the skin
 * pushed out along its normal, fading out raggedly at the edge) with wide, layered locks growing
 * out of it. Every shell vertex follows its skin vertex in face morphs.
 */
function buildBeard(ctx: Ctx, style: BeardStyle, scale: number, b: Builder) {
  const region = BEARD_REGION[style] ?? -1;
  if (region < 0 || style === "none") return;
  const look = BEARD_LOOK[style];
  const { rng, body, face } = ctx;
  const chin = body.mouth;
  const scaleK = scale > 1.3 ? 1.25 : scale < 0.9 ? 0.8 : 1;
  const forkSide = (p: V3) => (p[0] - chin[0] >= 0 ? 1 : -1);
  const isMust = (f: V3) => f[1] > -1.12 && Math.abs(f[0]) < 0.62 && f[1] < -0.75;

  // --- The mass: a shell over every skin triangle the beard touches.
  const pos = body.positions, nrm = body.normals, tris = body.triangles;
  const n = pos.length / 3;
  const cov = new Float32Array(n).fill(-1);
  const coverage = (v: number) => {
    if (cov[v] < 0) cov[v] = body.isBody[v] ? beardCoverage(region, face[v * 3], face[v * 3 + 1], face[v * 3 + 2]) : 0;
    return cov[v];
  };
  // The mass ends inside the painted beard (see beardPaint): coverage eroded over the skin, so the
  // ragged edge of the mass lies on hair-coloured skin and the outline is the soft painted one.
  const inner = new Float32Array(n);
  for (let t = 0; t < tris.length; t++) inner[tris[t]] = coverage(tris[t]);
  const sum = new Float32Array(n), cnt = new Float32Array(n);
  for (let pass = 0; pass < 3 && look.mass > 0; pass++) {
    sum.fill(0);
    cnt.fill(0);
    for (let t = 0; t < tris.length; t += 3) {
      const m = (inner[tris[t]] + inner[tris[t + 1]] + inner[tris[t + 2]]) / 3;
      for (let k = 0; k < 3; k++) {
        sum[tris[t + k]] += m;
        cnt[tris[t + k]]++;
      }
    }
    for (let v = 0; v < n; v++) if (cnt[v]) inner[v] = Math.min(inner[v], sum[v] / cnt[v]);
  }
  const shellOf = new Map<number, number>();
  const thickness = (v: number) => {
    const f: V3 = [face[v * 3], face[v * 3 + 1], face[v * 3 + 2]];
    // Fuller on the chin and jaw than high on the cheeks.
    const fullness = 0.7 + 0.3 * smoothstep(-0.6, -1.6, f[1]) + 0.15 * (1 - smoothstep(0.3, 1.0, Math.abs(f[0]))) * smoothstep(-1.3, -1.9, f[1]);
    return 0.0008 + look.mass * scaleK * fullness * smoothstep(0.35, 1.0, inner[v]) * (isMust(f) && style !== "mustache" ? 0.7 : 1);
  };
  const shellVert = (v: number) => {
    let i = shellOf.get(v);
    if (i !== undefined) return i;
    i = b.count;
    const nv: V3 = [nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]];
    const p: V3 = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
    b.follow = v;
    const u = 0.5 + 0.5 * Math.min(0.97, Math.max(0.03, face[v * 3] / 6 + 0.5));
    b.vert(add(p, mul(nv, thickness(v))), nv, u, inner[v], 1.1, vertexWeights(ctx, v));
    shellOf.set(v, i);
    return i;
  };
  for (let t = 0; t < tris.length && look.mass > 0; t += 3) {
    const a = tris[t], c = tris[t + 1], d = tris[t + 2];
    if (Math.max(coverage(a), coverage(c), coverage(d)) < 0.02) continue;
    b.idx.push(shellVert(a), shellVert(c), shellVert(d));
  }

  // --- Locks: wide tapered cards rooted in the mass, combed down (the mustache out to the sides).
  const roots = sampleSurface(ctx, look.locks, (x, y, z) => smoothstep(0.35, 0.8, beardCoverage(region, x, y, z)));
  for (const r of roots) {
    const must = isMust(r.f);
    let L = rng.range(look.len[0], look.len[1]) * scaleK;
    // Long beards: shorter on the cheeks, longest at the chin.
    const chinW = 1 - smoothstep(0.3, 1.1, Math.abs(r.f[0]));
    if (L > 0.06) L *= 0.35 + 0.65 * chinW;
    if (must) L = rng.range(0.02, style === "mustache" ? 0.045 : 0.03) * scaleK;
    const root = add(r.p, mul(r.n, thickness(r.v) * rng.range(0.2, 0.7)));
    const pts = growStrand(ctx, root, r.n, {
      segs: L > 0.06 ? 7 : 4, length: L, gravity: must ? 0.5 : 1, stiff: 0.05, volume: 0, curl: 0.08, curlFreq: 1, noise: 0.03,
      comb: (p, t) => {
        if (must) return norm([Math.sign(p[0] - chin[0]) * 0.8, -0.6, 0.2]);
        if (style === "forked" && t > 0.4) return norm([forkSide(p) * 0.35, -1, 0.1]);
        return norm([0, -1, 0.15]);
      },
      combK: 0.6, collideHead: false,
    });
    const wgt = vertexWeights(ctx, r.v);
    b.follow = r.v;
    const w = rng.range(look.width[0], look.width[1]) * scaleK * (must ? 0.85 : 1);
    const flip = rng.float() < 0.5;
    card(b, pts, (t) => w * (1 - t * 0.2), flip ? LOCK_U[1] : LOCK_U[0], flip ? LOCK_U[0] : LOCK_U[1], rng.range(0.8, 1.2), () => wgt, () => r.n);
  }
  if (style === "braided") {
    // A braid hanging from the chin: three twisted locks around one spine.
    const start = add(chin, [0, -0.07 * scaleK, 0.012]);
    const spine = growStrand(ctx, start, DOWN, { segs: 12, length: 0.15 * scaleK, gravity: 1, stiff: 0.05, volume: 0, curl: 0, curlFreq: 1, noise: 0, comb: () => DOWN, combK: 0.5, collideHead: false });
    const anchor = nearestVertex(ctx, add(chin, [0, -0.04, 0]));
    const wgt = vertexWeights(ctx, anchor);
    b.follow = anchor;
    for (let s = 0; s < 3; s++) {
      const pts = spine.map((p, i) => add(p, [Math.sin(i * 1.6 + s * 2.1) * 0.006, 0, Math.cos(i * 1.6 + s * 2.1) * 0.004]));
      card(b, pts, (t) => 0.024 * scaleK * (1 - t * 0.3), LOCK_U[0], LOCK_U[1], 0.95, () => wgt, () => FWD, s);
      card(b, pts, (t) => 0.024 * scaleK * (1 - t * 0.3), LOCK_U[0], LOCK_U[1], 0.9, () => wgt, () => [1, 0, 0], s);
    }
  }
}

// ------------------------------------------------------------------ horns, tusks, tail

/** A tube along a curve with a radius profile; `ridges` adds keratin rings. */
function tube(b: Builder, pts: V3[], radius: (t: number) => number, radial: number, weights: (p: V3, t: number) => Weights, ridges: number, shade: (t: number) => number = () => 1) {
  const base = b.count;
  const n = pts.length;
  let ref: V3 = Math.abs(norm(sub(pts[1], pts[0]))[1]) > 0.9 ? FWD : UP;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const tan = norm(sub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]));
    const s1 = norm(cross(tan, ref));
    const s2 = cross(s1, tan);
    ref = s2;
    const ring = ridges ? Math.sin(t * ridges * Math.PI * 2) : 0;
    const rr = radius(t) * (1 + 0.06 * ring);
    const w = weights(pts[i], t);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const dir = add(mul(s1, Math.cos(a)), mul(s2, Math.sin(a)));
      b.vert(add(pts[i], mul(dir, rr)), dir, j / radial, t, shade(t) * (1 + 0.08 * ring), w);
    }
  }
  for (let i = 0; i < n - 1; i++)
    for (let j = 0; j < radial; j++) {
      const a = base + i * (radial + 1) + j, c = a + radial + 1;
      b.idx.push(a, c, a + 1, a + 1, c, c + 1);
    }
}

function buildHorns(ctx: Ctx, style: HornStyle, hornSize: number, scale: number, b: Builder) {
  const { C, R } = ctx;
  const size = hornSize * (scale > 1.3 ? 1.2 : 1);
  if (style === "none" || size < 0.05) return;
  const headW = (): Weights => [[ctx.bone("head"), 1]];
  const S = R * (0.8 + size * 1.2);
  // Darker at the root, paler toward the tip.
  const shade = (t: number) => 0.72 + 0.4 * t;
  for (const s of [-1, 1]) {
    const curve: V3[] = [];
    const steps = 18;
    // Root on the upper forehead / temple, sunk into the skull so the horn grows out of it.
    const base = R * (0.12 + size * 0.08);
    const root = onSkull(ctx, [s * 0.55, 0.62, 0.45], base * 0.9);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      let p: V3;
      switch (style) {
        case "ram": {
          // Spiral back and round beside the ear.
          const ang = t * Math.PI * 1.55;
          const rr = S * 0.42 * (1 - t * 0.35);
          const center = add(root, [s * S * 0.12, -S * 0.12, -S * 0.3]);
          p = i === 0 ? root : add(center, [s * (S * 0.2 * t), Math.cos(ang + 0.6) * rr * 1.1, Math.sin(ang + 0.6) * rr - S * 0.1]);
          break;
        }
        case "straight":
          p = add(root, mul(norm([s * 0.25, 1, -0.35]), S * t * 0.95));
          break;
        case "antler":
          p = add(root, [s * S * 0.45 * t, S * 0.95 * t, -S * 0.25 * t * t]);
          break;
        case "crown":
          p = add(root, mul(norm([s * 0.3, 1, 0.1]), S * 0.35 * t));
          break;
        default:
          // Swept: back along the skull, then up.
          p = add(root, [s * S * 0.18 * t, S * (0.15 * t + 0.35 * t * t * t), -S * t]);
      }
      curve.push(p);
    }
    // A flared base where the horn meets the skin.
    tube(b, curve, (t) => base * (1 + 0.35 * Math.max(0, 1 - t * 8)) * Math.pow(1 - t, 0.75) + 0.0015, 12, headW, style === "ram" ? 9 : style === "straight" ? 6 : 4, shade);
    if (style === "antler") {
      // Two forward tines.
      for (const ft of [0.45, 0.72]) {
        const o = curve[Math.round(ft * steps)];
        const tine: V3[] = [];
        for (let i = 0; i <= 6; i++) tine.push(add(o, mul(norm([s * 0.2, 0.8, 0.6]), S * 0.32 * (i / 6))));
        tube(b, tine, (t) => base * 0.5 * (1 - t) + 0.001, 8, headW, 0, (t) => shade(ft + t * 0.3));
      }
    }
  }
  if (style === "crown") {
    // A ring of smaller spikes round the brow line.
    for (let k = -3; k <= 3; k++) {
      if (k === 0) continue;
      const ang = k * 0.32;
      const dir = norm([Math.sin(ang), 0.7, Math.cos(ang) * 0.75]);
      const root = onSkull(ctx, dir, R * 0.05);
      const tip = add(root, mul(dir, R * 0.3 * size + 0.01 + R * 0.05));
      tube(b, [root, lerp3(root, tip, 0.5), tip], (t) => R * 0.06 * (1 - t) + 0.001, 8, headW, 0, shade);
    }
  }
}

/** Z of the body's front surface at (x, y), near `z0`. */
function frontSurface(ctx: Ctx, x: number, y: number, z0: number): number {
  const pos = ctx.body.positions;
  let best = -Infinity;
  for (let v = 0; v < pos.length / 3; v++) {
    if (!ctx.body.isBody[v] || Math.abs(pos[v * 3] - x) > 0.005 || Math.abs(pos[v * 3 + 1] - y) > 0.005 || Math.abs(pos[v * 3 + 2] - z0) > 0.05) continue;
    best = Math.max(best, pos[v * 3 + 2]);
  }
  return Number.isFinite(best) ? best : z0;
}

function buildTusks(ctx: Ctx, tusks: number, scale: number, b: Builder) {
  if (tusks < 0.05) return;
  const mouth = ctx.body.mouth;
  const k = (0.018 + tusks * 0.026) * (scale > 1.3 ? 1.2 : 1);
  for (const s of [-1, 1]) {
    // Rooted in the lower lip near the mouth corners, so they rest in front of the upper lip.
    const x = mouth[0] + s * ctx.ipd * 0.38, y = mouth[1] - 0.009;
    // Deep enough that the whole base sits in the lip; the first point is inside the jaw.
    const r0 = k * 0.23;
    const root: V3 = [x, y, frontSurface(ctx, x, y, mouth[2]) - r0 * 1.2];
    const pts: V3[] = [add(root, [0, -r0 * 1.5, -r0 * 0.5])];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pts.push(add(root, [s * k * 0.16 * t, k * t, k * 0.12 * t + k * 0.18 * t * t]));
    }
    // Tusks move with the lower lip when the mouth opens.
    b.follow = nearestVertex(ctx, [x, y, root[2] + r0 * 1.2]);
    tube(b, pts, (t) => r0 * Math.pow(1 - t, 0.8) + 0.0008, 10, () => [[ctx.bone("head"), 1]], 0, (t) => 0.85 + 0.2 * t);
  }
}

/** Distance from the head centre to the skin along `dir` (the head is not a sphere). */
function skullRadius(ctx: Ctx, dir: V3): number {
  const { positions: pos } = ctx.body;
  const d = norm(dir);
  let sum = 0, n = 0, best = 0, bestDot = -1;
  for (let v = 0; v < pos.length / 3; v++) {
    if (!ctx.body.isBody[v]) continue;
    const rel: V3 = [pos[v * 3] - ctx.C[0], pos[v * 3 + 1] - ctx.C[1], pos[v * 3 + 2] - ctx.C[2]];
    const l = len(rel);
    if (l < ctx.R * 0.5 || l > ctx.R * 2) continue;
    const c = dot(rel, d) / l;
    if (c > bestDot) {
      bestDot = c;
      best = l;
    }
    if (c > 0.996) {
      sum += l;
      n++;
    }
  }
  return n ? sum / n : best || ctx.R;
}

/** A point on the skull surface in direction `dir`, sunk `sink` meters into the head. */
function onSkull(ctx: Ctx, dir: V3, sink: number): V3 {
  const d = norm(dir);
  return add(ctx.C, mul(d, skullRadius(ctx, d) - sink));
}

/** Tail root: on the lower back, just above the buttocks. */
function tailRoot(ctx: Ctx): { p: V3; v: number } {
  const { positions: pos } = ctx.body;
  const y = lerp3(ctx.head("pelvis"), ctx.head("spine_01"), 0.6)[1];
  let best = -1, bz = Infinity;
  for (let v = 0; v < pos.length / 3; v++) {
    if (!ctx.body.isBody[v] || Math.abs(pos[v * 3]) > 0.025 || Math.abs(pos[v * 3 + 1] - y) > 0.02) continue;
    if (pos[v * 3 + 2] < bz) {
      bz = pos[v * 3 + 2];
      best = v;
    }
  }
  const p: V3 = best >= 0 ? [0, y, bz + 0.012] : add(ctx.head("pelvis"), [0, 0, -0.1]);
  return { p, v: best };
}

/** Tail bone names, root to tip. */
export const TAIL_BONES = ["tail_01", "tail_02", "tail_03", "tail_04", "tail_05", "tail_06"];

function buildTail(ctx: Ctx, style: TailStyle, length: number, b: Builder) {
  if (style === "none" || length < 0.05) return;
  const { p: surface, v } = tailRoot(ctx);
  const H = ctx.height;
  const L = length * H * 0.62;
  const r0 = style === "thin" ? 0.022 * (H / 1.8) : style === "furred" ? 0.05 * (H / 1.8) : 0.065 * (H / 1.8);
  // The tube starts inside the body (one base radius in front of the skin) so the
  // whole base is buried, and leaves the lower back with a flare.
  const inside = add(surface, [0, r0 * 0.15, r0 * 1.1]);
  const pts: V3[] = [inside, add(surface, [0, r0 * 0.05, r0 * 0.45])];
  const segs = 28;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    // Out backwards, drooping, the end curling up a little (resting pose).
    pts.push(add(surface, [0, -L * (0.45 * t - 0.12 * t * t * t), -L * t * 0.95]));
  }
  // A chain of bones along the tail (parented to the pelvis) so it can sway.
  const N = TAIL_BONES.length;
  const at = (f: number) => pts[2 + Math.round(f * segs)];
  b.bones = TAIL_BONES.map((name, k) => ({ name, parent: k ? TAIL_BONES[k - 1] : "pelvis", head: at(k / N) }));
  const base = ctx.body.skeleton.names.length;
  const hips = vertexWeights(ctx, v);
  const n = pts.length;
  tube(
    b,
    pts,
    (t) => {
      const u = Math.max(0, (t * (n - 1) - 2) / segs);
      return (r0 * (1 - u * 0.92) + 0.003) * (1 + 0.3 * (1 - Math.min(1, u * 9)));
    },
    16,
    (_p, t) => {
      const u = Math.max(0, (t * (n - 1) - 2) / segs);
      // Base: blended with the body's own weights so the seam follows the hips.
      if (u < 0.04) return hips;
      const f = Math.min(N - 1e-3, u * N);
      const i0 = Math.floor(f), w1 = f - i0, i1 = Math.min(N - 1, i0 + 1);
      return i0 === 0 && w1 < 0.5 ? [[base, 0.5 + w1], ...hips.map(([j, w]): [number, number] => [j, w * (0.5 - w1)])] : [[base + i0, 1 - w1], [base + i1, w1]];
    },
    0,
  );
}

/** Per vertex: the body UV at the root (skin-material parts take the skin's colour from there). */
function flatUv(b: Builder, uvs: Float32Array, v: number) {
  const u = v >= 0 ? uvs[v * 2] : 0.5, w = v >= 0 ? uvs[v * 2 + 1] : 0.5;
  for (let i = 0; i < b.uv.length; i += 2) {
    b.uv[i] = u;
    b.uv[i + 1] = w;
  }
}

/** True if the config adds any part. */
export function hasParts(c: PartsConfig): boolean {
  return (c.horns !== "none" && c.hornSize > 0.05) || c.tusks > 0.05 || (c.tail !== "none" && c.tailLength > 0.05) || c.beard !== "none" || c.hair !== "none";
}

/** Builds the add-on meshes for a body. */
export function buildParts(body: PartsBody, c: PartsConfig): PartMesh[] {
  if (!hasParts(c)) return [];
  const ctx = context(body, c.seed, c.scale);
  const parts: PartMesh[] = [];
  const push = (name: string, kind: PartKind, fill: (b: Builder) => void, color?: [number, number, number]) => {
    const b = new Builder();
    fill(b);
    if (b.count) parts.push(b.build(name, kind, color));
  };
  if (c.hair === "leaves") push("leaves", "leaf", (b) => buildLeaves(ctx, b));
  if (c.hair === "crest")
    push("crest", "fin", (b) => {
      buildCrest(ctx, b);
      flatUv(b, body.uvs, nearestVertex(ctx, add(ctx.C, [0, ctx.R, 0])));
    });
  push("beard", "hair", (b) => buildBeard(ctx, c.beard, c.scale, b));
  push("horns", "horn", (b) => buildHorns(ctx, c.horns, c.hornSize, c.scale, b), c.hornColor);
  push("tusks", "tusk", (b) => buildTusks(ctx, c.tusks, c.scale, b), [0.9, 0.86, 0.74]);
  push(
    "tail",
    c.tail === "furred" ? "fur" : "skin",
    (b) => {
      buildTail(ctx, c.tail, c.tailLength, b);
      flatUv(b, body.uvs, tailRoot(ctx).v);
    },
  );
  return parts;
}

/** Eye centres (actor's left, right) of a shape, or null if the pack has no eyes. */
export function eyeCentres(shape: ActorShape, meshes: MeshData[]): [V3, V3] | null {
  const eyes = meshes.find((m) => m.def.material.kind === "eye" && !m.stencil);
  if (!eyes) return null;
  // Eyes may be a proxy (own vertex space) or base geometry.
  const src = eyes.def.source.kind === "proxy" ? shape.proxies.get(eyes.def.source.proxy)?.positions : shape.positions;
  if (!src) return null;
  const mean = (side: number): V3 => {
    let x = 0, y = 0, z = 0, w = 0;
    for (const v of new Set(eyes.map)) {
      if (src[v * 3] * side <= 0) continue;
      x += src[v * 3];
      y += src[v * 3 + 1];
      z += src[v * 3 + 2];
      w++;
    }
    return w ? [x / w, y / w, z / w] : [0.032 * side, 0, 0];
  };
  return [mean(1), mean(-1)];
}

/**
 * Collects what the builders need from an evaluated shape: body triangles and
 * skin weights (from the unsubdivided body mesh), eye centres, ear midpoint
 * and mouth. `earMasks`/`lipMask` are per-base-vertex masks (see ActorRuntime.targetMask).
 */
export function partsBody(shape: ActorShape, meshes: MeshData[], earMasks: [Float32Array, Float32Array] | null, lipMask: Float32Array | null): PartsBody | null {
  const body = meshes.find((m) => m.def.role === "body" && !m.stencil && m.joints && m.weights);
  const eyes = meshes.find((m) => m.def.material.kind === "eye" && !m.stencil);
  const sk = shape.skeleton;
  if (!body || !eyes || !sk) return null;
  const pos = shape.positions;
  const n = pos.length / 3;
  const joints = new Uint16Array(n * 4), weights = new Float32Array(n * 4), uvs = new Float32Array(n * 2), isBody = new Uint8Array(n);
  for (let i = 0; i < body.map.length; i++) {
    const v = body.map[i];
    isBody[v] = 1;
    for (let k = 0; k < 4; k++) {
      joints[v * 4 + k] = body.joints![i * 4 + k];
      weights[v * 4 + k] = body.weights![i * 4 + k];
    }
    uvs[v * 2] = body.uv[i * 2];
    uvs[v * 2 + 1] = body.uv[i * 2 + 1];
  }
  const triangles = new Uint32Array(body.indices.length);
  for (let i = 0; i < body.indices.length; i++) triangles[i] = body.map[body.indices[i]];
  const mean = (pick: (v: number) => number): V3 => {
    let x = 0, y = 0, z = 0, w = 0;
    for (let v = 0; v < n; v++) {
      const m = isBody[v] ? pick(v) : 0;
      if (m <= 0) continue;
      x += pos[v * 3] * m;
      y += pos[v * 3 + 1] * m;
      z += pos[v * 3 + 2] * m;
      w += m;
    }
    return w ? [x / w, y / w, z / w] : [0, 0, 0];
  };
  const centres = eyeCentres(shape, meshes);
  if (!centres) return null;
  const [eL, eR] = centres;
  const headJ = sk.heads[sk.names.indexOf("head")] as V3;
  const earMid = earMasks ? mul(add(mean((v) => (earMasks[0][v] > 0.5 ? 1 : 0)), mean((v) => (earMasks[1][v] > 0.5 ? 1 : 0))), 0.5) : add(headJ, [0, 0.06, 0]);
  const scale = len(sub(eL, eR)) / 0.064;
  const mouth: V3 = lipMask ? add(mean((v) => (lipMask[v] > 0.4 ? 1 : 0)), [0, -0.008 * scale, 0]) : add(eL, [-eL[0], -0.07 * scale, 0.01]);
  return { positions: pos, normals: shape.normals, triangles, joints, weights, uvs, isBody, skeleton: sk, eyes: [eL, eR], earMid, mouth };
}

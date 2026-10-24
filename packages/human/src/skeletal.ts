/**
 * Skeleton actors (undead): a full human skeleton generated from the current
 * body shape and skinned rigidly to the pack skeleton, so every clip plays on
 * it unchanged and the body sliders and races set its proportions.
 *
 * Every bone is placed from the fitted rig joints (hip, knee, ankle, shoulder,
 * elbow, wrist, finger joints) and from the body surface (torso outline for
 * the rib cage, back line for the spine, head measurements for the skull).
 * Bones are signed distance primitives blended on small grids and meshed with
 * Surface Nets (sdfgrid.ts); ribs, cartilage and clavicles are swept tubes.
 * Each piece is rigid on one bone: real bones don't bend, the gaps at the
 * joints hide the seams.
 *
 * Renderer-free and deterministic. Axes: +Y up, +Z forward, +X = actor's left.
 */
import type { ActorShape, MeshData, PartMesh, ShapeTask } from "@actors/core";
import { Builder, type Weights } from "./parts";
import { type RobotBody, robotBody } from "./robot";
import { AXES, type Frame, Grid, type Prim, type V3, blob, box, capsule, disc, ellipsoid, frameFrom, noise3, smax } from "./sdfgrid";

export interface SkeletalConfig {
  /** 0..1 bone thickness (gracile to robust). */
  robust: number;
  /** 0..1 weathering: pitted, eroded surfaces and stains. */
  wear: number;
  /** 0..1 how many small bones are lost (teeth, finger and toe bones, floating ribs). */
  missing: number;
  /** Lower jaw present. */
  jaw: boolean;
  /** Lights in the eye sockets. */
  eyes: boolean;
  /** A light inside the rib cage. */
  heart: boolean;
  /** Picks which bones are lost and the stain pattern. */
  seed: number;
}

export const DEFAULT_SKELETAL: SkeletalConfig = { robust: 0.5, wear: 0.35, missing: 0, jaw: true, eyes: true, heart: false, seed: 0.5 };

const clamp01 = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : d);

/** A valid skeleton config (bad values fall back to the defaults). */
export function sanitizeSkeletal(c: Partial<SkeletalConfig> | undefined): SkeletalConfig {
  const r = { ...DEFAULT_SKELETAL, ...c };
  return {
    robust: clamp01(r.robust, DEFAULT_SKELETAL.robust),
    wear: clamp01(r.wear, DEFAULT_SKELETAL.wear),
    missing: clamp01(r.missing, DEFAULT_SKELETAL.missing),
    jaw: r.jaw !== false,
    eyes: !!r.eyes,
    heart: !!r.heart,
    seed: clamp01(r.seed, DEFAULT_SKELETAL.seed),
  };
}

export interface SkeletalParts {
  parts: PartMesh[];
  /** How far the bones' lowest point sits above the body's (negative: the skeleton is lowered by that much to stand on its heels). */
  lift: number;
}

// ------------------------------------------------------------------ vectors

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
/** p + Σ axis_i · k_i */
const at3 = (p: V3, ...terms: [V3, number][]): V3 => terms.reduce((q, [a, k]) => add(q, mul(a, k)), p);

class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = (Math.floor(seed * 4294967295) ^ 0x51ed270b) >>> 0;
  }
  float(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

// ------------------------------------------------------------------ context

interface Ctx {
  body: RobotBody;
  c: SkeletalConfig;
  rng: Rng;
  bld: Builder;
  glow: Builder;
  bone: (n: string) => number;
  has: (n: string) => boolean;
  head: (n: string) => V3;
  tail: (n: string) => V3;
  /** Bone thickness factor. */
  k: number;
  /** Stature factor (1 = 1.75 m). */
  s: number;
  /** Lost-bone test: true with probability `p · missing`. */
  lost: (p: number) => boolean;
}

/** Meshes a grid as one rigid piece of `bone`, with wear and stains. */
function emit(ctx: Ctx, g: Grid, bone: string, wear = 1) {
  const { c } = ctx;
  const seed = Math.floor(c.seed * 1000);
  const amt = c.wear * wear;
  if (amt > 0)
    g.displace((q) => {
      // Pitting: fine noise only pushes inwards (holes, not warts); coarse noise erodes edges.
      const fine = noise3(q[0] * 900, q[1] * 900, q[2] * 900, seed);
      const coarse = noise3(q[0] * 160, q[1] * 160, q[2] * 160, seed + 7);
      return amt * (Math.max(0, fine - 0.25) * 0.0011 + Math.max(0, coarse) * 0.0008);
    }, 0.004);
  const w: Weights = [[Math.max(0, ctx.bone(bone)), 1]];
  g.mesh(ctx.bld, w, (p, _n, cavity) => {
    const stain = 0.5 + 0.5 * noise3(p[0] * 28, p[1] * 28, p[2] * 28, seed + 3);
    const blotch = Math.max(0, noise3(p[0] * 70, p[1] * 70, p[2] * 70, seed + 5));
    return (1 - cavity * 0.6) * (1 - amt * (0.22 * stain + 0.25 * blotch));
  });
}

/** Grid cells are scaled by this: the per-piece sizes were tuned for detail, 1.5 keeps the skeleton near 500k triangles and ~2 s to build. */
const RES = 1.5;

/** One piece: primitives blended on a grid (cell in m), with optional carving. */
function piece(ctx: Ctx, bone: string, cell: number, adds: [Prim, number][], carves: [Prim, number][] = [], wear = 1, post?: (g: Grid) => void, axis?: V3) {
  if (!adds.length) return;
  // Long pieces get a grid turned along their axis (the bone by default).
  const dir = axis ?? (ctx.has(bone) ? sub(ctx.tail(bone), ctx.head(bone)) : null);
  const frame = dir && len(dir) > 1e-6 ? frameFrom(dir, [1, 0, 0]) : AXES;
  const g = Grid.around(adds.map(([p]) => p), cell * RES, 0.004, frame);
  for (const [p, k] of adds) g.add(p, k);
  for (const [p, k] of carves) g.carve(p, k);
  post?.(g);
  emit(ctx, g, bone, wear);
}

/** A swept tube along `pts` with an elliptical section (`rw` across `side`, `rh` across the other axis), rigid on `bone`. Ends close to points. */
function tube(ctx: Ctx, bone: string | Weights, pts: V3[], rw: (t: number) => number, rh: (t: number) => number, side: (t: number) => V3, shade = 1, radial = 12) {
  const bld = ctx.bld;
  const w: Weights = typeof bone === "string" ? [[Math.max(0, ctx.bone(bone)), 1]] : bone;
  const n = pts.length;
  if (n < 2) return;
  const base = bld.count;
  const seed = Math.floor(ctx.c.seed * 1000);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const tan = norm(sub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]));
    const sd = side(t);
    const s = norm(sub(sd, mul(tan, dot(sd, tan))));
    const u = cross(tan, s);
    // Round the ends: the section shrinks over the last few percent.
    const e = Math.min(t, 1 - t);
    const cap = e < 0.04 ? Math.sqrt(Math.max(0.02, e / 0.04)) : 1;
    const a = rw(t) * cap, b = rh(t) * cap;
    for (let j = 0; j <= radial; j++) {
      const ang = (j / radial) * Math.PI * 2;
      const p = add(pts[i], add(mul(s, Math.cos(ang) * a), mul(u, Math.sin(ang) * b)));
      const nn = norm(add(mul(s, Math.cos(ang) / Math.max(1e-4, a)), mul(u, Math.sin(ang) / Math.max(1e-4, b))));
      const stain = 0.5 + 0.5 * noise3(p[0] * 28, p[1] * 28, p[2] * 28, seed + 3);
      bld.vert(p, nn, j / radial, t, shade * (1 - ctx.c.wear * 0.22 * stain), w);
    }
  }
  for (let i = 0; i < n - 1; i++)
    for (let j = 0; j < radial; j++) {
      const a = base + i * (radial + 1) + j, c = a + radial + 1;
      bld.idx.push(a, a + 1, c, a + 1, c + 1, c);
    }
}

/** Catmull-Rom points through `keys` (`per` samples per span). */
function spline(keys: V3[], per = 8): V3[] {
  const out: V3[] = [];
  const k = (i: number) => keys[Math.max(0, Math.min(keys.length - 1, i))];
  for (let i = 0; i < keys.length - 1; i++)
    for (let s = 0; s < per; s++) {
      const t = s / per;
      const a = k(i - 1), b = k(i), c = k(i + 1), d = k(i + 2);
      out.push([0, 1, 2].map((j) => 0.5 * (2 * b[j] + (c[j] - a[j]) * t + (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * t * t + (3 * b[j] - a[j] - 3 * c[j] + d[j]) * t * t * t)) as V3);
    }
  out.push(keys[keys.length - 1]);
  return out;
}

// ------------------------------------------------------------------ body measurements

/** Torso skin at height y: per angle (0 = back, π/2 = actor's left, π = front) the outermost skin distance from the slice centre. */
interface Slice {
  cx: number;
  cz: number;
  r: (angle: number) => number;
  /** Skin at the back and front of the midline. */
  back: number;
  front: number;
  half: number;
}

const BINS = 48;

function torsoSegments(ctx: Ctx): Set<number> {
  return new Set(["pelvis", "spine_01", "spine_02", "spine_03", "spine_04", "spine_05", "neck_01"].filter(ctx.has).map(ctx.bone));
}

function slice(ctx: Ctx, y: number, segs: Set<number>, band = 0.01): Slice | null {
  const { body } = ctx;
  const pos = body.positions;
  const sel: number[] = [];
  let cx = 0, cz = 0;
  for (let v = 0; v < pos.length / 3; v++) {
    if (!body.used[v] || Math.abs(pos[v * 3 + 1] - y) > band || !segs.has(body.joints[v * 4]) || body.weights[v * 4] < 0.4) continue;
    sel.push(v);
    cx += pos[v * 3];
    cz += pos[v * 3 + 2];
  }
  if (sel.length < 12) return null;
  cx = 0;
  cz /= sel.length;
  let rad = new Float32Array(BINS);
  let back = Infinity, front = -Infinity, half = 0;
  for (const v of sel) {
    const x = pos[v * 3], z = pos[v * 3 + 2];
    const dx = Math.abs(x), dz = z - cz;
    // Angle from the back (-Z) towards the side; symmetric.
    const ang = Math.atan2(dx, -dz);
    const bin = Math.min(BINS - 1, Math.round((ang / Math.PI) * (BINS - 1)));
    rad[bin] = Math.max(rad[bin], Math.hypot(dx, dz));
    if (dx < 0.02) {
      back = Math.min(back, z);
      front = Math.max(front, z);
    }
    half = Math.max(half, dx);
  }
  for (let j = 0; j < BINS; j++) if (!rad[j]) rad[j] = Math.max(rad[Math.max(0, j - 1)], rad[Math.min(BINS - 1, j + 1)]);
  for (let it = 0; it < 3; it++) rad = rad.map((x, j) => (rad[Math.max(0, j - 1)] + x * 2 + rad[Math.min(BINS - 1, j + 1)]) / 4);
  return {
    cx,
    cz,
    back: Number.isFinite(back) ? back : cz - 0.1,
    front: Number.isFinite(front) ? front : cz + 0.1,
    half,
    r: (a) => {
      const f = (Math.min(Math.PI, Math.abs(a)) / Math.PI) * (BINS - 1);
      const i = Math.min(BINS - 2, Math.floor(f));
      return rad[i] + (rad[i + 1] - rad[i]) * (f - i);
    },
  };
}

// ------------------------------------------------------------------ limbs

/** A limb frame at a bone: along the bone, lateral (away from the midline) and forward. */
function limbFrame(ctx: Ctx, name: string, side: number) {
  const h = ctx.head(name), t = ctx.tail(name);
  const d = norm(sub(t, h));
  let across = cross([0, 0, 1], d);
  if (len(across) < 0.2) across = [1, 0, 0];
  const lat = mul(norm(across), side);
  const fwd = norm(cross(d, norm(across)));
  return { h, t, d, lat, fwd, L: len(sub(t, h)) };
}

function buildLeg(ctx: Ctx, s: string, side: number) {
  if (!ctx.has(`thigh_${s}`) || !ctx.has(`calf_${s}`) || !ctx.has(`foot_${s}`)) return;
  const k = ctx.k;
  // Femur.
  {
    const { h: H, t: K, d, lat, fwd, L } = limbFrame(ctx, `thigh_${s}`, side);
    const up = mul(d, -1);
    const r = 0.03 * L * k;
    const troch = at3(H, [lat, 0.055 * L / 0.44], [d, 0.02]);
    const shaftTop = at3(H, [lat, 0.034], [d, 0.035]);
    const adds: [Prim, number][] = [
      [blob(H, [0.022 * L / 0.44, 0.022 * L / 0.44, 0.022 * L / 0.44].map((x) => x * Math.sqrt(k)) as V3), 0],
      // Neck: from the head out and down to the trochanters.
      [capsule(H, at3(H, [lat, 0.04], [d, 0.035]), 0.0135 * k, 0.016 * k), 0.008],
      [ellipsoid(troch, frameFrom(d, lat), [0.014 * k, 0.012 * k, 0.026 * k]), 0.01],
      [capsule(shaftTop, at3(K, [up, 0.11 * L / 0.44], [fwd, 0.004]), r * 1.05, r), 0.02],
      [capsule(at3(K, [up, 0.11 * L / 0.44], [fwd, 0.004]), at3(K, [up, 0.035]), r, r * 1.6), 0.02],
    ];
    // Condyles: two rounded knuckles behind and below the shaft end, and the patellar groove between them in front.
    for (const sd of [1, -1]) adds.push([ellipsoid(at3(K, [up, 0.022], [lat, sd * 0.021 * k], [fwd, -0.004]), frameFrom(fwd, lat), [0.015 * k, 0.019 * k, 0.026 * k]), 0.012]);
    // Linea aspera: a ridge down the back of the shaft.
    adds.push([capsule(at3(shaftTop, [fwd, -r * 0.6], [d, 0.06]), at3(K, [up, 0.14], [fwd, -r * 0.7]), r * 0.35, r * 0.35), 0.012]);
    const carves: [Prim, number][] = [[capsule(at3(K, [up, 0.06], [fwd, 0.03]), at3(K, [up, 0.0], [fwd, 0.03]), 0.006, 0.006), 0.006]];
    piece(ctx, `thigh_${s}`, 0.0022, adds, carves);
    // Patella.
    piece(ctx, `thigh_${s}`, 0.0016, [[ellipsoid(at3(K, [up, 0.03], [fwd, 0.031 * k]), frameFrom(fwd, lat), [0.02 * k, 0.023 * k, 0.009 * k]), 0]]);
  }
  // Tibia and fibula.
  {
    const { h: K, t: A, d, lat, fwd, L } = limbFrame(ctx, `calf_${s}`, side);
    const up = mul(d, -1);
    const r = 0.028 * L * k;
    const top = at3(K, [d, 0.022]);
    const adds: [Prim, number][] = [
      // Plateau: wide, flat top under both condyles.
      [ellipsoid(top, frameFrom(d, lat), [0.037 * k, 0.03 * k, 0.017]), 0],
      [capsule(at3(top, [d, 0.03], [fwd, 0.012]), at3(top, [d, 0.06], [fwd, 0.018]), 0.008 * k, 0.006 * k), 0.012],
      [capsule(at3(top, [d, 0.02]), at3(A, [up, 0.07], [lat, -0.004], [fwd, 0.004]), r * 1.25, r), 0.02],
      [capsule(at3(A, [up, 0.07], [lat, -0.004], [fwd, 0.004]), at3(A, [up, 0.015], [lat, -0.002]), r, r * 1.5), 0.015],
      // Medial malleolus.
      [ellipsoid(at3(A, [up, 0.004], [lat, -0.018 * k]), frameFrom(d, lat), [0.007 * k, 0.012 * k, 0.012]), 0.008],
      // Anterior crest.
      [capsule(at3(top, [d, 0.05], [fwd, r * 0.9]), at3(A, [up, 0.12], [fwd, r * 0.6]), r * 0.3, r * 0.2), 0.01],
    ];
    piece(ctx, `calf_${s}`, 0.0022, adds);
    const fh = at3(K, [d, 0.035], [lat, 0.03 * k], [fwd, -0.012]);
    const fm = at3(A, [up, 0.0], [lat, 0.024 * k], [fwd, -0.01]);
    piece(ctx, `calf_${s}`, 0.0016, [
      [blob(fh, [0.009 * k, 0.009 * k, 0.009 * k]), 0],
      [capsule(fh, at3(fm, [up, 0.03]), 0.0055 * k, 0.0055 * k), 0.006],
      [capsule(at3(fm, [up, 0.03]), fm, 0.0055 * k, 0.008 * k), 0.006],
    ]);
  }
  buildFoot(ctx, s, side);
}

function buildFoot(ctx: Ctx, s: string, side: number) {
  const k = ctx.k;
  const A = ctx.head(`foot_${s}`);
  const B = ctx.has(`ball_${s}`) ? ctx.head(`ball_${s}`) : ctx.tail(`foot_${s}`);
  const T = ctx.has(`ball_${s}`) ? ctx.tail(`ball_${s}`) : add(B, [0, 0, 0.05]);
  // Foot frame: forward along the ground, lateral, up.
  const fl = norm([B[0] - A[0], 0, B[2] - A[2]]);
  const lat = mul(norm(cross([0, 1, 0], fl)), -side);
  const up: V3 = [0, 1, 0];
  const footLen = len(sub([T[0], 0, T[2]], [A[0], 0, A[2]]));
  const f = footLen / 0.2;
  // The sole sits at the body's lowest point under the foot.
  const sole = Math.min(T[1], B[1]) - 0.025 * f;
  const tarsal: [Prim, number][] = [];
  // Talus under the ankle, calcaneus to the heel.
  const talus = at3(A, [up, -0.012]);
  const heel = at3([A[0], sole + 0.022 * f, A[2]], [fl, -0.055 * f], [lat, 0.004]);
  tarsal.push([ellipsoid(talus, frameFrom(fl, lat), [0.016 * k, 0.014 * k, 0.026 * f]), 0]);
  tarsal.push([capsule(at3(talus, [up, -0.018], [fl, 0.01], [lat, 0.008]), heel, 0.016 * k, 0.019 * k), 0.01]);
  // Midfoot: navicular, cuboid and cuneiforms as a block of small bones.
  const mid = lerp3(at3(A, [fl, 0.045 * f], [up, -0.02 * f]), at3(B, [fl, -0.075 * f]), 0.3);
  for (const [l, fw, r] of [[-0.016, 0, 0.011], [0.0, 0.006, 0.01], [0.018, -0.004, 0.011], [-0.012, 0.022, 0.008], [0.004, 0.024, 0.008], [0.02, 0.02, 0.009]] as const)
    tarsal.push([blob(at3(mid, [lat, l * f], [fl, fw * f], [up, -Math.abs(l) * 0.4]), [r * k, r * 0.85 * k, r * 1.1 * k]), 0.004]);
  piece(ctx, `foot_${s}`, 0.0018, tarsal);
  // Metatarsals: from the midfoot to the ball joints, fanning out across the foot.
  const widths = [-0.026, -0.009, 0.004, 0.017, 0.029];
  const meta: [Prim, number][] = [];
  const toeRoots: V3[] = [];
  widths.forEach((wx, i) => {
    const base = at3(mid, [fl, 0.03 * f], [lat, wx * 0.75 * f], [up, -0.004 - Math.abs(i - 2) * 0.002]);
    const headP = at3([B[0], sole + (i === 0 ? 0.014 : 0.011) * f, B[2]], [lat, wx * f], [fl, (i === 0 ? 0.004 : -0.004 * (i - 1)) * f]);
    const r = (i === 0 ? 0.0075 : 0.0045) * k;
    meta.push([capsule(base, headP, r * 1.25, r), 0.003], [blob(headP, [r * 1.35, r * 1.35, r * 1.35]), 0.003], [blob(base, [r * 1.5, r * 1.4, r * 1.6]), 0.003]);
    toeRoots.push(headP);
  });
  piece(ctx, `foot_${s}`, 0.0014, meta);
  // Toes on the ball bone: phalanges towards the toe tip, the outer toes shorter.
  const toes: [Prim, number][] = [];
  const tipLen = len(sub([T[0], 0, T[2]], [B[0], 0, B[2]]));
  toeRoots.forEach((root, i) => {
    const n = i === 0 ? 2 : 3;
    const total = tipLen * (i === 0 ? 0.92 : [1, 0.86, 0.76, 0.68, 0.6][i]) - 0.006;
    const r0 = (i === 0 ? 0.0068 : 0.0038) * k;
    let p = at3(root, [fl, (i === 0 ? 0.012 : 0.008) * f]);
    const segs = i === 0 ? [0.55, 0.45] : [0.5, 0.27, 0.23];
    for (let j = 0; j < n; j++) {
      if (j === n - 1 && ctx.lost(0.35)) break;
      const q = at3(p, [fl, total * segs[j]], [up, -0.003 * f], [lat, i === 4 ? 0.002 : 0]);
      const r = r0 * (1 - j * 0.18);
      toes.push([capsule(at3(p, [fl, 0.0015]), at3(q, [fl, -0.0015]), r, r * 0.8), 0.002], [blob(at3(q, [fl, -0.002]), [r * 1.05, r * 0.9, r]), 0.002]);
      p = q;
    }
  });
  piece(ctx, ctx.has(`ball_${s}`) ? `ball_${s}` : `foot_${s}`, 0.0011, toes);
}

function buildArm(ctx: Ctx, s: string, side: number) {
  if (!ctx.has(`upperarm_${s}`) || !ctx.has(`lowerarm_${s}`)) return;
  const k = ctx.k;
  let elbowLat: V3 = [side, 0, 0];
  // Humerus.
  {
    const { h: S, t: E, d, lat, fwd, L } = limbFrame(ctx, `upperarm_${s}`, side);
    elbowLat = lat;
    const r = 0.033 * L * k;
    const adds: [Prim, number][] = [
      [blob(at3(S, [lat, -0.004]), [0.022 * k, 0.022 * k, 0.022 * k]), 0],
      // Greater tubercle.
      [ellipsoid(at3(S, [lat, 0.012], [fwd, 0.006], [d, 0.012]), frameFrom(d, lat), [0.012 * k, 0.012 * k, 0.018]), 0.008],
      [capsule(at3(S, [d, 0.04]), at3(E, [d, -0.05]), r * 1.1, r), 0.018],
      [capsule(at3(E, [d, -0.05]), at3(E, [d, -0.012]), r, r * 1.2), 0.015],
      // Condyles across the elbow, epicondyles at both ends (the medial one bigger).
      [ellipsoid(at3(E, [d, -0.008], [fwd, 0.003]), frameFrom(lat, fwd), [0.011 * k, 0.012 * k, 0.022 * k]), 0.01],
      [blob(at3(E, [d, -0.016], [lat, -0.03 * k]), [0.008 * k, 0.008 * k, 0.008 * k]), 0.01],
      [blob(at3(E, [d, -0.016], [lat, 0.025 * k]), [0.006 * k, 0.006 * k, 0.006 * k]), 0.01],
      // Deltoid tuberosity.
      [capsule(at3(S, [d, L * 0.3], [lat, r * 0.7]), at3(S, [d, L * 0.45], [lat, r * 0.7]), r * 0.35, r * 0.2), 0.01],
    ];
    piece(ctx, `upperarm_${s}`, 0.002, adds, [[blob(at3(E, [d, -0.022], [fwd, -0.014]), [0.008, 0.009, 0.007]), 0.005]]);
  }
  // Radius and ulna.
  {
    const { h: E, t: W, d, fwd, L } = limbFrame(ctx, `lowerarm_${s}`, side);
    // Thumb side at the wrist (follows pronation); at the elbow the radius sits on the lateral condyle.
    let radial = elbowLat;
    if (ctx.has(`thumb_01_${s}`) && ctx.has(`pinky_01_${s}`)) {
      const q = sub(ctx.head(`thumb_01_${s}`), ctx.head(`pinky_01_${s}`));
      radial = norm(sub(q, mul(d, dot(q, d))));
    }
    const el = norm(sub(elbowLat, mul(d, dot(elbowLat, d))));
    const r = 0.022 * L * k;
    const ulna: [Prim, number][] = [
      // Olecranon behind the elbow.
      [ellipsoid(at3(E, [el, -0.008], [fwd, -0.014], [d, 0.002]), frameFrom(d, el), [0.011 * k, 0.012 * k, 0.018]), 0],
      [capsule(at3(E, [el, -0.008], [d, 0.012]), at3(W, [radial, -0.01], [d, -0.012]), r * 1.2, r * 0.75), 0.01],
      [blob(at3(W, [radial, -0.011], [d, -0.01]), [0.0075 * k, 0.0075 * k, 0.0075 * k]), 0.005],
    ];
    piece(ctx, `lowerarm_${s}`, 0.0018, ulna);
    const rad: [Prim, number][] = [
      [capsule(at3(E, [el, 0.014], [d, 0.004]), at3(E, [el, 0.013], [d, 0.016]), 0.0105 * k, 0.0105 * k), 0],
      [capsule(at3(E, [el, 0.012], [d, 0.02]), at3(W, [radial, 0.008], [d, -0.03]), r * 0.85, r * 1.05), 0.008],
      [ellipsoid(at3(W, [radial, 0.004], [d, -0.012]), frameFrom(d, radial), [0.016 * k, 0.011 * k, 0.012]), 0.012],
    ];
    piece(ctx, `lowerarm_${s}`, 0.0018, rad);
  }
  buildHand(ctx, s, side);
}

const FINGERS = ["index", "middle", "ring", "pinky"];

function buildHand(ctx: Ctx, s: string, side: number) {
  if (!ctx.has(`hand_${s}`)) return;
  const k = Math.sqrt(ctx.k);
  const W = ctx.head(`hand_${s}`);
  const tips = FINGERS.filter((f) => ctx.has(`${f}_01_${s}`)).map((f) => ctx.head(`${f}_01_${s}`));
  if (!tips.length) return;
  const knuckles = tips.reduce((a, b) => add(a, mul(b, 1 / tips.length)), [0, 0, 0] as V3);
  const hd = norm(sub(knuckles, W));
  const hl = len(sub(knuckles, W));
  const across = tips.length > 1 ? norm(sub(tips[0], tips[tips.length - 1])) : ([1, 0, 0] as V3);
  const palm = norm(cross(hd, across));
  const f = hl / 0.095;
  // Carpals: two rows of small bones just past the wrist.
  const carpal: [Prim, number][] = [];
  for (let row = 0; row < 2; row++)
    for (let i = 0; i < 4; i++) {
      const x = (i - 1.5) * 0.0105 * f;
      const c = at3(W, [hd, (0.008 + row * 0.014) * f], [across, x * (row ? 1.05 : 0.9)]);
      carpal.push([blob(c, [0.0062 * k * f, 0.0058 * k * f, 0.006 * k * f]), 0.002]);
    }
  piece(ctx, `hand_${s}`, 0.0011, carpal);
  // Metacarpals: from the carpals to each finger's first joint.
  const meta: [Prim, number][] = [];
  FINGERS.forEach((fn, i) => {
    if (!ctx.has(`${fn}_01_${s}`)) return;
    const j = ctx.head(`${fn}_01_${s}`);
    const base = at3(W, [hd, 0.026 * f], [across, (1.5 - i) * 0.0105 * f]);
    const r = (i === 0 || i === 1 ? 0.0042 : 0.0036) * k * f;
    const end = at3(j, [hd, -0.005 * f]);
    meta.push([capsule(base, end, r * 1.2, r), 0.002], [blob(end, [r * 1.45, r * 1.45, r * 1.45]), 0.002], [blob(base, [r * 1.5, r * 1.4, r * 1.4]), 0.002]);
  });
  piece(ctx, `hand_${s}`, 0.001, meta);
  // Phalanges on each finger bone (the thumb's first bone is its metacarpal).
  for (const fn of [...FINGERS, "thumb"]) {
    for (let n = 1; n <= 3; n++) {
      const b = `${fn}_0${n}_${s}`;
      if (!ctx.has(b)) continue;
      if (n === 3 && ctx.lost(0.4)) break;
      if (n === 2 && fn !== "thumb" && ctx.lost(0.12)) break;
      const h = ctx.head(b), t = ctx.tail(b);
      const d = norm(sub(t, h)), L = len(sub(t, h));
      const thumb = fn === "thumb";
      const r0 = (thumb ? (n === 1 ? 0.0052 : 0.0048) : fn === "pinky" ? 0.0036 : 0.0042) * k * (n === 3 ? 0.8 : n === 2 ? 0.88 : 1) * f;
      const a = at3(h, [d, 0.0018]);
      const e = at3(t, [d, n === 3 ? -0.004 * f : -0.0018]);
      const prims: [Prim, number][] = [
        [blob(at3(a, [d, r0 * 0.6]), [r0 * 1.35, r0 * 1.25, r0 * 1.35]), 0],
        [capsule(at3(a, [d, r0]), at3(e, [d, -r0 * 0.8]), r0 * 0.95, r0 * 0.72), 0.002],
      ];
      if (n === 3) prims.push([ellipsoid(at3(e, [d, -r0 * 0.4]), frameFrom(d, across), [r0 * 0.9, r0 * 0.6, r0 * 0.9]), 0.0015]);
      else prims.push([ellipsoid(at3(e, [d, -r0 * 0.6]), frameFrom(d, across), [r0 * 1.15, r0 * 0.9, r0 * 0.9]), 0.0015]);
      void L;
      void palm;
      piece(ctx, b, 0.0008, prims);
    }
  }
  void side;
}

// ------------------------------------------------------------------ spine, ribs, pelvis

interface Vertebra {
  /** Centre of the vertebral body. */
  c: V3;
  /** Along the spine (up). */
  up: V3;
  /** Backwards (towards the spinous process), perpendicular to up. */
  back: V3;
  level: "C" | "T" | "L";
  index: number;
  bone: string;
  /** Skin at the back, along `back`. */
  skin: number;
}

/** The bone a point along the trunk belongs to: the last trunk bone whose head is below it. */
function trunkBone(ctx: Ctx, y: number): string {
  const chain = ["pelvis", "spine_01", "spine_02", "spine_03", "spine_04", "spine_05", "neck_01", "neck_02", "head"].filter(ctx.has);
  let best = chain[0];
  for (const n of chain) if (ctx.head(n)[1] <= y + 1e-6) best = n;
  return best;
}

function spineCurve(ctx: Ctx): { vert: Vertebra[]; sacrumTop: V3; neckTop: V3 } | null {
  if (!ctx.has("pelvis") || !ctx.has("head") || !ctx.has("neck_01")) return null;
  const segs = torsoSegments(ctx);
  const hipL = ctx.has("thigh_l") ? ctx.head("thigh_l") : ctx.head("pelvis");
  const hipR = ctx.has("thigh_r") ? ctx.head("thigh_r") : ctx.head("pelvis");
  const hipY = (hipL[1] + hipR[1]) / 2;
  const neck = ctx.head("neck_01"), skull = ctx.head("head");
  // Back skin along the midline gives the spine's curve; the vertebral bodies sit a fixed depth in front of it.
  const y0 = hipY + 0.085 * ctx.s, y1 = neck[1];
  const samples: { y: number; back: number; front: number }[] = [];
  for (let i = 0; i <= 16; i++) {
    const y = y0 + ((y1 - y0) * i) / 16;
    const sl = slice(ctx, y, segs, 0.012);
    if (sl) samples.push({ y, back: sl.back, front: sl.front });
  }
  if (samples.length < 4) return null;
  // Smooth the back line.
  const back = samples.map((s) => s.back);
  for (let it = 0; it < 3; it++) for (let i = 1; i < back.length - 1; i++) back[i] = (back[i - 1] + back[i] * 2 + back[i + 1]) / 4;
  const backAt = (y: number) => {
    if (y <= samples[0].y) return back[0];
    for (let i = 0; i + 1 < samples.length; i++) if (y <= samples[i + 1].y) return back[i] + ((back[i + 1] - back[i]) * (y - samples[i].y)) / (samples[i + 1].y - samples[i].y);
    return back[back.length - 1];
  };
  const vert: Vertebra[] = [];
  // Lumbar 5 + thoracic 12 from the sacrum to the neck base; heights by typical vertebra size.
  const sizes = [...Array(5).fill(1.32), ...[0.84, 0.86, 0.9, 0.94, 0.98, 1.02, 1.06, 1.1, 1.14, 1.18, 1.22, 1.26].reverse()];
  const total = sizes.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let i = 0; i < sizes.length; i++) {
    const t = (acc + sizes[i] / 2) / total;
    acc += sizes[i];
    const y = y0 + (y1 - y0) * t;
    const lumbar = i < 5;
    // Depth of the body centre in front of the back skin (lumbar bodies are deeper and bigger).
    const depth = lumbar ? 0.075 : 0.06 - (i - 5) * 0.0006;
    const c: V3 = [0, y, backAt(y) + depth * ctx.s];
    vert.push({ c, up: [0, 1, 0], back: [0, 0, -1], level: lumbar ? "L" : "T", index: lumbar ? 5 - i : 12 - (i - 5), bone: trunkBone(ctx, y), skin: backAt(y) });
  }
  // Cervical: 7 from the neck base to the skull base, curving forward (lordosis).
  const baseC = vert[vert.length - 1].c;
  const topC: V3 = [0, skull[1] - 0.012 * ctx.s, skull[2] - 0.006];
  for (let i = 0; i < 7; i++) {
    const t = (i + 1) / 7.6;
    const c = lerp3(baseC, topC, t);
    c[2] += Math.sin(t * Math.PI) * 0.008 * ctx.s;
    vert.push({ c, up: [0, 1, 0], back: [0, 0, -1], level: "C", index: 7 - i, bone: t > 0.85 ? "head" : "neck_01", skin: c[2] - 0.05 });
  }
  // Tangents along the column.
  for (let i = 0; i < vert.length; i++) {
    const a = vert[Math.max(0, i - 1)].c, b = vert[Math.min(vert.length - 1, i + 1)].c;
    const up = norm(sub(b, a));
    vert[i].up = up;
    vert[i].back = norm(cross(up, [1, 0, 0]));
    if (vert[i].back[2] > 0) vert[i].back = mul(vert[i].back, -1);
  }
  const sacrumTop = sub(vert[0].c, mul(vert[0].up, 0.03 * ctx.s));
  return { vert, sacrumTop, neckTop: topC };
}

function buildVertebra(ctx: Ctx, v: Vertebra, spacing: number) {
  const { c, up, back } = v;
  const lat: V3 = [1, 0, 0];
  const s = ctx.s * Math.sqrt(ctx.k);
  const L = v.level === "L", T = v.level === "T", C = v.level === "C";
  // Body radius grows down the column (cervical small, lumbar big).
  const bodyR = (L ? 0.02 : T ? 0.0115 + (v.index - 1) * 0.0007 : 0.0085) * s;
  const bodyH = Math.max(0.003, spacing * (C ? 0.3 : 0.36));
  const adds: [Prim, number][] = [];
  const cell = C ? 0.0011 : 0.0014;
  const bf = frameFrom(up, lat);
  if (!(C && v.index === 1)) adds.push([disc(c, { u: bf.u, v: bf.v, w: bf.w }, bodyR * 1.15, bodyR * 0.88, bodyH, 0.0022 * s), 0]);
  else adds.push([ellipsoid(at3(c, [back, -0.004]), bf, [0.006, 0.004, 0.004]), 0]);
  // Arch: pedicles from the back of the body, laminae meeting behind the canal.
  const canal = (L ? 0.011 : T ? 0.0085 : 0.0095) * s;
  const archC = at3(c, [back, bodyR * 0.88 + canal]);
  const thick = (L ? 0.0045 : T ? 0.0036 : 0.003) * s;
  const proc = (L ? 0.03 : T ? 0.03 : 0.016) * s;
  for (const sd of [1, -1]) {
    const ped = at3(c, [back, bodyR * 0.75], [lat, sd * bodyR * 0.55]);
    const corner = at3(archC, [lat, sd * canal * 0.95], [back, -canal * 0.35]);
    adds.push([capsule(ped, corner, thick, thick), 0.003]);
    adds.push([capsule(corner, at3(archC, [back, canal * 0.25]), thick, thick * 0.9), 0.003]);
    // Transverse processes: thoracic ones reach back to meet the ribs, lumbar ones stick straight out.
    const tlen = (L ? 0.03 : T ? 0.024 : C && v.index === 1 ? 0.026 : 0.014) * s;
    const tdir = norm(add(mul(lat, sd), mul(back, T ? 0.6 : 0.05)));
    adds.push([capsule(corner, at3(corner, [tdir, tlen]), thick * 0.95, thick * (T ? 1.2 : 0.75)), 0.004]);
    // Articular facets above and below.
    for (const dy of [1, -1]) adds.push([ellipsoid(at3(corner, [up, dy * bodyH * 1.05]), bf, [thick * 1.2, thick * 1.2, thick * 1.4]), 0.003]);
  }
  // Spinous process: thoracic ones slope steeply down, lumbar ones are flat hatchets, cervical ones short and forked.
  const lamC = at3(archC, [back, canal * 0.25]);
  const sdir = norm(add(back, mul(up, T ? -0.85 : L ? -0.12 : -0.3)));
  if (L) adds.push([box(at3(lamC, [sdir, proc * 0.5]), frameFrom(sdir, lat), [thick * 0.6, proc * 0.5, 0.009 * s], 0.002), 0.004]);
  else adds.push([capsule(lamC, at3(lamC, [sdir, proc]), thick * 0.95, C ? thick * 1.2 : thick * 0.8, lat, [C ? 1.4 : 0.8, 1.3]), 0.004]);
  piece(ctx, v.bone, cell, adds, [], 0.6, undefined, up);
}

/** Rib cage width and depth per rib against the widest ribs (the cage is narrow at the top, widest at ribs 7 to 9). */
const RIB_WIDTH = [0.48, 0.64, 0.75, 0.83, 0.89, 0.94, 0.98, 1, 1, 0.98, 0.95, 0.9];
const RIB_DEPTH = [0.55, 0.68, 0.77, 0.84, 0.89, 0.93, 0.96, 0.98, 1, 1, 0.98, 0.95];

/** Ribs, costal cartilage and sternum. Returns the sternum's top (for the clavicles). */
function buildThorax(ctx: Ctx, vert: Vertebra[]): { notch: V3 } | null {
  const thoracic = vert.filter((v) => v.level === "T").sort((a, b) => a.index - b.index);
  if (thoracic.length < 12) return null;
  const segs = torsoSegments(ctx);
  const s = ctx.s;
  const rk = Math.sqrt(ctx.k);
  // The widest part of the cage follows the torso below the armpits, minus the muscle over the ribs.
  const ref = slice(ctx, thoracic[8].c[1] - 0.02 * s, segs, 0.015);
  if (!ref) return null;
  const spineZ = thoracic[8].c[2];
  const half = Math.max(0.09 * s, ref.r(Math.PI / 2) - 0.022 * s);
  const frontZ = ref.cz + ref.r(Math.PI) - 0.018 * s;
  // Cage centre between the spine and the front of the chest.
  const cz = (spineZ + frontZ) / 2 - 0.004 * s;
  const deep = (frontZ - spineZ) / 2 + 0.012 * s;
  const t1 = thoracic[0];
  const notchY = t1.c[1] - 0.05 * s;
  const xiphY = thoracic[8].c[1] - 0.045 * s;
  const sternumTop: V3 = [0, notchY, cz + deep * RIB_DEPTH[1] + 0.004 * s];
  const sternumBot: V3 = [0, xiphY, cz + deep * RIB_DEPTH[6] + 0.002 * s];
  const sternumAt = (t: number) => lerp3(sternumTop, sternumBot, t);
  for (let i = 0; i < 12; i++) {
    const v = thoracic[i];
    const n = i + 1;
    if (n >= 11 && ctx.lost(0.6)) continue;
    // Ribs slope down towards the front; lower ribs more.
    const yb = v.c[1] + 0.002;
    const drop = (0.05 + i * 0.007) * s;
    const W = half * RIB_WIDTH[i], D = deep * RIB_DEPTH[i];
    // Reach around the body: true ribs reach the front, false ribs less, floating ribs stop at the side.
    const reach = n <= 7 ? 0.86 : n <= 10 ? 0.86 - (n - 7) * 0.04 : n === 11 ? 0.56 : 0.46;
    const sternal = n <= 7 ? sternumAt(Math.min(1, (n - 1) / 6.2)) : null;
    for (const side of [1, -1]) {
      if (n >= 8 && ctx.lost(0.08)) continue;
      const keys: V3[] = [];
      // Head at the vertebral body, neck past the transverse process, then the angle and the curve round the side.
      keys.push(at3(v.c, [v.back, 0.004 * s], [[side, 0, 0], 0.011 * s]));
      keys.push(at3(v.c, [v.back, 0.022 * s], [[side, 0, 0], 0.03 * s], [[0, 1, 0], -0.003 * s]));
      const steps = 9;
      for (let j = 1; j <= steps; j++) {
        const u = j / steps;
        const ang = 0.5 + (reach * Math.PI - 0.5) * u;
        // A superellipse round the cage centre, flatter at the back (the ribs swing behind the spine).
        const sx = Math.sin(ang), cx = Math.cos(ang);
        const back = cx > 0;
        const ex = Math.sign(sx) * Math.pow(Math.abs(sx), 0.8), ez = Math.sign(cx) * Math.pow(Math.abs(cx), back ? 0.7 : 1);
        const y = yb - drop * (u * u * (3 - 2 * u));
        keys.push([side * W * ex, y, cz - ez * D * (back ? 1.02 : 1)]);
      }
      const pts = spline(keys, 4);
      const bone = trunkBone(ctx, yb - drop * 0.3);
      const hw = (n === 1 ? 0.0078 : n <= 7 ? 0.0056 + n * 0.0002 : 0.006 - (n - 8) * 0.0005) * s * rk;
      const ht = 0.0024 * s * rk;
      tube(ctx, bone, pts, (t) => (t < 0.12 ? ht * 1.9 + (hw - ht * 1.9) * (t / 0.12) : hw * (1 - 0.15 * t)), (t) => (t < 0.12 ? ht * 1.9 : ht), () => [0, 1, 0], 1, 10);
      // Costal cartilage to the sternum (true ribs) or up to the rib above (false ribs).
      const end = pts[pts.length - 1];
      let target: V3 | null = null;
      if (sternal) target = [side * (n === 1 ? 0.02 : 0.013) * s, sternal[1], sternal[2] - 0.003 * s];
      else if (n <= 10) {
        const t7 = sternumAt(1);
        target = [side * (0.03 + (n - 7) * 0.022) * s, t7[1] - (n - 7) * 0.03 * s, t7[2] - (n - 7) * 0.02 * s];
      }
      if (target) {
        const mid = lerp3(end, target, 0.5);
        mid[1] -= (n <= 7 ? 0.003 * (n - 1) : 0.008) * s;
        mid[2] += 0.004 * s;
        const cpts = spline([end, mid, target], 6);
        tube(ctx, bone, cpts, () => hw * 0.75, () => ht * 1.2, () => [0, 1, 0], 0.8, 8);
      }
    }
  }
  // Sternum: manubrium, body (four fused segments) and xiphoid, following the chest's front.
  const sd = norm(sub(sternumBot, sternumTop));
  const sf = frameFrom(sd, [1, 0, 0]);
  const stL = len(sub(sternumBot, sternumTop));
  const st: [Prim, number][] = [
    [ellipsoid(at3(sternumTop, [sd, 0.02 * s]), sf, [0.026 * s, 0.0048 * s, 0.022 * s]), 0],
  ];
  for (let k = 0; k < 4; k++) {
    const t = 0.32 + k * 0.17;
    st.push([ellipsoid(at3(sternumTop, [sd, stL * t]), sf, [(0.0135 + k * 0.0008) * s, 0.0042 * s, stL * 0.11]), 0.008]);
  }
  st.push([capsule(at3(sternumBot, [sd, -0.01 * s]), at3(sternumBot, [sd, 0.03 * s]), 0.007 * s, 0.003 * s, [1, 0, 0], [1.2, 0.45]), 0.004]);
  piece(ctx, trunkBone(ctx, sternumTop[1] - 0.05), 0.0016, st, [[blob(at3(sternumTop, [sd, -0.004]), [0.009 * s, 0.008, 0.01]), 0.004]], 1, undefined, sd);
  return { notch: sternumTop };
}

function buildPelvis(ctx: Ctx, sacrumTop: V3) {
  if (!ctx.has("thigh_l") || !ctx.has("thigh_r")) return;
  const HL = ctx.head("thigh_l"), HR = ctx.head("thigh_r");
  const s = ctx.s, k = Math.sqrt(ctx.k);
  const hw = Math.abs(HL[0] - HR[0]) / 2;
  const hy = (HL[1] + HR[1]) / 2, hz = (HL[2] + HR[2]) / 2;
  const ops: Op[] = [];
  const P = (x: number, y: number, z: number): V3 => [x, hy + y * s, hz + z * s];
  for (const sd of [1, -1]) {
    const H: V3 = [sd * hw, hy, hz];
    const X = (d: number) => sd * (hw + d * s);
    // Acetabulum: a cup round the femoral head, opening out, down and forward.
    const open = norm([sd, -0.55, 0.45]);
    ops.push([ellipsoid(at3(H, [open, -0.004]), frameFrom(open, [0, 1, 0]), [0.03 * k, 0.03 * k, 0.019 * k]), 0.008]);
    // Ilium: a twisted blade from above the socket up to the crest, from the front spine (ASIS) round to the back (PSIS).
    const crest = spline([P(X(0.02), 0.06, 0.05), P(X(0.038), 0.092, 0.028), P(X(0.042), 0.108, -0.012), P(X(0.02), 0.104, -0.05), P(sd * 0.05 * s, 0.078, -0.078)], 4);
    const base = crest.map((_, i) => lerp3(P(X(-0.004), 0.028, 0.018), P(X(-0.035), 0.04, -0.045), i / (crest.length - 1)));
    for (const tr of ribbon(crest, base, 0.003 * k)) ops.push([tr, 0]);
    for (let i = 0; i + 1 < crest.length; i++) ops.push([capsule(crest[i], crest[i + 1], 0.0055 * k, 0.0055 * k), 0.006]);
    // Body of the ilium above the socket, and the front rim down from the ASIS.
    ops.push([capsule(at3(H, [[0, 1, 0], 0.012]), base[Math.floor(base.length / 2)], 0.017 * k, 0.012 * k), 0.012]);
    ops.push([capsule(crest[0], P(X(0.004), 0.018, 0.03), 0.0055 * k, 0.007 * k), 0.008]);
    // Back of the blade down to the sacrum (sacroiliac joint).
    const si: V3 = [sd * 0.042 * s, sacrumTop[1] - 0.025 * s, sacrumTop[2] - 0.006 * s];
    ops.push([capsule(crest[crest.length - 1], si, 0.009 * k, 0.012 * k), 0.01]);
    ops.push([capsule(base[base.length - 1], si, 0.01 * k, 0.012 * k), 0.01]);
    // Ischium down to its tuberosity, pubis forward to the symphysis: they ring the obturator foramen.
    const isch = P(sd * (hw - 0.03 * s), -0.078, -0.03);
    const symTop: V3 = [sd * 0.007 * s, hy - 0.025 * s, hz + 0.055 * s];
    const symBot: V3 = [sd * 0.007 * s, hy - 0.06 * s, hz + 0.048 * s];
    ops.push([capsule(P(X(-0.01), -0.016, -0.016), isch, 0.012 * k, 0.012 * k), 0.008]);
    ops.push([ellipsoid(isch, AXES, [0.011 * k, 0.014 * k, 0.012 * k]), 0.006]);
    ops.push([capsule(P(X(-0.018), -0.004, 0.018), symTop, 0.009 * k, 0.008 * k), 0.008]);
    ops.push([capsule(symBot, lerp3(symBot, isch, 0.5), 0.0065 * k, 0.006 * k), 0.006]);
    ops.push([capsule(lerp3(symBot, isch, 0.5), isch, 0.006 * k, 0.009 * k), 0.006]);
    ops.push([capsule(symTop, symBot, 0.008 * k, 0.0075 * k, [1, 0, 0], [0.8, 1.2]), 0.005]);
    // Socket hollow (the femoral head sits in it).
    ops.push([blob(at3(H, [open, 0.016]), [0.0215 * k, 0.0215 * k, 0.0215 * k]), 0.003, true]);
  }
  // Sacrum: a curved, tapering plate of five fused segments under the spine, and the coccyx.
  const n = 6;
  const mid: V3[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    mid.push([0, sacrumTop[1] - t * 0.1 * s, sacrumTop[2] - 0.006 * s - Math.sin(t * 1.4) * 0.028 * s + t * t * 0.02 * s]);
  }
  const wid = (t: number) => (0.05 - 0.036 * t) * s;
  const left = mid.map((p, i) => add(p, [wid(i / (n - 1)), 0.004 * s, 0.004 * s]));
  const right = mid.map((p, i) => add(p, [-wid(i / (n - 1)), 0.004 * s, 0.004 * s]));
  for (const tr of ribbon(left, mid, 0.008 * k)) ops.push([tr, 0.004]);
  for (const tr of ribbon(mid, right, 0.008 * k)) ops.push([tr, 0.004]);
  // Top of S1 (where L5 sits) and the median crest down the back.
  ops.push([disc(sacrumTop, frameFrom([0, 1, -0.25], [1, 0, 0]), 0.022 * s, 0.016 * s, 0.006 * s, 0.003 * s), 0.008]);
  for (let i = 0; i + 1 < n - 1; i++) ops.push([capsule(add(mid[i], [0, 0, -0.008 * s]), add(mid[i + 1], [0, 0, -0.008 * s]), 0.004 * k, 0.0035 * k), 0.004]);
  const tip = mid[n - 1];
  const cocc = spline([tip, add(tip, [0, -0.015 * s, 0.008 * s]), add(tip, [0, -0.026 * s, 0.02 * s])], 3);
  for (let i = 0; i + 1 < cocc.length; i++) ops.push([capsule(cocc[i], cocc[i + 1], 0.006 * s * (1 - i * 0.12), 0.006 * s * (1 - (i + 1) * 0.12)), 0.002]);
  // Sacral foramina: two rows of holes.
  for (let i = 1; i < n - 2; i++) for (const sd of [1, -1]) ops.push([capsule(add(lerp3(mid[i], mid[i + 1], 0.5), [sd * (0.02 - i * 0.002) * s, 0, 0.03]), add(lerp3(mid[i], mid[i + 1], 0.5), [sd * (0.02 - i * 0.002) * s, 0, -0.03]), 0.0035 * s, 0.0035 * s), 0.002, true]);
  const adds = ops.filter((o) => !o[2]).map((o): [Prim, number] => [o[0], o[1]]);
  const carves = ops.filter((o) => o[2]).map((o): [Prim, number] => [o[0], o[1]]);
  piece(ctx, "pelvis", 0.0022, adds, carves, 1, (g) => g.smooth(0.6), [1, 0, 0]);
}

/** Clavicles and shoulder blades, rigid on the clavicle bones. */
function buildShoulders(ctx: Ctx, notch: V3 | null, vert: Vertebra[]) {
  const s = ctx.s, k = Math.sqrt(ctx.k);
  for (const [sn, side] of [["l", 1], ["r", -1]] as const) {
    if (!ctx.has(`clavicle_${sn}`) || !ctx.has(`upperarm_${sn}`)) continue;
    const S = ctx.head(`upperarm_${sn}`);
    const X: V3 = [side, 0, 0];
    const acromion = at3(S, [[0, 1, 0], 0.024 * s], [X, -0.004], [[0, 0, 1], -0.004]);
    const med: V3 = notch ? [side * 0.024 * s, notch[1] + 0.004, notch[2] - 0.004] : at3(ctx.head(`clavicle_${sn}`), [X, 0.01]);
    // S-shaped: bowed forward medially, backwards laterally.
    const keys = [med, at3(lerp3(med, acromion, 0.33), [[0, 0, 1], 0.012 * s], [[0, 1, 0], 0.004]), at3(lerp3(med, acromion, 0.72), [[0, 0, 1], -0.006 * s], [[0, 1, 0], 0.006]), acromion];
    const pts = spline(keys, 6);
    tube(ctx, `clavicle_${sn}`, pts, (t) => (0.0062 + 0.002 * (1 - t) - 0.0012 * Math.sin(t * Math.PI)) * s * k, (t) => (0.005 + 0.002 * t) * s * k, () => [0, 0, 1], 1, 12);
    // Scapula: a thin triangle on the back of the rib cage, the spine of the scapula and the glenoid under the acromion.
    const t2 = vert.find((v) => v.level === "T" && v.index === 2), t7 = vert.find((v) => v.level === "T" && v.index === 7);
    if (!t2 || !t7) continue;
    const backZ = (y: number) => {
      const sl = slice(ctx, y, torsoSegments(ctx), 0.015);
      return sl ? sl.back + 0.028 * s : t2.c[2] - 0.05;
    };
    const sup: V3 = [side * 0.07 * s, t2.c[1] + 0.005, backZ(t2.c[1]) + 0.004];
    const inf: V3 = [side * 0.085 * s, t7.c[1] - 0.01, backZ(t7.c[1])];
    const glen = at3(S, [X, -0.028 * s], [[0, 0, 1], -0.008 * s], [[0, 1, 0], -0.004]);
    const lateralEdge: V3 = lerp3(glen, inf, 0.5);
    lateralEdge[0] += side * 0.012 * s;
    lateralEdge[2] = backZ(lateralEdge[1]) + 0.012 * s;
    const plate = triangle(sup, inf, lerp3(glen, [glen[0], glen[1] - 0.01, backZ(glen[1]) + 0.02], 0.4), 0.0022 * k);
    const adds: [Prim, number][] = [
      [plate, 0],
      [triangle(inf, lateralEdge, glen, 0.0028 * k), 0.006],
      [capsule(inf, lateralEdge, 0.004 * k, 0.005 * k), 0.006],
      [capsule(lateralEdge, at3(glen, [X, -0.006]), 0.005 * k, 0.007 * k), 0.006],
      [capsule(sup, inf, 0.003 * k, 0.0035 * k), 0.005],
      [ellipsoid(glen, frameFrom(X, [0, 1, 0]), [0.008 * k, 0.019 * s, 0.013 * s]), 0.006],
    ];
    // Spine of the scapula: a ridge from the medial border out to the acromion.
    const spineStart: V3 = lerp3(sup, inf, 0.28);
    spineStart[2] -= 0.004;
    const spinePts = spline([spineStart, at3(lerp3(spineStart, acromion, 0.5), [[0, 0, 1], -0.012 * s], [[0, 1, 0], 0.008]), at3(acromion, [X, 0.008], [[0, 1, 0], 0.003])], 4);
    for (let i = 0; i + 1 < spinePts.length; i++) adds.push([capsule(spinePts[i], spinePts[i + 1], (0.004 + 0.002 * (i / spinePts.length)) * k, (0.004 + 0.002 * ((i + 1) / spinePts.length)) * k, [0, 1, 0], [1, 1.6]), 0.005]);
    adds.push([ellipsoid(at3(acromion, [X, 0.006], [[0, 1, 0], 0.004]), frameFrom(X, [0, 0, 1]), [0.018 * s, 0.011 * s, 0.005 * k]), 0.006]);
    // Coracoid: a hook forward under the clavicle.
    adds.push([capsule(at3(glen, [X, -0.006], [[0, 1, 0], 0.012]), at3(glen, [X, 0.002], [[0, 1, 0], 0.016], [[0, 0, 1], 0.03 * s]), 0.005 * k, 0.004 * k), 0.006]);
    piece(ctx, `clavicle_${sn}`, 0.0018, adds);
  }
}

/** A thin rounded triangle (distance to the triangle minus `r`). */
function triangle(a: V3, b: V3, c: V3, r: number): Prim {
  const ba = sub(b, a), cb = sub(c, b), ac = sub(a, c);
  const nor = cross(ba, ac);
  const lo: V3 = [0, 1, 2].map((i) => Math.min(a[i], b[i], c[i]) - r) as V3;
  const hi: V3 = [0, 1, 2].map((i) => Math.max(a[i], b[i], c[i]) + r) as V3;
  const e0 = cross(ba, nor), e1 = cross(cb, nor), e2 = cross(ac, nor);
  const nn = dot(nor, nor), l0 = dot(ba, ba), l1 = dot(cb, cb), l2 = dot(ac, ac);
  const clamp = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
  /** Squared distance from (px,py,pz) (relative to the edge start) to the edge e scaled by t. */
  const seg = (ex: number, ey: number, ez: number, ll: number, px: number, py: number, pz: number) => {
    const t = clamp((ex * px + ey * py + ez * pz) / ll);
    const dx = ex * t - px, dy = ey * t - py, dz = ez * t - pz;
    return dx * dx + dy * dy + dz * dz;
  };
  const sg = (x: number) => (x > 0 ? 1 : x < 0 ? -1 : 0);
  return {
    min: lo,
    max: hi,
    hull: { pts: [a, b, c], ext: r },
    d(p) {
      const pax = p[0] - a[0], pay = p[1] - a[1], paz = p[2] - a[2];
      const pbx = p[0] - b[0], pby = p[1] - b[1], pbz = p[2] - b[2];
      const pcx = p[0] - c[0], pcy = p[1] - c[1], pcz = p[2] - c[2];
      const inside = sg(e0[0] * pax + e0[1] * pay + e0[2] * paz) + sg(e1[0] * pbx + e1[1] * pby + e1[2] * pbz) + sg(e2[0] * pcx + e2[1] * pcy + e2[2] * pcz) >= 2;
      let q: number;
      if (!inside) q = Math.min(seg(ba[0], ba[1], ba[2], l0, pax, pay, paz), seg(cb[0], cb[1], cb[2], l1, pbx, pby, pbz), seg(ac[0], ac[1], ac[2], l2, pcx, pcy, pcz));
      else {
        const h = nor[0] * pax + nor[1] * pay + nor[2] * paz;
        q = (h * h) / nn;
      }
      return Math.sqrt(q) - r;
    },
  };
}

/** A thin band between two polylines (rounded by r): exact and seamless, unlike chains of flattened capsules. */
function ribbon(top: V3[], bottom: V3[], r: number): Prim[] {
  const out: Prim[] = [];
  for (let i = 0; i + 1 < Math.min(top.length, bottom.length); i++) {
    out.push(triangle(top[i], bottom[i], top[i + 1], r));
    out.push(triangle(top[i + 1], bottom[i], bottom[i + 1], r));
  }
  return out;
}

// ------------------------------------------------------------------ skull

/**
 * The skull is modelled in its own space: an average adult male skull with
 * the eye midpoint at the origin (+Y up, +Z forward, meters). It is then
 * stretched per axis to the head it sits in (width above the ears, crown,
 * back of the head, chin), so head shape sliders and races carry over.
 */
interface SkullMap {
  E: V3;
  sx: number;
  /** Y scale above and below the eyes. */
  syUp: number;
  syDown: number;
  /** Z scale behind the eyes (in front: 1). */
  szBack: number;
}

const mapPoint = (m: SkullMap, p: V3): V3 => [m.E[0] + p[0] * m.sx, m.E[1] + p[1] * (p[1] > 0 ? m.syUp : m.syDown), m.E[2] + p[2] * (p[2] < 0 ? m.szBack : 1)];
const mapNormal = (m: SkullMap, p: V3, n: V3): V3 => norm([n[0] / m.sx, n[1] / (p[1] > 0 ? m.syUp : m.syDown), n[2] / (p[2] < 0 ? m.szBack : 1)]);

function skullMap(ctx: Ctx): SkullMap | null {
  const { body } = ctx;
  const hb = ctx.bone("head");
  if (hb < 0) return null;
  const pos = body.positions;
  const [eL, eR] = body.eyes;
  const E = lerp3(eL, eR, 0.5);
  let crown = -Infinity, backZ = Infinity, half = 0, chinY = Infinity, n = 0;
  for (let v = 0; v < pos.length / 3; v++) {
    let m = 0;
    for (let q = 0; q < 4; q++) if (body.joints[v * 4 + q] === hb) m += body.weights[v * 4 + q];
    if (!body.used[v] || m < 0.5) continue;
    n++;
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    crown = Math.max(crown, y);
    if (Math.abs(y - (E[1] + 0.02)) < 0.015 && Math.abs(x) < 0.03) backZ = Math.min(backZ, z);
    if (Math.abs(y - (E[1] + 0.045)) < 0.01) half = Math.max(half, Math.abs(x));
    if (Math.abs(x) < 0.012 && z > E[2] - 0.01 && y > E[1] - 0.2) chinY = Math.min(chinY, y);
  }
  if (n < 50) return null;
  const lim = (x: number, lo: number, hi: number) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : 1);
  const SCALP = 0.006;
  return {
    E,
    sx: lim((half - SCALP) / 0.0715, 0.75, 1.4),
    syUp: lim((crown - SCALP - E[1]) / 0.099, 0.75, 1.4),
    syDown: lim((E[1] - chinY - 0.007) / 0.118, 0.75, 1.4),
    szBack: lim((E[2] - backZ - SCALP) / 0.172, 0.75, 1.4),
  };
}

type Op = [Prim, number, boolean?];

/** Meshes skull-space operations (in order; true = carve) and maps the result onto the head. */
function skullPiece(ctx: Ctx, m: SkullMap, cell: number, ops: Op[], wear = 0.8, post?: (g: Grid) => void) {
  const adds = ops.filter((o) => !o[2]).map((o) => o[0]);
  if (!adds.length) return;
  const g = Grid.around(adds, cell * RES, 0.004);
  for (const [p, k, carve] of ops) carve ? g.carve(p, k) : g.add(p, k);
  post?.(g);
  const tmp = new Builder();
  const save = ctx.bld;
  ctx.bld = tmp;
  emit(ctx, g, "head", wear);
  ctx.bld = save;
  const b = ctx.bld, base = b.count;
  const w: Weights = [[Math.max(0, ctx.bone("head")), 1]];
  for (let i = 0; i < tmp.count; i++) {
    const p: V3 = [tmp.pos[i * 3], tmp.pos[i * 3 + 1], tmp.pos[i * 3 + 2]];
    b.vert(mapPoint(m, p), mapNormal(m, p, [tmp.nrm[i * 3], tmp.nrm[i * 3 + 1], tmp.nrm[i * 3 + 2]]), 0, 0, tmp.shade[i], w);
  }
  for (const i of tmp.idx) b.idx.push(base + i);
}

const X: V3 = [1, 0, 0], Y: V3 = [0, 1, 0], Z: V3 = [0, 0, 1];
const sideOf = (x: number): Frame => frameFrom(norm([x, 0, 0]), Y);

/** The dental arch at height y: t in -1..1 from the left back molar round to the right one. */
const archAt = (t: number, y: number, shrink = 0): V3 => [t * (0.03 - shrink), y, 0.017 - shrink - t * t * (0.056 - shrink)];

function buildSkull(ctx: Ctx) {
  const m = skullMap(ctx);
  if (!m) return;
  const ops: Op[] = [];
  const both = (f: (s: number) => void) => [1, -1].forEach(f);
  // Cranial vault: a long ovoid with the occiput bulging behind and the forehead rising steeply.
  ops.push([ellipsoid([0, 0.028, -0.074], AXES, [0.0715, 0.071, 0.094]), 0]);
  ops.push([ellipsoid([0, 0.012, -0.128], AXES, [0.05, 0.052, 0.046]), 0.03]);
  ops.push([ellipsoid([0, 0.04, -0.018], AXES, [0.054, 0.058, 0.036]), 0.03]);
  // Parietal bosses.
  both((s) => ops.push([ellipsoid([s * 0.038, 0.055, -0.09], AXES, [0.028, 0.028, 0.034]), 0.03]));
  // Skull base joining the face to the vault, and the mastoids.
  ops.push([ellipsoid([0, -0.03, -0.06], AXES, [0.052, 0.026, 0.05]), 0.02]);
  both((s) => ops.push([ellipsoid([s * 0.054, -0.036, -0.094], AXES, [0.0065, 0.011, 0.0075]), 0.012]));
  // Temples: hollows behind the orbits, above the cheek arches.
  both((s) => ops.push([ellipsoid([s * 0.09, -0.004, -0.034], AXES, [0.025, 0.03, 0.03]), 0.016, true]));
  // Brow: the supraorbital margins meeting at the glabella.
  ops.push([ellipsoid([0, 0.018, 0.012], AXES, [0.014, 0.011, 0.009]), 0.008]);
  both((s) => {
    const brow = spline([[s * 0.006, 0.017, 0.016], [s * 0.03, 0.022, 0.012], [s * 0.05, 0.014, -0.001]], 4);
    for (let i = 0; i + 1 < brow.length; i++) ops.push([capsule(brow[i], brow[i + 1], 0.0065, 0.0055), 0.007]);
    // Lateral orbital rim down to the cheekbone.
    ops.push([capsule([s * 0.05, 0.012, -0.002], [s * 0.048, -0.018, -0.002], 0.0055, 0.006), 0.006]);
    // Cheekbone and the arch back to the ear.
    ops.push([ellipsoid([s * 0.045, -0.026, -0.003], frameFrom(norm([s * 0.7, 0, 0.7]), Y), [0.009, 0.012, 0.014]), 0.008]);
    const arch = spline([[s * 0.05, -0.026, -0.008], [s * 0.065, -0.029, -0.04], [s * 0.065, -0.024, -0.068]], 8);
    const archH = (t: number) => 0.0048 - 0.0016 * t;
    for (const tr of ribbon(arch.map((p, i) => add(p, [0, archH(i / (arch.length - 1)), 0])), arch.map((p, i) => add(p, [0, -archH(i / (arch.length - 1)), 0])), 0.0026)) ops.push([tr, 0]);
    // Infraorbital rim and the medial wall (frontal process of the maxilla) beside the nose.
    ops.push([capsule([s * 0.042, -0.018, 0.0], [s * 0.016, -0.015, 0.012], 0.0045, 0.0045), 0.006]);
    ops.push([capsule([s * 0.011, 0.014, 0.016], [s * 0.013, -0.02, 0.017], 0.005, 0.0055), 0.006]);
    // Maxilla: cheeks of the upper jaw beside the nasal opening and behind the canines.
    ops.push([ellipsoid([s * 0.026, -0.044, -0.002], AXES, [0.015, 0.017, 0.009]), 0.012]);
    ops.push([ellipsoid([s * 0.031, -0.048, -0.022], AXES, [0.011, 0.014, 0.018]), 0.012]);
    // Rim of the nasal opening.
    ops.push([capsule([s * 0.009, -0.021, 0.017], [s * 0.014, -0.044, 0.014], 0.003, 0.0035), 0.006]);
  });
  // Nasal bones.
  ops.push([capsule([0, 0.009, 0.02], [0, -0.021, 0.027], 0.006, 0.0055, X, [1.5, 0.55]), 0.005]);
  // Upper alveolar ridge holding the teeth.
  const upper: V3[] = [];
  for (let i = 0; i <= 16; i++) upper.push(archAt(i / 8 - 1, -0.06, -0.001));
  for (let i = 0; i + 1 < upper.length; i++) ops.push([capsule(upper[i], upper[i + 1], 0.0068, 0.0068), 0.007]);
  ops.push([ellipsoid([0, -0.062, -0.014], AXES, [0.022, 0.006, 0.026]), 0.01]);
  // Orbits: deep rounded-square sockets, tilted down at the outer corner, narrowing to the back.
  both((s) => {
    ops.push([ellipsoid([s * 0.032, 0.0, 0.01], frameFrom(Z, norm([1, -s * 0.15, 0])), [0.0195, 0.0172, 0.03]), 0.004, true]);
    ops.push([ellipsoid([s * 0.026, 0.0, -0.024], AXES, [0.014, 0.013, 0.028]), 0.008, true]);
  });
  // Nasal aperture: pear-shaped, wider at the bottom.
  ops.push([ellipsoid([0, -0.033, 0.03], AXES, [0.0105, 0.018, 0.04]), 0.003, true]);
  ops.push([ellipsoid([0, -0.045, 0.03], AXES, [0.013, 0.009, 0.04]), 0.003, true]);
  // Ear canals.
  both((s) => ops.push([capsule([s * 0.08, -0.021, -0.075], [s * 0.05, -0.021, -0.075], 0.0038, 0.003), 0.002, true]));
  // Sutures: thin wiggly grooves on the vault (coronal, sagittal, lambdoid), deeper when worn.
  skullPiece(ctx, m, 0.0018, ops, 0.8, (g) => {
    const depth = 0.0005 + ctx.c.wear * 0.0006;
    g.displace((q) => {
      if (q[1] < 0.02) return 0;
      const wig = noise3(q[0] * 260, q[1] * 260, q[2] * 260, 11) * 0.0025;
      const coronal = Math.abs(q[2] + 0.04 + q[1] * 0.25 - wig);
      const sagittal = q[2] < -0.04 && q[2] > -0.13 ? Math.abs(q[0] - wig) : 1;
      const lambdoid = q[2] < -0.1 ? Math.abs(q[2] + 0.13 - (q[1] - 0.04) * 0.6 + Math.abs(q[0]) * 0.5 - wig) : 1;
      const d = Math.min(coronal, sagittal, lambdoid);
      return d < 0.0011 ? depth * (1 - d / 0.0011) : 0;
    }, 0.003);
  });
  buildTeeth(ctx, m, -0.0655, 1);
  // Mandible.
  if (ctx.c.jaw) {
    const jaw: Op[] = [];
    // Body: a band from angle to angle round the chin, its lower border wider and dropping to the chin.
    const top = (u: number): V3 => [0.045 * u, -0.084, 0.011 - 0.069 * u * u];
    const bot = (u: number): V3 => [0.049 * u, -0.115 + 0.017 * u * u, 0.016 - 0.074 * u * u];
    const us = Array.from({ length: 25 }, (_, i) => i / 12 - 1);
    for (const tr of ribbon(us.map(top), us.map(bot), 0.0048)) jaw.push([tr, 0]);
    // Chin.
    jaw.push([ellipsoid([0, -0.108, 0.016], AXES, [0.014, 0.008, 0.005]), 0.006]);
    // Lower alveolar ridge.
    const lower: V3[] = [];
    for (let i = 0; i <= 16; i++) lower.push(archAt(i / 8 - 1, -0.0885, 0.0025));
    for (let i = 0; i + 1 < lower.length; i++) jaw.push([capsule(lower[i], lower[i + 1], 0.0045, 0.0045), 0.006]);
    both((s) => {
      const gon: V3 = [s * 0.049, -0.098, -0.06];
      const condyle: V3 = [s * 0.052, -0.026, -0.072];
      const coronoid: V3 = [s * 0.045, -0.038, -0.04];
      const bodyTop: V3 = top(s * 0.8);
      jaw.push([triangle(gon, [condyle[0], condyle[1] - 0.008, condyle[2]], coronoid, 0.0028), 0.005]);
      jaw.push([triangle(gon, coronoid, bodyTop, 0.0028), 0.005]);
      jaw.push([capsule(gon, [condyle[0], condyle[1] - 0.006, condyle[2]], 0.0042, 0.0038), 0.005]);
      jaw.push([ellipsoid(condyle, sideOf(s), [0.0095, 0.005, 0.0055]), 0.004]);
      // Sigmoid notch between the coronoid and the condyle.
      jaw.push([ellipsoid([s * 0.048, -0.028, -0.056], AXES, [0.012, 0.0085, 0.0085]), 0.003, true]);
    });
    skullPiece(ctx, m, 0.0015, jaw);
    buildTeeth(ctx, m, -0.0862, -1);
  }
  // Eye lights: a glowing ball deep in each socket.
  if (ctx.c.eyes) {
    const w: Weights = [[Math.max(0, ctx.bone("head")), 1]];
    for (const s of [1, -1]) {
      const c = mapPoint(m, [s * 0.03, -0.002, -0.02]);
      const g = Grid.around([blob(c, [0.009, 0.009, 0.009])], 0.0012);
      g.add(blob(c, [0.0058 * m.sx, 0.0052 * m.syDown, 0.0045]));
      g.mesh(ctx.glow, w, () => 1);
    }
  }
}

/** A row of teeth along the dental arch (dir 1: upper teeth hanging from y, -1: lower teeth standing on it). */
function buildTeeth(ctx: Ctx, m: SkullMap, y: number, dir: number) {
  // Per side from the midline: 2 incisors, canine, 2 premolars, 3 molars (widths along the arch).
  const upper = dir > 0;
  const widths = (upper ? [0.0088, 0.0068, 0.0078, 0.007, 0.0068, 0.0102, 0.0094, 0.0086] : [0.0055, 0.006, 0.007, 0.007, 0.0071, 0.011, 0.0104, 0.0096]);
  const shrink = upper ? 0.0 : 0.0025;
  // Arc length along the arch from the middle.
  const N = 400, pts: V3[] = [], arc: number[] = [0];
  for (let i = 0; i <= N; i++) pts.push(archAt(i / N, y, shrink));
  for (let i = 1; i <= N; i++) arc.push(arc[i - 1] + len(sub(pts[i], pts[i - 1])));
  const atArc = (l: number) => {
    let i = 1;
    while (i < N && arc[i] < l) i++;
    return { p: pts[i], tan: norm(sub(pts[i], pts[i - 1])) };
  };
  const ops: Op[] = [];
  for (const sd of [1, -1]) {
    let l = 0;
    widths.forEach((w, i) => {
      const mid = l + w / 2;
      l += w;
      if (i === 7 || ctx.lost(i < 3 ? 0.35 : 0.2)) return;
      const { p, tan: t0 } = atArc(mid);
      const c: V3 = [p[0] * sd, p[1], p[2]];
      const tan: V3 = [t0[0] * sd, t0[1], t0[2]];
      const molar = i >= 5, canine = i === 2;
      const h = molar ? 0.0058 : canine ? 0.0092 : i >= 3 ? 0.0075 : 0.0085 * (upper ? 1 : 0.9);
      const th = molar ? 0.0052 : i >= 3 ? 0.0042 : canine ? 0.0034 : 0.0026;
      const f = frameFrom(Y, tan);
      const crown: V3 = add(c, [0, -dir * (0.0022 + h * 0.5), 0]);
      // Crown: a rounded block, narrower at the neck; incisors are thin blades.
      ops.push([box(crown, f, [Math.max(0.0008, w * 0.4 - 0.0011), Math.max(0.0008, h * 0.5 - 0.0011), Math.max(0.0006, th - 0.0011)], 0.0011), 0]);
      // Neck into the ridge.
      ops.push([capsule(add(c, [0, dir * 0.004, 0]), crown, w * 0.26, w * 0.3), 0.0012]);
    });
  }
  skullPiece(ctx, m, 0.0007, ops, 0.35);
}

// ------------------------------------------------------------------ entry

/** Builds every skeleton part for a body (see the file comment). */
export function buildSkeletal(body: RobotBody, config: Partial<SkeletalConfig>): SkeletalParts {
  const c = sanitizeSkeletal(config);
  const sk = body.skeleton;
  const index = new Map(sk.names.map((n, i) => [n, i]));
  const rng = new Rng(c.seed);
  const bone = (n: string) => index.get(n) ?? -1;
  const has = (n: string) => index.has(n);
  const head = (n: string): V3 => [...sk.heads[Math.max(0, bone(n))]] as V3;
  const tail = (n: string): V3 => [...sk.tails[Math.max(0, bone(n))]] as V3;
  // Stature from the rig: ankle to skull base (about 1.47 m at 1.75 m tall).
  const stature = has("head") && has("foot_l") ? (head("head")[1] - head("foot_l")[1]) / 0.84 : 1.75;
  const ctx: Ctx = {
    body,
    c,
    rng,
    bld: new Builder(),
    glow: new Builder(),
    bone,
    has,
    head,
    tail,
    k: 0.85 + 0.35 * c.robust,
    s: stature / 1.75,
    lost: (p) => rng.float() < p * c.missing,
  };
  buildSkull(ctx);
  const spine = spineCurve(ctx);
  let notch: V3 | null = null;
  if (spine) {
    const vs = spine.vert;
    for (let i = 0; i < vs.length; i++) {
        const a = vs[Math.max(0, i - 1)].c, b = vs[Math.min(vs.length - 1, i + 1)].c;
        buildVertebra(ctx, vs[i], len(sub(b, a)) / (i === 0 || i === vs.length - 1 ? 1 : 2));
      }
    notch = buildThorax(ctx, vs)?.notch ?? null;
    buildPelvis(ctx, spine.sacrumTop);
    buildShoulders(ctx, notch, vs);
  }
  for (const [s, side] of [["l", 1], ["r", -1]] as const) {
    buildArm(ctx, s, side);
    buildLeg(ctx, s, side);
  }
  if (c.heart && spine) {
    const t6 = spine.vert.find((v) => v.level === "T" && v.index === 6);
    if (t6) {
      const p = at3(t6.c, [[0, 0, 1], 0.07 * ctx.s], [[1, 0, 0], 0.012]);
      const g = Grid.around([blob(p, [0.03, 0.03, 0.03])], 0.002);
      g.add(blob(p, [0.022 * ctx.s, 0.026 * ctx.s, 0.02 * ctx.s]));
      g.mesh(ctx.glow, [[bone(trunkBone(ctx, p[1])), 1]], () => 1);
    }
  }
  const parts: PartMesh[] = [];
  if (ctx.bld.count) parts.push(ctx.bld.build("skeleton-bone", "bone"));
  if (ctx.glow.count) parts.push(ctx.glow.build("skeleton-glow", "glow"));
  let bodyMin = Infinity, partMin = Infinity;
  for (let v = 0; v < body.positions.length / 3; v++) if (body.used[v]) bodyMin = Math.min(bodyMin, body.positions[v * 3 + 1]);
  for (const p of parts) for (let i = 1; i < p.positions.length; i += 3) partMin = Math.min(partMin, p.positions[i]);
  return { parts, lift: parts.length ? bodyMin - partMin : 0 };
}

/** Collects what the skeleton builder needs from an evaluated shape (the same surfaces robots use). */
export const skeletalBody = (shape: ActorShape, meshes: MeshData[]) => robotBody(shape, meshes);

/** Name of the worker shape task that builds skeleton parts (see `serveRuntime`). */
export const SKELETAL_TASK = "skeletal";

/** Worker shape task: skeleton parts for the new shape, with their buffers transferred. */
export const skeletalTask: ShapeTask = (runtime, shape, args) => {
  const body = robotBody(shape, runtime.meshes);
  const result: SkeletalParts = body ? buildSkeletal(body, args as Partial<SkeletalConfig>) : { parts: [], lift: 0 };
  const transfer: ArrayBuffer[] = [];
  for (const p of result.parts)
    for (const a of [p.positions, p.normals, p.uvs, p.shade, p.joints, p.weights, p.indices, p.anchors]) if (a) transfer.push(a.buffer as ArrayBuffer);
  return { result, transfer };
};

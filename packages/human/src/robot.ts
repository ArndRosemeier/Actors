/**
 * Robot actors: armour plates, a flexible inner frame, joint housings and a
 * sculpted head, all generated from the current body shape and skinned to the
 * pack skeleton. Every slider that shapes a human shapes the robot too, and
 * every clip plays on it unchanged (same bones).
 *
 * - Plates: the body surface is split by skin weights into one region per bone
 *   (twist bones join their parent). Each region is cut where it blends into
 *   the next bone (so gaps open at the joints), smoothed, and thickened into a
 *   closed shell with a rounded edge. Plates are rigid on their bone.
 * - Frame: the body surface itself, smoothly skinned, drawn as a dark
 *   synthetic-muscle layer that shows in the gaps.
 * - Joints: hinge housings (elbows, knees, ankles, hips, fingers) and ball
 *   joints (shoulders, wrists), sized from the limb they sit in.
 * - Head: a helmet surface fitted to the skull in head-centred directions
 *   (robust to nose, lips and ears), with a visor, optics or a faceplate.
 *
 * Renderer-free and deterministic. Axes: +Y up, +Z forward, +X = actor's left.
 */
import type { ActorShape, FittedSkeleton, MeshData, PartMesh, ShapeTask } from "@actors/core";
import { Builder, type Weights, eyeCentres } from "./parts";

export type RobotHead = "visor" | "optics" | "mono" | "android";
export type RobotEars = "none" | "pods" | "antennae" | "fins";
export type RobotPlating = "sleek" | "segmented" | "armored";

export const ROBOT_HEADS: RobotHead[] = ["visor", "optics", "mono", "android"];
export const ROBOT_EARS: RobotEars[] = ["none", "pods", "antennae", "fins"];
export const ROBOT_PLATING: RobotPlating[] = ["sleek", "segmented", "armored"];

export interface RobotConfig {
  head: RobotHead;
  ears: RobotEars;
  plating: RobotPlating;
  /** 0..1 plate thickness (about 5 to 17 mm; armoured plating adds half). */
  thickness: number;
  /** A light core in the chest. */
  core: boolean;
}

export const DEFAULT_ROBOT: RobotConfig = { head: "visor", ears: "pods", plating: "segmented", thickness: 0.5, core: true };

/** A valid robot config (unknown styles fall back to the defaults). */
export function sanitizeRobot(c: Partial<RobotConfig> | undefined): RobotConfig {
  const r = { ...DEFAULT_ROBOT, ...c };
  return {
    head: ROBOT_HEADS.includes(r.head) ? r.head : DEFAULT_ROBOT.head,
    ears: ROBOT_EARS.includes(r.ears) ? r.ears : DEFAULT_ROBOT.ears,
    plating: ROBOT_PLATING.includes(r.plating) ? r.plating : DEFAULT_ROBOT.plating,
    thickness: Math.min(1, Math.max(0, Number.isFinite(r.thickness) ? r.thickness : DEFAULT_ROBOT.thickness)),
    core: !!r.core,
  };
}

/** What the robot builder needs from an evaluated shape. */
export interface RobotBody {
  /** Surface vertices (the subdivided body if the pack has one). */
  positions: Float32Array;
  normals: Float32Array;
  /** Body triangles as surface vertex indices. */
  triangles: Uint32Array;
  /** Per surface vertex skin influences (4 each). */
  joints: Uint16Array;
  weights: Float32Array;
  /** 1 for vertices used by the body triangles. */
  used: Uint8Array;
  /** The body's render mesh (UV seams split), for the frame. */
  render: { map: Uint32Array; uv: Float32Array; indices: Uint32Array };
  skeleton: FittedSkeleton;
  /** Eye centres (actor's left and right). */
  eyes: [V3, V3];
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
const at = (arr: Float32Array, i: number): V3 => [arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]];
/** Any unit vector perpendicular to `d`. */
const perp = (d: V3): V3 => norm(cross(d, Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));

/** Collects the robot's surfaces from an evaluated shape (null if the pack lacks a skinned body, eyes or skeleton). */
export function robotBody(shape: ActorShape, meshes: MeshData[]): RobotBody | null {
  const sk = shape.skeleton;
  const eyes = eyeCentres(shape, meshes);
  if (!sk || !eyes) return null;
  const fine = meshes.find((m) => m.def.role === "body" && m.stencil && m.joints && m.weights && shape.meshes.has(m.def.name));
  const mesh = fine ?? meshes.find((m) => m.def.role === "body" && !m.stencil && m.joints && m.weights);
  if (!mesh) return null;
  const src = fine ? shape.meshes.get(fine.def.name)! : { positions: shape.positions, normals: shape.normals };
  const n = src.positions.length / 3;
  const joints = new Uint16Array(n * 4), weights = new Float32Array(n * 4), used = new Uint8Array(n);
  for (let i = 0; i < mesh.map.length; i++) {
    const v = mesh.map[i];
    used[v] = 1;
    for (let k = 0; k < 4; k++) {
      joints[v * 4 + k] = mesh.joints![i * 4 + k];
      weights[v * 4 + k] = mesh.weights![i * 4 + k];
    }
  }
  const triangles = new Uint32Array(mesh.indices.length);
  for (let i = 0; i < mesh.indices.length; i++) triangles[i] = mesh.map[mesh.indices[i]];
  return { positions: src.positions, normals: src.normals, triangles, joints, weights, used, render: { map: mesh.map, uv: mesh.uv, indices: mesh.indices }, skeleton: sk, eyes };
}

// ------------------------------------------------------------------ skeleton helpers

interface Rig {
  sk: FittedSkeleton;
  /** Bone index -> segment bone (twist bones join their parent, face bones the head). */
  seg: Int32Array;
  bone: (name: string) => number;
  has: (name: string) => boolean;
  head: (name: string) => V3;
  tail: (name: string) => V3;
  dir: (name: string) => V3;
  /** Local +X of a bone in model space (Blender roll convention). */
  xAxis: (name: string) => V3;
}

function rig(sk: FittedSkeleton): Rig {
  const index = new Map(sk.names.map((n, i) => [n, i]));
  const bone = (name: string) => index.get(name) ?? -1;
  const headIdx = bone("head");
  const seg = new Int32Array(sk.names.length);
  for (let i = 0; i < sk.names.length; i++) {
    let p = sk.parents[i], underHead = false;
    while (p >= 0) {
      if (p === headIdx) underHead = true;
      p = sk.parents[p];
    }
    const helper = /twist|metacarpal|_roll|corrective|_helper/i.test(sk.names[i]) && sk.parents[i] >= 0;
    seg[i] = underHead ? headIdx : helper ? seg[sk.parents[i]] : i;
  }
  // Clavicles join the chest: one rigid chest-and-shoulder plate (the arms still swing at the shoulder).
  const chest = index.get("spine_03");
  if (chest !== undefined) sk.names.forEach((n, i) => /^clavicle_/.test(n) && (seg[i] = seg[chest]));
  const head = (name: string): V3 => [...sk.heads[Math.max(0, bone(name))]] as V3;
  const tail = (name: string): V3 => [...sk.tails[Math.max(0, bone(name))]] as V3;
  return {
    sk,
    seg,
    bone,
    has: (name) => index.has(name),
    head,
    tail,
    dir: (name) => norm(sub(tail(name), head(name))),
    xAxis: (name) => {
      const m = sk.worldRotations[Math.max(0, bone(name))];
      return norm([m[0], m[1], m[2]]);
    },
  };
}

/** Per vertex: share of segment `s` minus the largest share of any other segment (> 0 where `s` dominates). */
function dominance(body: RobotBody, r: Rig, v: number, s: number): number {
  const segs = [-1, -1, -1, -1], w = [0, 0, 0, 0];
  let n = 0;
  for (let k = 0; k < 4; k++) {
    const wt = body.weights[v * 4 + k];
    if (wt <= 0) continue;
    const sg = r.seg[body.joints[v * 4 + k]];
    let i = segs.indexOf(sg);
    if (i < 0 || i >= n) {
      i = n++;
      segs[i] = sg;
    }
    w[i] += wt;
  }
  let own = 0, other = 0;
  for (let i = 0; i < n; i++) segs[i] === s ? (own = w[i]) : (other = Math.max(other, w[i]));
  return own - other;
}

/** Per vertex: share of its skin weight on bones of segment `s`. */
function membership(body: RobotBody, r: Rig, v: number, s: number): number {
  let m = 0;
  for (let k = 0; k < 4; k++) if (r.seg[body.joints[v * 4 + k]] === s) m += body.weights[v * 4 + k];
  return m;
}

// ------------------------------------------------------------------ small mesh tools

/** Area-weighted vertex normals. */
function vertexNormals(pos: Float32Array, idx: ArrayLike<number>, count = pos.length / 3): Float32Array {
  const out = new Float32Array(count * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const n = cross(sub(at(pos, b), at(pos, a)), sub(at(pos, c), at(pos, a)));
    for (const v of [a, b, c]) for (let j = 0; j < 3; j++) out[v * 3 + j] += n[j];
  }
  for (let v = 0; v < count; v++) {
    const n = norm(at(out, v));
    out.set(n, v * 3);
  }
  return out;
}

/** Binary min-heap of (key, value) for Dijkstra. */
class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, value: number) {
    const { k, v } = this;
    let i = k.length;
    k.push(key);
    v.push(value);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const { k, v } = this;
    const top: [number, number] = [k[0], v[0]];
    const lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

/** A cylinder from `a` to `b` with flat caps (separate cap vertices for crisp edges). */
function cylinder(bld: Builder, a: V3, b: V3, radius: number, w: Weights, radial = 20, shade = 1) {
  const axis = norm(sub(b, a));
  const s1 = perp(axis), s2 = cross(axis, s1);
  const ring = (c: V3, n: V3 | null) => {
    const base = bld.count;
    for (let j = 0; j <= radial; j++) {
      const ang = (j / radial) * Math.PI * 2;
      const d = add(mul(s1, Math.cos(ang)), mul(s2, Math.sin(ang)));
      bld.vert(add(c, mul(d, radius)), n ?? d, j / radial, 0, shade, w);
    }
    return base;
  };
  const r0 = ring(a, null), r1 = ring(b, null);
  for (let j = 0; j < radial; j++) bld.idx.push(r0 + j, r0 + j + 1, r1 + j, r0 + j + 1, r1 + j + 1, r1 + j);
  for (const [c, n, flip] of [[a, mul(axis, -1), true], [b, axis, false]] as [V3, V3, boolean][]) {
    const centre = bld.count;
    bld.vert(c, n, 0.5, 0.5, shade, w);
    const rr = ring(c, n);
    for (let j = 0; j < radial; j++) flip ? bld.idx.push(centre, rr + j + 1, rr + j) : bld.idx.push(centre, rr + j, rr + j + 1);
  }
}

/** A flat ring (r0 > 0) or disc (r0 = 0) facing `n`. */
function annulus(bld: Builder, c: V3, n: V3, r0: number, r1: number, w: Weights, radial = 28, dome = 0) {
  const s1 = perp(n), s2 = cross(n, s1);
  const base = bld.count;
  const inner = r0 > 0 ? r0 : 0;
  for (let j = 0; j <= radial; j++) {
    const ang = (j / radial) * Math.PI * 2;
    const d = add(mul(s1, Math.cos(ang)), mul(s2, Math.sin(ang)));
    bld.vert(add(add(c, mul(d, inner)), mul(n, inner ? 0 : dome)), n, 0, 0, 1, w);
    bld.vert(add(c, mul(d, r1)), n, 1, 0, 1, w);
  }
  for (let j = 0; j < radial; j++) {
    const a = base + j * 2;
    bld.idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
}

/** A UV sphere. */
function sphere(bld: Builder, c: V3, r: number, w: Weights, rows = 10, cols = 16) {
  const base = bld.count;
  for (let i = 0; i <= rows; i++) {
    const th = (i / rows) * Math.PI;
    for (let j = 0; j <= cols; j++) {
      const ph = (j / cols) * Math.PI * 2;
      const d: V3 = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
      bld.vert(add(c, mul(d, r)), d, j / cols, i / rows, 1, w);
    }
  }
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++) {
      const a = base + i * (cols + 1) + j, b = a + cols + 1;
      bld.idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
}

/** An elliptical tube along `pts` (fins, rods); `rw` across `side`, `rh` across the other axis. */
function sweep(bld: Builder, pts: V3[], rw: (t: number) => number, rh: (t: number) => number, side: V3, w: Weights, radial = 14) {
  const base = bld.count;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const tan = norm(sub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]));
    const s = norm(sub(side, mul(tan, dot(side, tan))));
    const u = cross(tan, s);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const p = add(pts[i], add(mul(s, Math.cos(a) * rw(t)), mul(u, Math.sin(a) * rh(t))));
      const nn = norm(add(mul(s, Math.cos(a) / Math.max(1e-4, rw(t))), mul(u, Math.sin(a) / Math.max(1e-4, rh(t)))));
      bld.vert(p, nn, j / radial, t, 1, w);
    }
  }
  for (let i = 0; i < n - 1; i++)
    for (let j = 0; j < radial; j++) {
      const a = base + i * (radial + 1) + j, c = a + radial + 1;
      bld.idx.push(a, a + 1, c, a + 1, c + 1, c);
    }
}

// ------------------------------------------------------------------ plates

interface PlateStyle {
  /** How much a plate's bone must outweigh the next one (higher = wider gaps at the joints). */
  margin: number;
  /** Plate thickness (m). */
  thick: number;
  /** Groove field of a segment (m, positive = plate), or null for none. */
  grooves: (name: string) => ((x: number, y: number, z: number) => number) | null;
}

const GROOVE = 0.0035;

function plateStyle(r: Rig, c: RobotConfig): PlateStyle {
  const thick = (0.005 + 0.012 * c.thickness) * (c.plating === "armored" ? 1.5 : 1);
  /** A ring groove around a limb at `t0` of the bone's length. */
  const ring = (name: string, t0: number) => {
    const h = r.head(name), d = r.dir(name), off = t0 * len(sub(r.tail(name), h)) + dot(h, d);
    return (x: number, y: number, z: number) => Math.abs(x * d[0] + y * d[1] + z * d[2] - off) - GROOVE;
  };
  const midline = (x: number) => Math.abs(x) - GROOVE;
  const grooves = (name: string) => {
    if (c.plating === "sleek") return null;
    const base = name.replace(/_[lr]$/, "");
    if (c.plating === "armored") return /^spine_0[2-5]$/.test(name) ? midline : null;
    switch (base) {
      case "spine_02":
      case "spine_03":
      case "spine_04":
      case "spine_05":
      case "pelvis":
        return midline;
      case "thigh":
        return ring(name, 0.5);
      case "calf":
        return ring(name, 0.55);
      case "upperarm":
        return ring(name, 0.45);
    }
    return null;
  };
  return { margin: c.plating === "armored" ? 0.06 : 0.14, thick, grooves };
}

/** Segments painted with the second colour (shoulders, hands, pelvis, feet). */
const TRIM = /^(hand|thumb|index|middle|ring|pinky|foot|ball)/;
const FINGER = /^(thumb|index|middle|ring|pinky)_/;

let scratchState: { id: number; stamp: Int32Array; value: Float32Array; lstamp: Int32Array; local: Int32Array } | undefined;
/** Per-vertex scratch arrays reused across plates (a new id invalidates the previous plate's values). */
function scratch(n: number) {
  if (!scratchState || scratchState.stamp.length < n) scratchState = { id: 0, stamp: new Int32Array(n), value: new Float32Array(n), lstamp: new Int32Array(n), local: new Int32Array(n) };
  scratchState.id++;
  return scratchState;
}

/**
 * Cuts the plate of segment `s` out of the body and thickens it into a closed
 * shell, rigid on bone `s`. Returns false if the segment has no plate.
 */
function buildPlate(body: RobotBody, r: Rig, s: number, tris: number[], style: PlateStyle, bld: Builder): boolean {
  const name = r.sk.names[s];
  const pos = body.positions, nrm = body.normals;
  // Plate field per vertex: dominance above the margin, minus grooves (scaled to weight units).
  const nv = pos.length / 3;
  const field = scratch(nv);
  const groove = style.grooves(name);
  const F = (v: number) => {
    if (field.stamp[v] !== field.id) {
      field.stamp[v] = field.id;
      const d = dominance(body, r, v, s) - style.margin;
      field.value[v] = groove ? Math.min(d, groove(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]) * 12) : d;
    }
    return field.value[v];
  };
  // Clip triangles to F >= 0; cut points on an edge are shared by both triangles of that edge.
  const lp: number[] = [], ln: number[] = [];
  const vertexOf = (v: number) => {
    if (field.lstamp[v] !== field.id) {
      field.lstamp[v] = field.id;
      field.local[v] = lp.length / 3;
      lp.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
      ln.push(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]);
    }
    return field.local[v];
  };
  const cuts = new Map<number, number>();
  const cutOf = (a: number, b: number) => {
    const key = a < b ? a * 4194304 + b : b * 4194304 + a;
    let i = cuts.get(key);
    if (i === undefined) {
      const fa = F(a), fb = F(b);
      const t = fa / (fa - fb);
      i = lp.length / 3;
      cuts.set(key, i);
      lp.push(...lerp3(at(pos, a), at(pos, b), t));
      ln.push(...norm(lerp3(at(nrm, a), at(nrm, b), t)));
    }
    return i;
  };
  const tri: number[] = [];
  for (const t of tris) {
    const vs = [body.triangles[t], body.triangles[t + 1], body.triangles[t + 2]];
    const fs = vs.map(F);
    if (fs.every((f) => f < 0)) continue;
    const poly: number[] = [];
    for (let k = 0; k < 3; k++) {
      const a = vs[k], b = vs[(k + 1) % 3], fa = fs[k], fb = fs[(k + 1) % 3];
      if (fa >= 0) poly.push(vertexOf(a));
      if (fa >= 0 !== fb >= 0) poly.push(cutOf(a, b));
    }
    for (let k = 1; k + 1 < poly.length; k++) if (poly[0] !== poly[k] && poly[k] !== poly[k + 1] && poly[0] !== poly[k + 1]) tri.push(poly[0], poly[k], poly[k + 1]);
  }
  const n = lp.length / 3;
  if (tri.length < 3 * 24) return false;
  const P = Float32Array.from(lp);
  // Edges: an edge a->b is on the boundary if no triangle has b->a.
  const out: number[][] = Array.from({ length: n }, () => []);
  for (let t = 0; t < tri.length; t += 3) for (let k = 0; k < 3; k++) out[tri[t + k]].push(tri[t + ((k + 1) % 3)]);
  const nbr: number[][] = Array.from({ length: n }, () => []);
  const bnbr: number[][] = Array.from({ length: n }, () => []);
  const boundary = new Uint8Array(n);
  const directed: [number, number][] = [];
  for (let a = 0; a < n; a++)
    for (const b of out[a]) {
      if (!nbr[a].includes(b)) nbr[a].push(b);
      if (!nbr[b].includes(a)) nbr[b].push(a);
      if (!out[b].includes(a)) {
        boundary[a] = boundary[b] = 1;
        bnbr[a].push(b);
        bnbr[b].push(a);
        directed.push([a, b]);
      }
    }
  // Taubin smoothing: plates are smoother than skin (no navel, no nipples), and their edges smoother than the cut.
  const tmp = new Float32Array(P.length);
  // Feet become boots: toes are smoothed away first (plain Laplacian), the plate is then made thicker.
  const boot = /^(ball|foot)_/.test(name);
  const passes: number[] = boot ? Array(10).fill(0.6) : [];
  // The torso is smoothed hardest (no abdominal muscles on a robot).
  const torso = /^(spine_|pelvis)/.test(name);
  for (let it = 0; it < (torso ? 24 : 10); it++) passes.push(0.5, -0.53);
  for (const lambda of passes) {
    tmp.set(P);
    for (let v = 0; v < n; v++) {
      const list = boundary[v] ? bnbr[v] : nbr[v];
      if (!list.length) continue;
      let x = 0, y = 0, z = 0;
      for (const u of list) {
        x += tmp[u * 3];
        y += tmp[u * 3 + 1];
        z += tmp[u * 3 + 2];
      }
      const k = 1 / list.length;
      P[v * 3] += lambda * (x * k - tmp[v * 3]);
      P[v * 3 + 1] += lambda * (y * k - tmp[v * 3 + 1]);
      P[v * 3 + 2] += lambda * (z * k - tmp[v * 3 + 2]);
    }
  }
  const N = vertexNormals(P, tri, n);
  // Keep the body's normal direction where smoothing flipped a thin sliver.
  const L = Float32Array.from(ln);
  for (let v = 0; v < n; v++) if (dot(at(N, v), at(L, v)) < 0) N.set(at(L, v), v * 3);
  // Distance to the plate edge (Dijkstra over edges) for the rounded rim.
  const dist = new Float32Array(n).fill(Infinity);
  const heap = new Heap();
  for (let v = 0; v < n; v++)
    if (boundary[v]) {
      dist[v] = 0;
      heap.push(0, v);
    }
  while (heap.size) {
    const [d, v] = heap.pop();
    if (d > dist[v]) continue;
    for (const u of nbr[v]) {
      const nd = d + Math.hypot(P[u * 3] - P[v * 3], P[u * 3 + 1] - P[v * 3 + 1], P[u * 3 + 2] - P[v * 3 + 2]);
      if (nd < dist[u]) {
        dist[u] = nd;
        heap.push(nd, u);
      }
    }
  }
  // Fingers and hands get thinner plates (a finger is under 2 cm thick).
  const finger = FINGER.test(name), hand = name.startsWith("hand_");
  const T = finger ? Math.min(style.thick, 0.0026) : hand ? Math.min(style.thick, 0.0055) : style.thick * (boot ? 1.4 : 1);
  const gap = boot ? 0.004 : finger ? 0.0012 : 0.0025;
  const bevel = T * 1.3 + (finger ? 0.0015 : 0.004), edge = 0.4;
  const prof = (d: number) => {
    const x = Math.min(1, d / bevel);
    return edge + (1 - edge) * Math.sqrt(1 - (1 - x) * (1 - x));
  };
  const outer = new Float32Array(n * 3), inner = new Float32Array(n * 3);
  for (let v = 0; v < n * 3; v++) {
    outer[v] = P[v] + N[v] * (gap + T * prof(dist[(v / 3) | 0]));
    inner[v] = P[v] + N[v] * gap * 0.4;
  }
  const outerN = vertexNormals(outer, tri, n);
  const w: Weights = [[s, 1]];
  // Outer skin.
  const o0 = bld.count;
  for (let v = 0; v < n; v++) bld.vert(at(outer, v), at(outerN, v), 0, 0, 1, w);
  for (let t = 0; t < tri.length; t += 3) bld.idx.push(o0 + tri[t], o0 + tri[t + 1], o0 + tri[t + 2]);
  // Inner skin (reversed).
  const i0 = bld.count;
  for (let v = 0; v < n; v++) bld.vert(at(inner, v), mul(at(N, v), -1), 0, 0, 0.45, w);
  for (let t = 0; t < tri.length; t += 3) bld.idx.push(i0 + tri[t], i0 + tri[t + 2], i0 + tri[t + 1]);
  // Rim: one quad per boundary edge, facing away from the plate.
  const rimN = new Map<number, V3>();
  for (const [a, b] of directed) {
    const o = cross(sub(at(P, b), at(P, a)), at(N, a));
    for (const v of [a, b]) rimN.set(v, add(rimN.get(v) ?? [0, 0, 0], o));
  }
  for (const [a, b] of directed) {
    const r0 = bld.count;
    for (const v of [a, b]) {
      const rn = norm(add(norm(rimN.get(v)!), mul(at(N, v), 0.25)));
      bld.vert(at(outer, v), rn, 0, 0, 0.8, w);
      bld.vert(at(inner, v), rn, 0, 0, 0.55, w);
    }
    // r0 = a outer, r0+1 = a inner, r0+2 = b outer, r0+3 = b inner.
    bld.idx.push(r0, r0 + 1, r0 + 3, r0, r0 + 3, r0 + 2);
  }
  return true;
}

/**
 * Toe cap: a rounded box swept along the toes (heel side open towards the foot
 * plate, front closed), sized from the toes' slices, so feet read as boots.
 */
function buildToeCap(body: RobotBody, r: Rig, s: number, thick: number, bld: Builder): boolean {
  const name = r.sk.names[s];
  const h = r.head(name);
  const raw = r.dir(name);
  const d = norm([raw[0], 0, raw[2]]);
  const L = norm(cross([0, 1, 0], d));
  const pos = body.positions;
  const pts: { t: number; x: number; y: number }[] = [];
  let tMax = 0;
  for (let v = 0; v < pos.length / 3; v++) {
    if (!body.used[v] || dominance(body, r, v, s) < -0.3) continue;
    const rel = sub(at(pos, v), h);
    const t = dot(rel, d);
    if (t < -0.015) continue;
    pts.push({ t, x: dot(rel, L), y: rel[1] });
    tMax = Math.max(tMax, t);
  }
  if (pts.length < 20 || tMax < 0.02) return false;
  const N = 14, t0 = -0.008, t1 = tMax + 0.002;
  const slices: { x0: number; x1: number; y0: number; y1: number }[] = [];
  for (let k = 0; k <= N; k++) {
    const t = t0 + ((t1 - t0) * k) / N, w = ((t1 - t0) / N) * 0.9;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) {
      if (Math.abs(p.t - t) > w) continue;
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y);
    }
    slices.push(Number.isFinite(x0) ? { x0, x1, y0, y1 } : (slices[k - 1] ?? { x0: -0.03, x1: 0.03, y0: -0.02, y1: 0.01 }));
  }
  // Smooth the outline along the foot.
  for (let it = 0; it < 3; it++)
    for (let k = 1; k < N; k++)
      for (const key of ["x0", "x1", "y0", "y1"] as const) slices[k][key] = (slices[k - 1][key] + slices[k][key] * 2 + slices[k + 1][key]) / 4;
  const out = thick + 0.003;
  const radial = 24;
  const w: Weights = [[s, 1]];
  const ring = (k: number, shrink: number) => {
    const sl = slices[Math.min(N, k)];
    const t = t0 + ((t1 - t0) * Math.min(N, k)) / N;
    const cx = (sl.x0 + sl.x1) / 2, cy = (sl.y0 + sl.y1) / 2;
    const a = ((sl.x1 - sl.x0) / 2 + out) * shrink, bb = ((sl.y1 - sl.y0) / 2 + out) * shrink;
    const c = add(add(add(h, mul(d, t)), mul(L, cx)), [0, cy, 0]);
    const base = bld.count;
    for (let j = 0; j <= radial; j++) {
      const ang = (j / radial) * Math.PI * 2;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      // Superellipse (exponent 2.6): boxy with round corners.
      const e = 2 / 2.6;
      const px = Math.sign(ca) * Math.pow(Math.abs(ca), e) * a, py = Math.sign(sa) * Math.pow(Math.abs(sa), e) * bb;
      const p = add(add(c, mul(L, px)), [0, py, 0]);
      const nn = norm(add(mul(L, Math.sign(ca) * Math.pow(Math.abs(ca), 2 - e) / Math.max(a, 1e-4)), [0, Math.sign(sa) * Math.pow(Math.abs(sa), 2 - e) / Math.max(bb, 1e-4), 0]));
      bld.vert(p, nn, 0, 0, 1, w);
    }
    return { base, c };
  };
  const rings: { base: number; c: V3 }[] = [];
  // Body of the cap, then a rounded nose (shrinking rings).
  for (let k = 0; k <= N; k++) rings.push(ring(k, 1));
  for (let k = 1; k <= 4; k++) {
    const f = k / 4;
    const r0 = ring(N, Math.sqrt(1 - f * f) * 0.999 + 0.001);
    // Push the nose forward.
    const off = mul(d, out * 1.4 * Math.sin((f * Math.PI) / 2));
    for (let j = 0; j <= radial; j++) {
      const i = (r0.base + j) * 3;
      bld.pos[i] += off[0];
      bld.pos[i + 2] += off[2];
      if (k === 4) bld.nrm.splice(i, 3, ...d);
    }
    rings.push(r0);
  }
  for (let k = 0; k + 1 < rings.length; k++)
    for (let j = 0; j < radial; j++) {
      const a = rings[k].base + j, c = rings[k + 1].base + j;
      bld.idx.push(a, a + 1, c, a + 1, c + 1, c);
    }
  // Heel-side cap.
  const back = rings[0];
  const centre = bld.count;
  bld.vert(back.c, mul(d, -1), 0, 0, 0.6, w);
  for (let j = 0; j < radial; j++) bld.idx.push(centre, back.base + j + 1, back.base + j);
  return true;
}

// ------------------------------------------------------------------ limb measurements

/** Cross-section of the body at a joint: median radius around `dir`, and half width along `axis`. */
function crossSection(body: RobotBody, r: Rig, j: V3, dir: V3, segs: number[], axis?: V3, slab = 0.012): { radius: number; half: number } {
  const radii: number[] = [], widths: number[] = [];
  const pos = body.positions;
  for (let v = 0; v < pos.length / 3; v++) {
    if (!body.used[v]) continue;
    const rel: V3 = [pos[v * 3] - j[0], pos[v * 3 + 1] - j[1], pos[v * 3 + 2] - j[2]];
    const along = dot(rel, dir);
    if (Math.abs(along) > slab) continue;
    if (!segs.includes(r.seg[body.joints[v * 4]])) continue;
    const radial = sub(rel, mul(dir, along));
    const d = len(radial);
    if (d > 0.3) continue;
    radii.push(d);
    if (axis) widths.push(Math.abs(dot(radial, axis)));
  }
  const pct = (a: number[], q: number) => {
    if (!a.length) return 0;
    a.sort((x, y) => x - y);
    return a[Math.min(a.length - 1, Math.floor(q * a.length))];
  };
  return { radius: pct(radii, 0.5), half: pct(widths, 0.92) };
}

// ------------------------------------------------------------------ head

interface HeadShell {
  C: V3;
  /** Mean radius. */
  R: number;
  rows: number;
  cols: number;
  /** Lower edge of the shell (polar angle from the crown) per direction: under the chin in front, above the nape behind. */
  limit: (phi: number) => number;
  /** Polar angle of grid row `i` in column `j`. */
  theta: (i: number, j: number) => number;
  /** Shell radius per grid vertex ((rows+1) x cols, wrapping in phi). */
  radius: Float32Array;
  /** Shell radius in a direction (bilinear on the grid). */
  at: (d: V3) => number;
  dir: (theta: number, phi: number) => V3;
}

/** Half heights (polar angle) of the mono-eye slit and of the visor. */
const VISOR_HALF = [0.07, 0.17];

const dirOf = (theta: number, phi: number): V3 => [Math.sin(theta) * Math.sin(phi), Math.cos(theta), Math.sin(theta) * Math.cos(phi)];

/**
 * Fits a smooth helmet surface around the head: for each direction from the
 * head centre, a low percentile of the skin's distance within a cone (so
 * ears, nose and lips don't push it out), then smoothed.
 */
function headShell(body: RobotBody, r: Rig, android: boolean, inflate: number): HeadShell {
  const hs = r.seg[r.bone("head")];
  const pos = body.positions;
  const idx: number[] = [];
  let lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < pos.length / 3; v++) {
    if (!body.used[v] || membership(body, r, v, hs) < 0.5) continue;
    idx.push(v);
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], pos[v * 3 + k]);
      hi[k] = Math.max(hi[k], pos[v * 3 + k]);
    }
  }
  const [eL, eR] = body.eyes;
  const eyeMid = lerp3(eL, eR, 0.5);
  // Centre: midline, between the crown and the chin, behind the eyes.
  const C: V3 = [0, (hi[1] + Math.max(lo[1], eyeMid[1] - (hi[1] - eyeMid[1]) * 1.15)) / 2, (lo[2] + hi[2]) / 2 - 0.004];
  // At most ~3000 samples keep the fit fast on subdivided bodies.
  const stride = Math.max(1, Math.ceil(idx.length / 3000));
  const sample = idx.filter((_, i) => i % stride === 0);
  const m = sample.length;
  const dist = new Float32Array(m), ux = new Float32Array(m), uy = new Float32Array(m), uz = new Float32Array(m);
  let R = 0;
  sample.forEach((v, k) => {
    const x = pos[v * 3] - C[0], y = pos[v * 3 + 1] - C[1], z = pos[v * 3 + 2] - C[2];
    const l = Math.hypot(x, y, z) || 1;
    dist[k] = l;
    ux[k] = x / l;
    uy[k] = y / l;
    uz[k] = z / l;
    R += l / Math.max(1, m);
  });
  const cols = 64;
  const limit = (phi: number) => 2.18 + 0.52 * Math.pow(0.5 + 0.5 * Math.cos(phi), 1.5);
  // Rows run from the crown to the lower edge; row lines sit exactly on the visor edges (eye angle +- 0.07 and 0.17) in every column.
  const thetaE = Math.acos(norm(sub(eyeMid, C))[1]);
  const knots = [0, thetaE - VISOR_HALF[1], thetaE - VISOR_HALF[0], thetaE + VISOR_HALF[0], thetaE + VISOR_HALF[1]];
  const counts = [Math.round(knots[1] / 0.055), 2, 3, 2, 0];
  counts[4] = Math.max(4, Math.round((2.45 - knots[4]) / 0.055));
  const starts = counts.map((_, k) => counts.slice(0, k).reduce((a, b) => a + b, 0));
  const rows = starts[4] + counts[4];
  const theta = (i: number, j: number) => {
    let k = 4;
    while (k > 0 && i < starts[k]) k--;
    const a = knots[k], b = k < 4 ? knots[k + 1] : limit((j / cols) * Math.PI * 2);
    return a + ((b - a) * (i - starts[k])) / counts[k];
  };
  const cone = Math.cos(android ? 0.2 : 0.32), q = android ? 0.5 : 0.4;
  const radius = new Float32Array((rows + 1) * cols);
  const valid = new Uint8Array((rows + 1) * cols);
  for (let i = 0; i <= rows; i++)
    for (let j = 0; j < cols; j++) {
      const d = dirOf(theta(i, j), (j / cols) * Math.PI * 2);
      const hits: number[] = [];
      for (let k = 0; k < m; k++) {
        const c = ux[k] * d[0] + uy[k] * d[1] + uz[k] * d[2];
        if (c > cone) hits.push(dist[k] * c);
      }
      if (hits.length < 4) continue;
      hits.sort((a, b) => a - b);
      radius[i * cols + j] = hits[Math.floor(q * (hits.length - 1))];
      valid[i * cols + j] = 1;
    }
  // Fill empty directions (under the jaw) from the row above.
  for (let i = 0; i <= rows; i++)
    for (let j = 0; j < cols; j++)
      if (!valid[i * cols + j]) radius[i * cols + j] = i > 0 ? radius[(i - 1) * cols + j] : R;
  // Smooth (wrapping in phi), then inflate by the shell thickness.
  const tmp = new Float32Array(radius.length);
  for (let it = 0; it < (android ? 4 : 5); it++) {
    tmp.set(radius);
    for (let i = 0; i <= rows; i++)
      for (let j = 0; j < cols; j++) {
        const up = Math.max(0, i - 1), dn = Math.min(rows, i + 1);
        radius[i * cols + j] = (tmp[i * cols + j] * 2 + tmp[up * cols + j] + tmp[dn * cols + j] + tmp[i * cols + ((j + 1) % cols)] + tmp[i * cols + ((j + cols - 1) % cols)]) / 6;
      }
  }
  // The crown row is one point.
  const pole = radius.slice(0, cols).reduce((a, b) => a + b, 0) / cols;
  for (let j = 0; j < cols; j++) radius[j] = pole;
  for (let k = 0; k < radius.length; k++) radius[k] += inflate;
  const atDir = (d: V3) => {
    const th = Math.acos(Math.max(-1, Math.min(1, d[1])));
    let ph = Math.atan2(d[0], d[2]);
    if (ph < 0) ph += Math.PI * 2;
    let k = 0;
    while (k < 4 && th >= knots[k + 1]) k++;
    const top = k < 4 ? knots[k + 1] : limit(ph);
    const fi = Math.min(rows, starts[k] + ((th - knots[k]) / (top - knots[k])) * counts[k]), fj = (ph / (Math.PI * 2)) * cols;
    const i0 = Math.min(rows - 1, Math.floor(fi)), j0 = Math.floor(fj) % cols, j1 = (j0 + 1) % cols;
    const a = fi - i0, b = fj - Math.floor(fj);
    const g = (i: number, j: number) => radius[Math.min(rows, i) * cols + j];
    return (g(i0, j0) * (1 - b) + g(i0, j1) * b) * (1 - a) + (g(i0 + 1, j0) * (1 - b) + g(i0 + 1, j1) * b) * a;
  };
  return { C, R, rows, cols, limit, theta, radius, at: atDir, dir: dirOf };
}

interface Builders {
  plate: Builder;
  trim: Builder;
  frame: Builder;
  joint: Builder;
  visor: Builder;
  glow: Builder;
}

function buildHead(body: RobotBody, r: Rig, c: RobotConfig, shell: HeadShell, b: Builders) {
  const { C, rows, cols } = shell;
  const headW: Weights = [[r.bone("head"), 1]];
  const [eL, eR] = body.eyes;
  const ipd = len(sub(eL, eR)) || 0.064;
  const eyeMid = lerp3(eL, eR, 0.5);
  const de = norm(sub(eyeMid, C));
  const thetaE = Math.acos(de[1]);
  // Visor band in grid cells (rows x columns around phi = 0).
  // Visor band: polar-angle range around the eyes, and its half width in columns around the front.
  const band = c.head === "visor" ? { up: VISOR_HALF[1], down: VISOR_HALF[1], half: 0.26 } : c.head === "mono" ? { up: VISOR_HALF[0], down: VISOR_HALF[0], half: 0.18 } : null;
  const halfCols = band ? Math.round(band.half * cols) : 0;
  const inBand = (i: number, j: number) => {
    if (!band) return false;
    const jj = j >= cols / 2 ? j - cols : j;
    const th = shell.theta(i + 0.5, j);
    return th >= thetaE - band.up && th < thetaE + band.down && jj >= -halfCols && jj < halfCols;
  };
  const recess = 0.0055;
  const vtx = (i: number, j: number, rr: number) => {
    const d = shell.dir(shell.theta(i, j), (j / cols) * Math.PI * 2);
    return add(C, mul(d, rr));
  };
  const grid = (bld: Builder, pick: (i: number, j: number) => boolean, offset: number, shade: number) => {
    const base = bld.count;
    const pts = new Float32Array((rows + 1) * (cols + 1) * 3);
    for (let i = 0; i <= rows; i++)
      for (let j = 0; j <= cols; j++) pts.set(vtx(i, j % cols, shell.radius[i * cols + (j % cols)] + offset), (i * (cols + 1) + j) * 3);
    const idx: number[] = [];
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < cols; j++) {
        if (!pick(i, j)) continue;
        const a = i * (cols + 1) + j, d = a + cols + 1;
        idx.push(a, d, a + 1, a + 1, d, d + 1);
      }
    const N = vertexNormals(pts, idx);
    // The crown is a single point: give it a straight-up normal. The first and last columns meet at the front.
    for (let j = 0; j <= cols; j++) N.set([0, 1, 0], j * 3);
    for (let i = 1; i <= rows; i++) {
      const a = i * (cols + 1), z = a + cols;
      const n = norm(add(at(N, a), at(N, z)));
      N.set(n, a * 3);
      N.set(n, z * 3);
    }
    const used = new Map<number, number>();
    for (const v of idx) {
      if (used.has(v)) continue;
      used.set(v, bld.count);
      bld.vert(at(pts, v), at(N, v), 0, 0, shade, headW);
    }
    for (const v of idx) bld.idx.push(used.get(v)!);
    return base;
  };
  grid(b.plate, (i, j) => !inBand(i, j), 0, 1);
  // The open lower edge folds inwards so the shell has thickness when seen from below.
  for (let j = 0; j < cols; j++) {
    const i = rows;
    const base = b.plate.count;
    for (const jj of [j, j + 1]) {
      const d = shell.dir(shell.theta(i, jj), (jj / cols) * Math.PI * 2);
      const rr = shell.radius[i * cols + (jj % cols)];
      b.plate.vert(add(C, mul(d, rr)), [0, -1, 0], 0, 0, 0.7, headW);
      b.plate.vert(add(C, mul(d, rr - 0.012)), [0, -1, 0], 0, 0, 0.5, headW);
    }
    b.plate.idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  if (band) {
    grid(b.visor, inBand, -recess, 1);
    // Walls between the shell and the recessed visor.
    for (let i = 0; i <= rows; i++)
      for (let j = 0; j < cols; j++) {
        const edges: [number, number, number, number][] = [];
        // Vertical edge at column j between cells (i, j-1) and (i, j); horizontal edge at row i between (i-1, j) and (i, j).
        if (i < rows && inBand(i, j) !== inBand(i, (j + cols - 1) % cols)) edges.push([i, j, i + 1, j]);
        if (i > 0 && i <= rows && inBand(i, j) !== inBand(i - 1, j)) edges.push([i, j, i, j + 1]);
        for (const [i0, j0, i1, j1] of edges) {
          const p0 = vtx(i0, j0 % cols, shell.radius[i0 * cols + (j0 % cols)]), p1 = vtx(i1, j1 % cols, shell.radius[i1 * cols + (j1 % cols)]);
          const q0 = add(C, mul(norm(sub(p0, C)), len(sub(p0, C)) - recess)), q1 = add(C, mul(norm(sub(p1, C)), len(sub(p1, C)) - recess));
          const nn = norm(cross(sub(p1, p0), sub(q0, p0)));
          const base = b.trim.count;
          for (const p of [p0, p1, q0, q1]) b.trim.vert(p, nn, 0, 0, 0.6, headW);
          b.trim.idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base, base + 2, base + 1, base + 1, base + 2, base + 3);
        }
      }
    if (c.head === "visor") {
      // A light bar across the visor at eye height.
      const base = b.glow.count;
      const half = Math.round(halfCols * 0.82);
      for (const th of [thetaE - 0.012, thetaE + 0.012])
        for (let jj = -half; jj <= half; jj++) {
          const ph = (jj / cols) * Math.PI * 2;
          const d = shell.dir(th, ph);
          b.glow.vert(add(C, mul(d, shell.at(d) - recess + 0.0009)), d, 0, 0, 1, headW);
        }
      const n = half * 2 + 1;
      for (let k = 0; k < n - 1; k++) b.glow.idx.push(base + k, base + n + k, base + k + 1, base + k + 1, base + n + k, base + n + k + 1);
    } else {
      // Mono-eye: one round lens in the middle of the slit.
      const d = shell.dir(thetaE, 0);
      annulus(b.glow, add(C, mul(d, shell.at(d) - recess + 0.0012)), d, 0, ipd * 0.2, headW, 28, 0.002);
    }
  }
  if (c.head === "optics" || c.head === "android") {
    for (const e of [eL, eR]) {
      const d = norm(sub(e, C));
      const surf = add(C, mul(d, shell.at(d)));
      if (c.head === "optics") {
        const rr = ipd * 0.3;
        cylinder(b.joint, add(surf, mul(d, -0.006)), add(surf, mul(d, 0.004)), rr, headW, 28);
        annulus(b.glow, add(surf, mul(d, 0.0042)), d, 0, rr * 0.7, headW, 28, 0.0015);
      } else annulus(b.glow, add(surf, mul(d, 0.0006)), d, 0, ipd * 0.17, headW, 24, 0.001);
    }
  }
  // Ears.
  const earTheta = thetaE + 0.12;
  for (const side of [1, -1]) {
    const d = shell.dir(earTheta, (side * Math.PI) / 2);
    const surf = add(C, mul(d, shell.at(d)));
    const R = shell.R;
    if (c.ears === "pods" || c.ears === "antennae") {
      const pr = R * (c.ears === "pods" ? 0.3 : 0.2);
      const out = add(surf, mul(d, c.ears === "pods" ? 0.011 : 0.007));
      cylinder(b.trim, add(surf, mul(d, -0.01)), out, pr, headW, 28);
      annulus(b.glow, add(out, mul(d, 0.0004)), d, pr * 0.55, pr * 0.78, headW);
      if (c.ears === "antennae") {
        const q0 = add(out, [0, pr * 0.4, -pr * 0.2]);
        const q1 = add(q0, mul(norm([side * 0.12, 1, -0.4]), R * 0.85));
        cylinder(b.joint, q0, q1, 0.0022, headW, 10);
        sphere(b.glow, q1, 0.0055, headW);
      }
    } else if (c.ears === "fins") {
      const root = add(surf, mul(d, -0.004));
      const pts: V3[] = [];
      for (let k = 0; k <= 10; k++) {
        const t = k / 10;
        pts.push(add(root, [side * R * 0.08 * t, R * (0.12 * t + 0.35 * t * t), -R * 0.95 * t]));
      }
      sweep(b.trim, pts, (t) => 0.0045 * (1 - t * 0.6), (t) => R * 0.24 * (1 - t * 0.85) + 0.002, [1, 0, 0], headW);
      annulus(b.glow, add(surf, mul(d, 0.003)), d, 0, R * 0.09, headW, 20, 0.001);
    }
  }
}

// ------------------------------------------------------------------ joints

function buildJoints(body: RobotBody, r: Rig, b: Builders, plateThick: number) {
  const S = (n: string) => r.seg[r.bone(n)];
  const rigid = (n: string): Weights => [[r.bone(n), 1]];
  const Z: V3 = [0, 0, 1];
  const hingeAxis = (d: V3, fallback: V3) => {
    const a = cross(d, Z);
    return len(a) > 0.2 ? norm(a) : fallback;
  };
  /** A hinge housing across the limb at bone `child`'s head, with glowing caps. */
  const hinge = (child: string, parent: string, axis: V3, scale = 1, glow = true, own = false, thick = plateThick) => {
    if (!r.has(child) || !r.has(parent)) return;
    const j = r.head(child), d = r.dir(child);
    const cs = crossSection(body, r, j, d, own ? [S(child)] : [S(child), S(parent)], axis);
    if (!cs.radius) return;
    const half = (cs.half + thick * 0.35) * scale;
    const rad = Math.min(cs.radius * 0.62, half * 0.75) * scale;
    const a = add(j, mul(axis, -half)), c = add(j, mul(axis, half));
    cylinder(b.joint, a, c, rad, rigid(child), 24);
    if (glow)
      for (const [p, n] of [[c, axis], [a, mul(axis, -1)]] as [V3, V3][]) annulus(b.glow, add(p, mul(n, 0.0004)), n, rad * 0.5, rad * 0.68, rigid(child), 24);
  };
  const ball = (child: string, parent: string, k: number) => {
    if (!r.has(child) || !r.has(parent)) return;
    const j = r.head(child);
    const cs = crossSection(body, r, j, r.dir(child), [S(child), S(parent)]);
    if (cs.radius) sphere(b.joint, j, cs.radius * k, rigid(child), 14, 20);
  };
  for (const s of ["l", "r"]) {
    const X: V3 = [s === "l" ? 1 : -1, 0, 0];
    ball(`upperarm_${s}`, `upperarm_${s}`, 0.92);
    hinge(`lowerarm_${s}`, `upperarm_${s}`, hingeAxis(r.dir(`lowerarm_${s}`), r.xAxis(`lowerarm_${s}`)));
    ball(`hand_${s}`, `lowerarm_${s}`, 0.85);
    // Hip actuator: a drum on the outside of the hip joint.
    if (r.has(`thigh_${s}`)) {
      const j = r.head(`thigh_${s}`);
      const pos = body.positions;
      let out = 0;
      const cs = crossSection(body, r, j, r.dir(`thigh_${s}`), [S(`thigh_${s}`)]);
      for (let v = 0; v < pos.length / 3; v++) {
        if (!body.used[v] || Math.abs(pos[v * 3 + 1] - j[1]) > 0.015 || Math.abs(pos[v * 3 + 2] - j[2]) > 0.02) continue;
        const sg = r.seg[body.joints[v * 4]];
        if (sg !== S("pelvis") && sg !== S(`thigh_${s}`)) continue;
        out = Math.max(out, (pos[v * 3] - j[0]) * X[0]);
      }
      if (out > 0 && cs.radius) {
        const rad = cs.radius * 0.42;
        const a = add(j, mul(X, out * 0.55)), c = add(j, mul(X, out + plateThick * 0.6));
        cylinder(b.joint, a, c, rad, rigid(`thigh_${s}`), 28);
        annulus(b.glow, add(c, mul(X, 0.0004)), X, rad * 0.5, rad * 0.68, rigid(`thigh_${s}`), 24);
      }
    }
    hinge(`calf_${s}`, `thigh_${s}`, hingeAxis(r.dir(`calf_${s}`), X));
    hinge(`foot_${s}`, `calf_${s}`, hingeAxis(r.dir(`calf_${s}`), X), 0.9, false);
    hinge(`ball_${s}`, `foot_${s}`, X, 0.9, false);
    // Fingers: hinges across the knuckle line.
    const knuckles = r.has(`index_01_${s}`) && r.has(`pinky_01_${s}`) ? norm(sub(r.head(`pinky_01_${s}`), r.head(`index_01_${s}`))) : X;
    for (const f of ["index", "middle", "ring", "pinky", "thumb"])
      for (let k = 1; k <= 3; k++) {
        const child = `${f}_0${k}_${s}`;
        const parent = k === 1 ? `hand_${s}` : `${f}_0${k - 1}_${s}`;
        if (!r.has(child)) continue;
        const axis = f === "thumb" ? r.xAxis(child) : hingeAxis(r.dir(child), knuckles);
        hinge(child, parent, f === "thumb" ? axis : dot(axis, knuckles) < 0 ? mul(axis, -1) : axis, 0.72, false, true, 0.0026);
      }
  }
  // Neck: stacked collars from the shoulders to the skull.
  if (r.has("neck_01")) {
    const a = r.head("neck_01"), h = r.head("head");
    const d = norm(sub(h, a));
    const cs = crossSection(body, r, lerp3(a, h, 0.5), d, [S("neck_01"), S("head")]);
    const nb = r.bone("neck_01"), hb = r.bone("head");
    for (const t of [0.15, 0.45, 0.75]) {
      const c = lerp3(a, h, t);
      cylinder(b.joint, add(c, mul(d, -0.005)), add(c, mul(d, 0.005)), cs.radius * 0.88, [[nb, 1 - t * 0.8], [hb, t * 0.8]], 28);
    }
  }
  // Waist: a ring of the frame showing between abdomen and pelvis is enough; add a slim actuator ring.
  if (r.has("spine_01")) {
    const a = r.head("spine_01");
    const cs = crossSection(body, r, a, r.dir("spine_01"), [S("spine_01"), S("pelvis")]);
    if (cs.radius) cylinder(b.joint, add(a, [0, -0.007, 0]), add(a, [0, 0.007, 0]), cs.radius * 0.97, [[r.bone("spine_01"), 0.5], [r.bone("pelvis"), 0.5]], 40);
  }
}

/**
 * Segmented plating leaves the abdomen open: a stack of elliptical actuator
 * rings over the frame, each blended between pelvis and chest so the waist
 * still bends.
 */
function buildSpineRings(body: RobotBody, r: Rig, b: Builders) {
  if (!r.has("spine_01") || !r.has("spine_03")) return;
  const y0 = r.head("spine_01")[1] + 0.005, y1 = lerp3(r.head("spine_02"), r.head("spine_03"), 0.7)[1];
  const torso = new Set(["pelvis", "spine_01", "spine_02", "spine_03"].filter(r.has).map((n) => r.seg[r.bone(n)]));
  const pos = body.positions;
  const count = 6;
  for (let k = 0; k < count; k++) {
    const t = (k + 0.5) / count, y = y0 + (y1 - y0) * t;
    // The body's outline at this height: furthest skin per angle around the centre, smoothed.
    const radial = 48;
    const sel: number[] = [];
    let cx = 0, cz = 0;
    for (let v = 0; v < pos.length / 3; v++) {
      if (!body.used[v] || Math.abs(pos[v * 3 + 1] - y) > 0.008 || !torso.has(r.seg[body.joints[v * 4]])) continue;
      sel.push(v);
      cx += pos[v * 3];
      cz += pos[v * 3 + 2];
    }
    if (sel.length < 12) continue;
    cx /= sel.length;
    cz /= sel.length;
    let rad = new Float32Array(radial);
    for (const v of sel) {
      const dx = pos[v * 3] - cx, dz = pos[v * 3 + 2] - cz;
      const bin = Math.round(((Math.atan2(dz, dx) + Math.PI * 2) / (Math.PI * 2)) * radial) % radial;
      rad[bin] = Math.max(rad[bin], Math.hypot(dx, dz));
    }
    for (let j = 0; j < radial; j++) if (!rad[j]) rad[j] = Math.max(rad[(j + radial - 1) % radial], rad[(j + 1) % radial]);
    for (let it = 0; it < 2; it++) rad = rad.map((x, j) => Math.max(x, (rad[(j + radial - 1) % radial] + x * 2 + rad[(j + 1) % radial]) / 4));
    const w: Weights = t < 0.5 ? [[r.bone("pelvis"), 1 - t * 2], [r.bone("spine_01"), t * 2]] : [[r.bone("spine_01"), 2 - t * 2], [r.bone("spine_02"), t * 2 - 1]];
    const h = 0.0075, inset = 0.008;
    const base = b.joint.count;
    // Per angle: outer bottom, outer top, top face (outer, inner), bottom face (outer, inner).
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const rr = rad[j % radial] + 0.0035;
      const n = norm([ca, 0, sa]);
      const o: V3 = [cx + ca * rr, y, cz + sa * rr], i: V3 = [cx + ca * (rr - inset), y, cz + sa * (rr - inset)];
      for (const [p, nn] of [[add(o, [0, -h, 0]), n], [add(o, [0, h, 0]), n], [add(o, [0, h, 0]), [0, 1, 0]], [add(i, [0, h, 0]), [0, 1, 0]], [add(o, [0, -h, 0]), [0, -1, 0]], [add(i, [0, -h, 0]), [0, -1, 0]]] as [V3, V3][])
        b.joint.vert(p, nn, 0, 0, 1, w);
    }
    for (let j = 0; j < radial; j++) {
      const a = base + j * 6, c = a + 6;
      b.joint.idx.push(a, a + 1, c, a + 1, c + 1, c); // outer wall
      b.joint.idx.push(a + 2, c + 2, a + 3, a + 3, c + 2, c + 3); // top
      b.joint.idx.push(a + 4, a + 5, c + 4, a + 5, c + 5, c + 4); // bottom
    }
  }
}

/** The chest light: a metal bezel and a domed glowing lens on the sternum plate. */
function buildCore(body: RobotBody, r: Rig, b: Builders, plateOut: number) {
  const top = r.has("neck_01") ? r.head("neck_01") : r.head("head");
  const chest = r.has("spine_03") ? "spine_03" : "spine_02";
  if (!r.has(chest)) return;
  const y = lerp3(r.head(chest), top, 0.32)[1];
  const pos = body.positions;
  let best = -1, bz = -Infinity;
  for (let v = 0; v < pos.length / 3; v++) {
    if (!body.used[v] || Math.abs(pos[v * 3]) > 0.012 || Math.abs(pos[v * 3 + 1] - y) > 0.012) continue;
    if (pos[v * 3 + 2] > bz) {
      bz = pos[v * 3 + 2];
      best = v;
    }
  }
  if (best < 0) return;
  const n: V3 = [0, 0, 1];
  const c: V3 = [0, pos[best * 3 + 1], bz + plateOut + 0.004];
  const w: Weights = [[r.bone(chest), 1]];
  cylinder(b.joint, add(c, mul(n, -0.02)), add(c, mul(n, 0.003)), 0.032, w, 32);
  annulus(b.glow, add(c, mul(n, 0.0032)), n, 0, 0.022, w, 32, 0.004);
}

// ------------------------------------------------------------------ frame

/** The inner frame: the body surface itself (UV seams kept), with head vertices pulled inside the helmet. */
function buildFrame(body: RobotBody, r: Rig, shell: HeadShell, bld: Builder) {
  const { map, uv, indices } = body.render;
  const hs = r.seg[r.bone("head")];
  for (let i = 0; i < map.length; i++) {
    const v = map[i];
    let p = at(body.positions, v);
    if (membership(body, r, v, hs) > 0.3) {
      const rel = sub(p, shell.C);
      const d = norm(rel);
      const th = Math.acos(Math.max(-1, Math.min(1, d[1])));
      let ph = Math.atan2(d[0], d[2]);
      if (ph < 0) ph += Math.PI * 2;
      if (th < shell.limit(ph)) {
        const lim = shell.at(d) - 0.006;
        if (len(rel) > lim) p = add(shell.C, mul(d, lim));
      }
    }
    const w: Weights = [];
    for (let k = 0; k < 4; k++) if (body.weights[v * 4 + k] > 0) w.push([body.joints[v * 4 + k], body.weights[v * 4 + k]]);
    bld.vert(p, at(body.normals, v), uv[i * 2], uv[i * 2 + 1], 1, w.length ? w : [[0, 1]]);
  }
  for (let i = 0; i < indices.length; i++) bld.idx.push(indices[i]);
}

// ------------------------------------------------------------------ entry

export interface RobotParts {
  parts: PartMesh[];
  /** How far the plates reach below the body's lowest point (soles), to stand the robot on the ground. */
  lift: number;
}

/** Builds every robot part for a body (see the file comment). Colours are set by the renderer. */
export function buildRobot(body: RobotBody, config: Partial<RobotConfig>): RobotParts {
  const c = sanitizeRobot(config);
  const r = rig(body.skeleton);
  const style = plateStyle(r, c);
  const b: Builders = { plate: new Builder(), trim: new Builder(), frame: new Builder(), joint: new Builder(), visor: new Builder(), glow: new Builder() };
  const headSeg = r.seg[r.bone("head")];
  const neckSeg = r.has("neck_01") ? r.seg[r.bone("neck_01")] : -2;
  // Segmented plating shows the abdomen's actuator rings instead of a plate.
  const open = new Set(c.plating === "segmented" ? ["spine_01", "spine_02"].filter(r.has).map((n) => r.seg[r.bone(n)]) : []);
  // Candidate triangles per segment: any vertex with a noticeable weight on it.
  const nv = body.positions.length / 3;
  const vseg = new Int32Array(nv * 4).fill(-1);
  for (let v = 0; v < nv; v++)
    for (let q = 0; q < 4; q++) {
      if (body.weights[v * 4 + q] <= 0.2) continue;
      const sg = r.seg[body.joints[v * 4 + q]];
      if (sg !== headSeg && sg !== neckSeg && !open.has(sg)) vseg[v * 4 + q] = sg;
    }
  const perSeg: number[][] = r.sk.names.map(() => []);
  const last = new Int32Array(r.sk.names.length).fill(-1);
  const tris = body.triangles;
  for (let t = 0; t < tris.length; t += 3)
    for (let k = 0; k < 12; k++) {
      const sg = vseg[tris[t + (k >> 2)] * 4 + (k & 3)];
      if (sg < 0 || last[sg] === t) continue;
      last[sg] = t;
      perSeg[sg].push(t);
    }
  const lists = new Map(perSeg.map((l, s): [number, number[]] => [s, l]).filter(([, l]) => l.length));
  for (const [s, list] of lists) {
    const name = r.sk.names[s], target = TRIM.test(name) ? b.trim : b.plate;
    if (/^ball_/.test(name) && buildToeCap(body, r, s, style.thick, target)) continue;
    buildPlate(body, r, s, list, style, target);
  }
  const shell = headShell(body, r, c.head === "android", 0.0035 + style.thick * 0.5);
  buildHead(body, r, c, shell, b);
  buildJoints(body, r, b, style.thick);
  if (open.size) buildSpineRings(body, r, b);
  if (c.core) buildCore(body, r, b, 0.0025 + style.thick);
  buildFrame(body, r, shell, b.frame);
  const parts: PartMesh[] = [];
  for (const kind of ["frame", "plate", "trim", "joint", "visor", "glow"] as const) {
    const bld = b[kind];
    if (bld.count) parts.push(bld.build(`robot-${kind}`, kind));
  }
  let bodyMin = Infinity, partMin = Infinity;
  for (let v = 0; v < body.positions.length / 3; v++) if (body.used[v]) bodyMin = Math.min(bodyMin, body.positions[v * 3 + 1]);
  for (const p of parts) for (let i = 1; i < p.positions.length; i += 3) partMin = Math.min(partMin, p.positions[i]);
  return { parts, lift: Math.max(0, bodyMin - partMin) };
}

/** Name of the worker shape task that builds robot parts (see `serveRuntime`). */
export const ROBOT_TASK = "robot";

/** Worker shape task: robot parts for the new shape, with their buffers transferred. */
export const robotTask: ShapeTask = (runtime, shape, args) => {
  const body = robotBody(shape, runtime.meshes);
  const result: RobotParts = body ? buildRobot(body, args as Partial<RobotConfig>) : { parts: [], lift: 0 };
  const transfer: ArrayBuffer[] = [];
  for (const p of result.parts)
    for (const a of [p.positions, p.normals, p.uvs, p.shade, p.joints, p.weights, p.indices, p.anchors]) if (a) transfer.push(a.buffer as ArrayBuffer);
  return { result, transfer };
};

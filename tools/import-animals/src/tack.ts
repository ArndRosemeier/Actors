/**
 * Horse tack, generated around the base horse like its body: a saddle cloth,
 * a general-purpose saddle with flaps, girth, stirrup leathers and irons, and a
 * snaffle bridle with reins. Each piece is an implicit surface (mostly layers
 * lying on the horse's skin, see `layer` in horse.ts) meshed with Surface Nets.
 * Vertices take the skin weights of the body under them, so the tack follows
 * the horse in every clip and morph; the stirrups hang rigidly from the
 * `saddle` bone (the rider's seat).
 */
import { MeshoptSimplifier } from "meshoptimizer";
import { type Vec3, normalize } from "@actors/core";
import type { BodyPart } from "./dog";
import { type HorseBody, layer, ph, topLine } from "./horse";
import { gradient, neighbours, project, relax, surfaceNets } from "./mesher";
import { type Part, type Primitive, bodyDistance, box, capsule, ellipsoid, frameFrom } from "./sdf";

export interface TackPiece {
  name: string;
  positions: Float32Array;
  indices: Uint32Array;
  uv: Float32Array;
  joints: Uint16Array;
  weights: Float32Array;
  material: "other" | "cloth";
  /** Linear RGB. */
  color: [number, number, number];
  roughness: number;
  tags: string[];
  /** Whether the viewer may hide it (default true); horns are always shown (morphs size them). */
  optional?: boolean;
}

interface Surface {
  positions: Float32Array;
  joints: Uint16Array;
  weights: Float32Array;
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Signed distance (metres) to a polygon given in photo pixels, in the side (z, y) plane, less `round`. */
function sidePolygon(px: [number, number][], round = 0): (p: Vec3) => number {
  const pts = px.map(([x, y]) => ph(x, y)).map((q) => [q[2], q[1]] as [number, number]);
  return (p) => {
    const z = p[2], y = p[1];
    let d = Infinity, inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [ax, ay] = pts[j], [bx, by] = pts[i];
      const ex = bx - ax, ey = by - ay;
      const t = Math.max(0, Math.min(1, ((z - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey)));
      d = Math.min(d, Math.hypot(z - ax - ex * t, y - ay - ey * t));
      if (ay > y !== by > y && z < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    }
    return (inside ? -d : d) - round;
  };
}

/** Distance to a 3D polyline. */
function polylineDistance(p: Vec3, pts: Vec3[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], ab = sub(pts[i + 1], a);
    const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1e-12)));
    best = Math.min(best, len(sub(p, add(a, scale(ab, t)))));
  }
  return best;
}

/** A torus: ring of radius R around `axis` through `center`, tube radius r. */
function torus(name: string, center: Vec3, axis: Vec3, R: number, r: number): Primitive {
  const n = normalize(axis);
  const e = R + r;
  return {
    name,
    min: center.map((c) => c - e) as Vec3,
    max: center.map((c) => c + e) as Vec3,
    distance(p) {
      const d = sub(p, center);
      const h = dot(d, n);
      const radial = len(sub(d, scale(n, h)));
      return Math.hypot(radial - R, h) - r;
    },
  };
}

/** Moves p onto the surface of `parts` (Newton steps along the gradient), then `offset` out along the normal. */
function onSurface(parts: BodyPart[], p: Vec3, offset = 0): Vec3 {
  const f = (q: Vec3) => bodyDistance(parts, q);
  let q: Vec3 = [...p];
  for (let i = 0; i < 12; i++) {
    const d = f(q);
    const g = normalize(gradient(f, q));
    q = sub(q, scale(g, d));
    if (Math.abs(d) < 1e-5) break;
  }
  return add(q, scale(normalize(gradient(f, q)), offset));
}

/** The surface point on the side of `parts` at height y and depth z (x > 0: left side), pushed out by `offset`. */
function sidePoint(parts: BodyPart[], y: number, z: number, side: number, offset = 0): Vec3 {
  let x = 0.6 * side;
  while (Math.abs(x) > 0 && bodyDistance(parts, [x, y, z]) > 0) x -= 0.002 * side;
  return [x + offset * side, y, z];
}

/** Meshes an implicit surface (parts in order, unions and carves) into about `triangles` triangles. */
export async function meshParts(parts: Part[], cell: number, triangles: number): Promise<{ positions: Float32Array; indices: Uint32Array }> {
  const f = (p: Vec3) => bodyDistance(parts, p);
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const { prim, carve } of parts) {
    if (carve) continue;
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], prim.min[k] - 0.01);
      hi[k] = Math.max(hi[k], prim.max[k] + 0.01);
    }
  }
  const nets = surfaceNets(f, lo, hi, cell, 3);
  project(f, nets.positions);
  relax(f, nets.positions, neighbours(nets.positions.length / 3, nets.quads, 4), 2, 0.5);
  const P = nets.positions;
  const tris: number[] = [];
  const d2 = (a: number, b: number) => (P[a * 3] - P[b * 3]) ** 2 + (P[a * 3 + 1] - P[b * 3 + 1]) ** 2 + (P[a * 3 + 2] - P[b * 3 + 2]) ** 2;
  for (let q = 0; q < nets.quads.length; q += 4) {
    const [a, b, c, d] = nets.quads.subarray(q, q + 4);
    if (d2(a, c) <= d2(b, d)) tris.push(a, b, c, a, c, d);
    else tris.push(a, b, d, b, c, d);
  }
  await MeshoptSimplifier.ready;
  const pos32 = Float32Array.from(P);
  const [simplified] = MeshoptSimplifier.simplify(Uint32Array.from(tris), pos32, 3, Math.min(tris.length, triangles * 3), 0.002, ["LockBorder"]);
  const remap = new Int32Array(P.length / 3).fill(-1);
  const keep: number[] = [];
  const indices = new Uint32Array(simplified.length);
  simplified.forEach((v, i) => {
    if (remap[v] < 0) {
      remap[v] = keep.length;
      keep.push(v);
    }
    indices[i] = remap[v];
  });
  const p64 = new Float64Array(keep.length * 3);
  keep.forEach((v, i) => p64.set(P.subarray(v * 3, v * 3 + 3), i * 3));
  project(f, p64, 2);
  const positions = Float32Array.from(p64);
  // Wind the triangles counter-clockwise seen from outside (along the distance gradient).
  let agree = 0;
  for (let t = 0; t < indices.length; t += 3 * 7) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]].map((i) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]] as Vec3);
    const e1 = sub(b, a), e2 = sub(c, a);
    const nrm: Vec3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    agree += Math.sign(dot(nrm, gradient(f, scale(add(add(a, b), c), 1 / 3))));
  }
  if (agree < 0) for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  return { positions, indices };
}

/** Skin weights for tack vertices: those of the nearest body vertex (a spatial hash over the body). */
export function nearestSkin(surface: Surface): (p: Vec3) => { joints: number[]; weights: number[] } {
  const h = 0.04;
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const grid = new Map<string, number[]>();
  const P = surface.positions;
  for (let v = 0; v < P.length / 3; v++) {
    const k = key(Math.floor(P[v * 3] / h), Math.floor(P[v * 3 + 1] / h), Math.floor(P[v * 3 + 2] / h));
    let list = grid.get(k);
    if (!list) grid.set(k, (list = []));
    list.push(v);
  }
  return (p) => {
    const cx = Math.floor(p[0] / h), cy = Math.floor(p[1] / h), cz = Math.floor(p[2] / h);
    let best = -1, bd = Infinity;
    for (let r = 1; best < 0 && r < 12; r++)
      for (let x = cx - r; x <= cx + r; x++)
        for (let y = cy - r; y <= cy + r; y++)
          for (let z = cz - r; z <= cz + r; z++)
            for (const v of grid.get(key(x, y, z)) ?? []) {
              const d = (P[v * 3] - p[0]) ** 2 + (P[v * 3 + 1] - p[1]) ** 2 + (P[v * 3 + 2] - p[2]) ** 2;
              if (d < bd) {
                bd = d;
                best = v;
              }
            }
    return { joints: Array.from(surface.joints.subarray(best * 4, best * 4 + 4)), weights: Array.from(surface.weights.subarray(best * 4, best * 4 + 4)) };
  };
}

/** Builds the tack pieces for the base horse. */
export async function horseTack(body: HorseBody, surface: Surface, cell: number): Promise<TackPiece[]> {
  const { rig, horse } = body;
  const skin = horse.skin;
  const saddleBone = rig.index.get("saddle")!;
  const near = nearestSkin(surface);
  const sideOf = (px: number, py: number, side: number, offset = 0) => sidePoint(skin, ph(px, py)[1], ph(px, py)[2], side, offset);
  const top = (px: number) => topLine(skin, ph(px, 0)[2]);
  const bounds = (a: Vec3, b: Vec3): [Vec3, Vec3] => [a.map((v, k) => Math.min(v, b[k])) as Vec3, a.map((v, k) => Math.max(v, b[k])) as Vec3];
  const part = (prim: Primitive, k = 0, carve = false): Part => ({ prim, k, carve });

  // --- Saddle cloth: a quilted pad under the saddle, from behind the withers over the back ---
  const [clothLo, clothHi] = bounds(ph(280, 90, -0.45), ph(520, 320, 0.45));
  const cloth = [part(layer("saddlecloth", skin, 0.007, 0.0055, sidePolygon([[300, 100], [503, 100], [492, 292], [318, 300]], 0.035), clothLo, clothHi))];

  // --- Saddle: panels on the cloth, pommel and cantle, flaps over the sides, the girth ---
  const [sLo, sHi] = bounds(ph(320, 60, -0.4), ph(500, 240, 0.4));
  const pommelZ = ph(474, 0)[2], cantleZ = ph(340, 0)[2];
  const flapMask = sidePolygon([[468, 178], [396, 178], [408, 345], [506, 336]], 0.02);
  const [fLo, fHi] = bounds(ph(380, 160, -0.42), ph(525, 360, 0.42));
  const flapTop = ph(0, 190)[1], flapBottom = ph(0, 345)[1];
  const flaps: Primitive = {
    name: "flaps",
    min: fLo,
    max: fHi,
    distance(p) {
      // Close to the barrel at the bottom; over the panels at the top.
      const off = 0.018 + 0.034 * smoothstep(flapBottom + 0.12, flapTop, p[1]);
      return Math.max(Math.abs(bodyDistance(skin, p) - off) - 0.0035, flapMask(p), 0.12 - Math.abs(p[0]));
    },
  };
  const girthA = ph(450, 286), girthB = ph(510, 430);
  const girthDir = normalize(sub(girthB, girthA));
  const [gLo, gHi] = bounds(ph(420, 270, -0.4), ph(540, 450, 0.4));
  const girthMask = (p: Vec3) => {
    const q = sub(p, girthA);
    const across = Math.abs(q[2] * girthDir[1] - q[1] * girthDir[2]);
    return Math.max(across - 0.042, p[1] - girthA[1]);
  };
  const saddle: Part[] = [
    part(layer("panels", skin, 0.03, 0.019, sidePolygon([[340, 112], [478, 112], [468, 218], [348, 218]], 0.03), sLo, sHi)),
    part(ellipsoid("pommel", [0, top(474) + 0.058, pommelZ], frameFrom([0, 0.4, 1]), [0.07, 0.03, 0.045]), 0.035),
    part(ellipsoid("cantle", [0, top(340) + 0.07, cantleZ], frameFrom([0, 0.7, -1], [1, 0, 0]), [0.125, 0.025, 0.045]), 0.04),
    part(flaps, 0.01),
    part(layer("girth", skin, 0.012, 0.006, girthMask, gLo, gHi), 0.004),
  ];
  // Stirrup leathers: from the stirrup bars under the skirt, down over the flaps to the irons.
  const irons: { top: Vec3; side: number }[] = [];
  const leathers: Primitive[] = [];
  for (const side of [1, -1]) {
    const bar = sideOf(456, 178, side, 0.05);
    const mid = sideOf(450, 280, side, 0.032);
    const low = sideOf(446, 372, side, 0.03);
    const ironTop = add(low, [0.012 * side, -0.03, 0]);
    irons.push({ top: ironTop, side });
    for (const [a, b] of [[bar, mid], [mid, low], [low, ironTop]] as [Vec3, Vec3][])
      leathers.push(capsule("leather", a, b, 0.0125, 0.0125, [side, 0, 0], [0.3, 1]));
  }
  for (const l of leathers) saddle.push(part(l, 0.004));

  // --- Stirrup irons and the bit: steel ---
  const metal: Part[] = [];
  for (const { top: t } of irons) {
    // A D-shaped iron in the plane across the horse, the tread at the bottom.
    const R = 0.062, tube = 0.0075;
    const c = add(t, [0, -R, 0]);
    const arch: Vec3[] = [];
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * Math.PI;
      arch.push(add(c, [Math.cos(a) * R, Math.sin(a) * R, 0]));
    }
    for (let i = 0; i < 8; i++) metal.push(part(capsule("iron", arch[i], arch[i + 1], tube, tube), 0.002));
    for (const s of [1, -1]) metal.push(part(capsule("iron", add(c, [s * R, 0, 0]), add(c, [s * R * 0.9, -0.045, 0]), tube, tube), 0.004));
    metal.push(part(box("tread", add(c, [0, -0.05, 0]), frameFrom([0, 0, 1]), [R * 0.95, 0.007, 0.03], 0.003), 0.006));
    metal.push(part(box("eye", add(t, [0, 0.004, 0]), frameFrom([0, 0, 1]), [0.022, 0.008, 0.006], 0.003), 0.004));
  }
  // Snaffle: a jointed mouthpiece through the corners of the mouth and a loose ring on each side.
  const hp = horse.headPt;
  const ringAt = (s: number) => hp(0.85, -0.058, 0.082 * s);
  metal.push(part(capsule("mouthpiece", ringAt(1), hp(0.86, -0.06, 0), 0.007, 0.006), 0.003));
  metal.push(part(capsule("mouthpiece", ringAt(-1), hp(0.86, -0.06, 0), 0.007, 0.006), 0.003));
  for (const s of [1, -1]) metal.push(part(torus("ring", add(ringAt(s), [0.004 * s, 0, 0]), [1, 0, 0], 0.03, 0.0045), 0.002));

  // --- Bridle: straps lying on the head, and the reins along the neck ---
  const strapOn = (pts: Vec3[], width = 0.012): Part => {
    // Projected every centimetre, so the strap follows the curve of the head between its points
    // (a chord between sparse points sinks under a round cheek and the strap vanishes there).
    const ends = pts.map((p) => onSurface(skin, p));
    const onSkin: Vec3[] = [ends[0]];
    for (let i = 0; i + 1 < ends.length; i++) {
      const steps = Math.max(1, Math.ceil(Math.hypot(...sub(ends[i + 1], ends[i])) / 0.01));
      for (let k = 1; k <= steps; k++) onSkin.push(onSurface(skin, add(ends[i], scale(sub(ends[i + 1], ends[i]), k / steps))));
    }
    const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const p of onSkin) for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k], p[k] - 0.05)), (hi[k] = Math.max(hi[k], p[k] + 0.05));
    return part(layer("strap", skin, 0.006, 0.0042, (p) => polylineDistance(p, onSkin) - width, lo, hi), 0.003);
  };
  const both = (f: (s: number) => Vec3[]) => [...f(-1).reverse(), ...f(1)];
  const bridle: Part[] = [
    // Headpiece over the poll behind the ears, down each side to the cheek.
    strapOn(both((s) => [hp(-0.03, 0.035, 0.0), hp(-0.015, 0.02, 0.05 * s), hp(0.06, -0.04, 0.095 * s), hp(0.13, -0.07, 0.1 * s)])),
    // Browband across the forehead in front of the ears.
    strapOn(both((s) => [hp(0.07, 0.04, 0), hp(0.05, 0.02, 0.07 * s), hp(0.04, -0.02, 0.1 * s)]), 0.01),
    // Throatlatch: from the headpiece under the throat.
    strapOn(both((s) => [hp(0.02, -0.25, 0), hp(0.03, -0.17, 0.07 * s), hp(0.04, -0.06, 0.1 * s)]), 0.008),
    // Cheekpieces down to the bit rings.
    ...[1, -1].map((s) => strapOn([hp(0.1, -0.06, 0.1 * s), hp(0.35, -0.06, 0.1 * s), hp(0.62, -0.06, 0.085 * s), add(ringAt(s), [0, 0.03, 0])])),
    // Cavesson noseband: round the nose below the facial crest.
    strapOn(both((s) => [hp(0.62, 0.05, 0), hp(0.61, 0.0, 0.08 * s), hp(0.59, -0.08, 0.07 * s), hp(0.56, -0.15, 0)]), 0.013),
  ];
  // Reins: from the bit rings along the sides of the neck, meeting on the crest in front of the withers.
  const all = body.parts.filter((p) => p.region !== "tail" && p.region !== "leg" && p.region !== "hoof");
  for (const s of [1, -1]) {
    const pts = [add(ringAt(s), [0.01 * s, -0.022, 0]), ...[[840, 205, 0.1], [790, 185, 0.12], [720, 160, 0.14], [650, 135, 0.13], [590, 128, 0.08]].map(([px, py, x]) => onSurface(all, ph(px, py, x * s), 0.012)), add(ph(560, 128, 0), [0, 0.005, 0])];
    for (let i = 0; i + 1 < pts.length; i++) bridle.push(part(capsule("rein", pts[i], pts[i + 1], 0.0065, 0.0065, [s, 0, 0], [0.55, 1]), 0.004));
  }

  const pieces: { name: string; parts: Part[]; cell: number; triangles: number; material: TackPiece["material"]; color: [number, number, number]; roughness: number; tags: string[]; rigid?: (p: Vec3) => boolean }[] = [
    { name: "saddlecloth", parts: cloth, cell, triangles: 7000, material: "cloth", color: [0.72, 0.7, 0.66], roughness: 0.85, tags: ["saddle"] },
    { name: "saddle", parts: saddle, cell: cell * 0.7, triangles: 18000, material: "other", color: [0.16, 0.07, 0.03], roughness: 0.5, tags: ["saddle", "leather"], rigid: (p) => leathers.some((l) => l.distance(p) < 0.004) },
    { name: "stirrups", parts: metal.filter((p) => p.prim.name === "iron" || p.prim.name === "tread" || p.prim.name === "eye"), cell: cell * 0.5, triangles: 5000, material: "other", color: [0.6, 0.6, 0.62], roughness: 0.3, tags: ["saddle", "metal"], rigid: () => true },
    { name: "bridle", parts: bridle, cell: cell * 0.5, triangles: 14000, material: "other", color: [0.05, 0.025, 0.015], roughness: 0.5, tags: ["bridle", "leather"] },
    { name: "bit", parts: metal.filter((p) => p.prim.name === "mouthpiece" || p.prim.name === "ring"), cell: cell * 0.35, triangles: 3000, material: "other", color: [0.6, 0.6, 0.62], roughness: 0.3, tags: ["bridle", "metal"] },
  ];
  const out: TackPiece[] = [];
  for (const piece of pieces) {
    const t = Date.now();
    const mesh = await meshParts(piece.parts, piece.cell, piece.triangles);
    const n = mesh.positions.length / 3;
    const joints = new Uint16Array(n * 4), weights = new Float32Array(n * 4);
    for (let v = 0; v < n; v++) {
      const p: Vec3 = [mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]];
      if (piece.rigid?.(p)) {
        joints.set([saddleBone, 0, 0, 0], v * 4);
        weights.set([1, 0, 0, 0], v * 4);
      } else {
        const s = near(p);
        joints.set(s.joints, v * 4);
        weights.set(s.weights, v * 4);
      }
    }
    console.log(`  tack ${piece.name}: ${n} vertices, ${mesh.indices.length / 3} triangles (${Date.now() - t} ms)`);
    out.push({ name: piece.name, positions: mesh.positions, indices: mesh.indices, uv: new Float32Array(n * 2), joints, weights, material: piece.material, color: piece.color, roughness: piece.roughness, tags: piece.tags });
  }
  void lerp;
  return out;
}

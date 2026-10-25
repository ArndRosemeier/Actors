/**
 * From the implicit dog body to a skinned, triangulated pack mesh: Surface
 * Nets, projection and relaxation, simplification (meshoptimizer), then per
 * vertex skin weights, fur direction and coat regions.
 */
import { MeshoptSimplifier } from "meshoptimizer";
import { type Vec3, normalize } from "@actors/core";
import { type BodyPart, type DogBody, type Region, mouthLineY } from "./dog";
import { gradient, neighbours, project, relax, surfaceNets } from "./mesher";
import { bodyDistance } from "./sdf";

export interface BodyMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** 4 bone indices and weights per vertex. */
  joints: Uint16Array;
  weights: Float32Array;
  /** Fur direction per vertex (unit, tangent to the surface). */
  flow: Float32Array;
  /** Per-vertex coat data, 4 floats each (see coatRegions). */
  coatA: Float32Array;
  coatB: Float32Array;
  coatC: Float32Array;
  coatD: Float32Array;
  coatE: Float32Array;
  coatF: Float32Array;
  uv: Float32Array;
}

/** Per-vertex coat data from part membership (the dog's coatRegions, or an animal's own). */
export type CoatFunction = (
  body: DogBody,
  positions: Float32Array,
  normals: Float32Array,
  weights: Float32Array,
  boneCount: number,
  regions: Map<Region, Float32Array>,
  furLength: Float32Array,
) => { coatA: Float32Array; coatB: Float32Array; coatC: Float32Array; coatD: Float32Array; coatE: Float32Array; coatF: Float32Array };

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Distance from p to segment a-b, and the parameter of the closest point. */
export function segmentDistance(p: Vec3, a: Vec3, b: Vec3): { d: number; t: number } {
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap: Vec3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const L2 = dot(ab, ab) || 1e-12;
  const t = Math.max(0, Math.min(1, dot(ap, ab) / L2));
  return { d: Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t), t };
}

export function vertexNormals(positions: ArrayLike<number>, indices: ArrayLike<number>, count: number): Float32Array {
  const n = new Float32Array(count * 3);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const e1 = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
    const e2 = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
    const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    for (const v of [a, b, c]) {
      n[v] += nx;
      n[v + 1] += ny;
      n[v + 2] += nz;
    }
  }
  for (let i = 0; i < count; i++) {
    const l = Math.hypot(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]) || 1;
    n[i * 3] /= l;
    n[i * 3 + 1] /= l;
    n[i * 3 + 2] /= l;
  }
  return n;
}

/** Surface of the body: quads from Surface Nets, made even and triangulated, then reduced to about `triangles`. */
export async function meshBody(body: DogBody, cell: number, triangles: number): Promise<{ positions: Float32Array; indices: Uint32Array }> {
  const f = (p: Vec3) => bodyDistance(body.parts, p);
  const u = body.unit ?? 1;
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const { prim, carve } of body.parts) {
    if (carve) continue;
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], prim.min[k] - 0.03 * u);
      hi[k] = Math.max(hi[k], prim.max[k] + 0.03 * u);
    }
  }
  const nets = surfaceNets(f, lo, hi, cell, body.band ?? 1);
  project(f, nets.positions);
  relax(f, nets.positions, neighbours(nets.positions.length / 3, nets.quads, 4), 2, 0.5);

  // Triangulate each quad along its shorter diagonal.
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
  const target = Math.min(tris.length, triangles * 3);
  const [simplified] = MeshoptSimplifier.simplify(Uint32Array.from(tris), pos32, 3, target, 0.002, ["LockBorder"]);
  // Drop unused vertices.
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
  const positions = new Float32Array(keep.length * 3);
  keep.forEach((v, i) => positions.set(pos32.subarray(v * 3, v * 3 + 3), i * 3));
  // A last projection: simplification moved vertices off the exact surface.
  const p64 = Float64Array.from(positions);
  project(f, p64, 2);
  taubin(body, p64, neighbours(keep.length, indices, 3), 150);
  positions.set(p64);
  return { positions, indices };
}

/**
 * Taubin smoothing (shrink-free): softens the creases that smooth unions leave
 * where parts meet at steep angles. Mouth, eye sockets and ears keep their
 * exact shape (the slit must stay open, the flaps thin).
 */
function taubin(body: DogBody, P: Float64Array, nb: number[][], iterations: number): void {
  const n = P.length / 3;
  const u = body.unit ?? 1;
  const keepShape = body.parts.filter((q) => q.carve || q.region === "ear" || q.region === "nose" || q.region === "hoof");
  const strength = new Float64Array(n);
  for (let v = 0; v < n; v++) {
    const p: Vec3 = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
    let d = Infinity;
    for (const q of keepShape) d = Math.min(d, Math.abs(q.prim.distance(p)));
    strength[v] = Math.max(0, Math.min(1, (d - 0.004 * u) / (0.012 * u)));
    // The mouth slit may smooth a little: its walls come out jagged from the voxel grid.
    const mouth = body.parts.find((q) => q.prim.name === "mouth");
    if (mouth && Math.abs(mouth.prim.distance(p)) < 0.006 * u) strength[v] = Math.max(strength[v], 0.35);
  }
  const next = new Float64Array(P.length);
  const before = Float64Array.from(P);
  for (let it = 0; it < iterations * 2; it++) {
    const lambda = it % 2 === 0 ? 0.5 : -0.53;
    for (let v = 0; v < n; v++) {
      const list = nb[v];
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (const j of list) sum += P[j * 3 + c];
        const avg = list.length ? sum / list.length : P[v * 3 + c];
        next[v * 3 + c] = P[v * 3 + c] + (avg - P[v * 3 + c]) * lambda * strength[v];
      }
    }
    P.set(next);
  }
  if (process.env.DEBUG_TAUBIN) {
    let moved = 0, maxMoved = 0, mean = 0;
    for (let v = 0; v < n; v++) {
      const d = Math.hypot(P[v * 3] - before[v * 3], P[v * 3 + 1] - before[v * 3 + 1], P[v * 3 + 2] - before[v * 3 + 2]);
      moved += d;
      maxMoved = Math.max(maxMoved, d);
      mean += strength[v];
    }
    console.log(`taubin: mean strength ${(mean / n).toFixed(2)}, mean move ${((moved / n) * 1000).toFixed(2)} mm, max ${(maxMoved * 1000).toFixed(1)} mm`);
  }
}

/**
 * How much each part makes up the surface at p: parts within a few millimetres
 * of the closest one share it (soft, so weights blend across joins).
 */
function membership(parts: BodyPart[], p: Vec3, out: number[], mouth: DogBody["marks"]["mouth"], u: number, split = true): void {
  let best = Infinity;
  // In front of the mouth corner, the slit splits the head: above it is muzzle, below it jaw.
  const inMouth = split && p[2] > mouth.z0 - 0.004 * u;
  const above = p[1] > mouthLineY(mouth, p[2]);
  for (let i = 0; i < parts.length; i++) {
    const region = parts[i].region;
    if (parts[i].carve || (inMouth && ((above && region === "jaw") || (!above && (region === "muzzle" || region === "nose"))))) {
      out[i] = Infinity;
      continue;
    }
    out[i] = parts[i].prim.distance(p);
    best = Math.min(best, out[i]);
  }
  if (best === Infinity) return membership(parts, p, out, mouth, u, false);
  let sum = 0;
  for (let i = 0; i < parts.length; i++) {
    const w = out[i] === Infinity ? 0 : Math.exp(-(out[i] - best) / (0.006 * u));
    out[i] = w < 1e-3 ? 0 : w;
    sum += out[i];
  }
  for (let i = 0; i < parts.length; i++) out[i] /= sum || 1;
}

/** Skin weights, fur flow and coat regions for every vertex. */
export function skinBody(body: DogBody, mesh: { positions: Float32Array; indices: Uint32Array }, coat: CoatFunction = coatRegions): BodyMesh {
  const { rig, parts } = body;
  const u = body.unit ?? 1;
  const n = mesh.positions.length / 3;
  const normals = vertexNormals(mesh.positions, mesh.indices, n);
  // Face winding decides the sign; make the normals point out of the body (along the distance gradient).
  let agree = 0;
  for (let v = 0; v < n; v += 97) {
    const g = gradient((p) => bodyDistance(parts, p), [mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]]);
    agree += Math.sign(g[0] * normals[v * 3] + g[1] * normals[v * 3 + 1] + g[2] * normals[v * 3 + 2]);
  }
  if (agree < 0) {
    for (let i = 0; i < normals.length; i++) normals[i] = -normals[i];
    // Wind the triangles the same way (counter-clockwise seen from outside), or renderers cull the outside.
    const ix = mesh.indices;
    for (let i = 0; i < ix.length; i += 3) [ix[i + 1], ix[i + 2]] = [ix[i + 2], ix[i + 1]];
  }
  const B = rig.bones.length;
  const W = new Float32Array(n * B);
  const flow = new Float32Array(n * 3);
  const regionW = new Map<Region, Float32Array>();
  const furLen = new Float32Array(n);
  const member = new Array<number>(parts.length).fill(0);
  const boneIdx = (name: string) => {
    const i = rig.index.get(name);
    if (i === undefined) throw new Error(`Unknown bone ${name}`);
    return i;
  };
  const partBones = parts.map((pt) => pt.bones.map(boneIdx));

  for (let v = 0; v < n; v++) {
    const p: Vec3 = [mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]];
    membership(parts, p, member, body.marks.mouth, u);
    let fx = 0, fy = 0, fz = 0;
    for (let i = 0; i < parts.length; i++) {
      const m = member[i];
      if (!m) continue;
      const part = parts[i];
      // Share the part's weight between its bones by inverse distance (power 4).
      const bones = partBones[i];
      let sum = 0;
      const local = bones.map((b) => {
        const { d } = segmentDistance(p, rig.bones[b].head, rig.bones[b].tail);
        const w = 1 / Math.pow(Math.max(d, 0.004 * u), 4);
        sum += w;
        return w;
      });
      bones.forEach((b, k) => (W[v * B + b] += (m * local[k]) / sum));
      const fl = part.flow(p);
      fx += fl[0] * m;
      fy += fl[1] * m;
      fz += fl[2] * m;
      let r = regionW.get(part.region);
      if (!r) regionW.set(part.region, (r = new Float32Array(n)));
      r[v] += m;
      furLen[v] += part.fur * m;
    }
    // Fur lies along the surface.
    const nn: Vec3 = [normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]];
    const along = fx * nn[0] + fy * nn[1] + fz * nn[2];
    const t = normalize([fx - nn[0] * along, fy - nn[1] * along, fz - nn[2] * along]);
    flow.set(t, v * 3);
  }

  // Smooth the weights over the surface (a few diffusion steps) so joints bend softly.
  const nb = neighbours(n, mesh.indices, 3);
  smooth(W, B, nb, 3, 0.5);
  smooth(furLen, 1, nb, 4, 0.5);
  for (const r of regionW.values()) smooth(r, 1, nb, 2, 0.5);

  // Keep the 4 largest weights.
  const joints = new Uint16Array(n * 4);
  const weights = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    const row = Array.from(W.subarray(v * B, v * B + B), (w, b) => [w, b]).sort((a, b) => b[0] - a[0]).slice(0, 4);
    const s = row.reduce((a, [w]) => a + w, 0) || 1;
    row.forEach(([w, b], k) => {
      joints[v * 4 + k] = b;
      weights[v * 4 + k] = w / s;
    });
  }

  const coatData = coat(body, mesh.positions, normals, W, B, regionW, furLen);
  return { positions: mesh.positions, normals, indices: mesh.indices, joints, weights, flow, ...coatData, uv: cylinderUV(mesh.positions) };
}

function smooth(values: Float32Array, stride: number, nb: number[][], iterations: number, lambda: number): void {
  const next = new Float32Array(values.length);
  for (let it = 0; it < iterations; it++) {
    for (let v = 0; v < nb.length; v++) {
      const list = nb[v];
      for (let c = 0; c < stride; c++) {
        let s = 0;
        for (const j of list) s += values[j * stride + c];
        const avg = list.length ? s / list.length : values[v * stride + c];
        next[v * stride + c] = values[v * stride + c] + (avg - values[v * stride + c]) * lambda;
      }
    }
    values.set(next);
  }
}

/**
 * Coat data per vertex, read by the fur material:
 * - coatA: leg height (0 at the ground .. 1 at the elbow/stifle and above), head, muzzle (0 at the eyes .. 1 at the nose), tail (0 base .. 1 tip)
 * - coatB: ear, fur length factor, brow spots, chest/throat bib
 * - coatC: nose leather, lips and mouth, paw pads, eye rims
 * - coatD: back (saddle), underside and inner legs, mask (muzzle and around the eyes), blaze (white stripe over forehead and muzzle)
 * - coatE: light (wolf) mask (cheeks, muzzle sides and lower jaw, below the eyes), eye ring, tail, ear tip (0 root .. 1 tip)
 * - coatF: position seen from in front of the nose (side, up, depth; in dog-sized meters, i.e. divided by the body's unit), for nose leather detail (nostrils, philtrum), unused
 */
export function coatRegions(body: DogBody, P: Float32Array, N: Float32Array, W: Float32Array, B: number, regions: Map<Region, Float32Array>, furLen: Float32Array) {
  const { rig, marks, eyes } = body;
  const u = body.unit ?? 1;
  const n = P.length / 3;
  const coatA = new Float32Array(n * 4), coatB = new Float32Array(n * 4), coatC = new Float32Array(n * 4), coatD = new Float32Array(n * 4), coatE = new Float32Array(n * 4), coatF = new Float32Array(n * 4);
  // The light mask's upper edge: from just below the eyes down to the upper lip at the nose.
  const eyeY = Math.max(...eyes.map((e) => e.center[1])), eyeZ = Math.max(...eyes.map((e) => e.center[2]));
  const lineY = (z: number) => eyeY - 0.02 * u + ((z - eyeZ) * (tip[1] - 0.014 * u - (eyeY - 0.02 * u))) / (tip[2] - eyeZ);
  const r = (name: Region) => regions.get(name) ?? new Float32Array(n);
  const leg = r("leg"), paw = r("paw"), head = r("head"), muzzle = r("muzzle"), jaw = r("jaw"), nose = r("nose"), ear = r("ear"), torso = r("torso"), neck = r("neck"), tail = r("tail");
  const bone = (name: string) => rig.bones[rig.index.get(name)!];
  const elbowY = bone("Front_Leg_Lower_L").head[1];
  const stop = bone("Nose").head, tip = bone("Head.tip").tail;
  // The nose's own frame: forward along the nose bone, up perpendicular to it (and to the side).
  const noseFwd = normalize(bone("Head.tip").tail.map((c, k) => c - bone("Head.tip").head[k]) as Vec3);
  const noseUp = normalize([0, noseFwd[2], -noseFwd[1]]);
  const tailBones = ["Tail_Base", "Tail_Mid", "Tail_Mid.001", "Tail_End", "Tail_Tip"].map((b) => rig.index.get(b)!);
  const smoothstep = (a: number, b: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  for (let v = 0; v < n; v++) {
    const p: Vec3 = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
    const nn: Vec3 = [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]];
    const legW = Math.min(1, leg[v] + paw[v]);
    const legT = 1 - legW * (1 - Math.min(1, p[1] / elbowY));
    const headW = Math.min(1, head[v] + muzzle[v] + jaw[v] + nose[v] + ear[v]);
    const muzzleT = Math.min(1, muzzle[v] + jaw[v] + nose[v]) * Math.max(0, Math.min(1, (p[2] - (stop[2] - 0.01 * u)) / (tip[2] - stop[2] + 0.01 * u)));
    // Position along the tail chain: bone order plus the position on the bone.
    let tw = 0, tt = 0;
    tailBones.forEach((b, k) => {
      const w = W[v * B + b];
      if (!w) return;
      const { t } = segmentDistance(p, rig.bones[b].head, rig.bones[b].tail);
      tw += w;
      tt += w * ((k + t) / tailBones.length);
    });
    const tailT = tw > 0.3 ? tt / tw : 0;
    coatA.set([legT, headW, muzzleT, tailT], v * 4);

    const brow = Math.max(...marks.brows.map((b) => Math.exp(-((p[0] - b[0]) ** 2 + (p[1] - b[1]) ** 2 * 1.6 + (p[2] - b[2]) ** 2) / (2 * (0.008 * u) ** 2))));
    // Bib: the front of the chest and the throat, below the spine.
    const front = smoothstep(0.1, 0.6, nn[2] * 0.8 - nn[1] * 0.6);
    const bib = Math.min(1, torso[v] + neck[v]) * front * smoothstep(bone("Spine_2.001").head[1] - 0.02 * u, bone("Spine_2.001").head[1] - 0.14 * u, p[1]) * smoothstep(0.05 * u, 0.2 * u, p[2]);
    coatB.set([ear[v], furLen[v], brow, bib], v * 4);

    const noseW = smoothstep(0.3, 0.6, nose[v]);
    // Lips: close to the mouth slit, inside it, and at the corners.
    const m = marks.mouth;
    const along = (p[2] - m.z0) / (m.z1 - m.z0);
    const lipDist = Math.abs(p[1] - mouthLineY(m, p[2]));
    const lips = along > -0.08 && along < 1.05 && Math.abs(p[0]) < m.halfWidth + 0.01 * u ? smoothstep(0.011 * u, 0.005 * u, lipDist) * Math.min(1, muzzle[v] + jaw[v] + nose[v] + head[v]) : 0;
    const pads = paw[v] * smoothstep(-0.3, -0.75, nn[1]) * smoothstep(0.02 * u, 0.008 * u, p[1]);
    const rim = Math.max(...eyes.map((e) => smoothstep(e.radius + 0.0035 * u, e.radius + 0.001 * u, Math.hypot(p[0] - e.center[0], p[1] - e.center[1], p[2] - e.center[2]))));
    coatC.set([noseW, lips, pads, rim], v * 4);
    // Short fur along the lips, so shells from above and below don't bristle across the mouth line.
    if (along > -0.15 && along < 1.1) coatB[v * 4 + 1] *= smoothstep(0.004 * u, 0.018 * u, lipDist);

    const trunk = Math.min(1, torso[v] + neck[v] + tail[v] + leg[v] * smoothstep(0.85, 1, legT) * smoothstep(elbowY + 0.1 * u, elbowY + 0.2 * u, p[1]));
    const back = trunk * smoothstep(-0.35, 0.45, nn[1]);
    // Inner side of the legs (facing the other leg, not up into the body).
    const inner = leg[v] * smoothstep(0.1, 0.6, -Math.sign(p[0]) * nn[0]) * smoothstep(0.45, 0.1, nn[1]);
    const under = Math.min(1, (torso[v] + neck[v] + tail[v]) * smoothstep(-0.05, -0.6, nn[1]) + inner + paw[v] * 0.5);
    const eyeNear = Math.max(...eyes.map((e) => Math.exp(-((p[0] - e.center[0]) ** 2 + (p[1] - e.center[1]) ** 2 + (p[2] - e.center[2]) ** 2) / (2 * (0.02 * u) ** 2))));
    const mask = Math.min(1, Math.min(1, muzzle[v] + jaw[v] + nose[v]) * smoothstep(-0.2, 0.3, muzzleT * 2 - 0.2) + eyeNear * headW);
    const blaze = headW * (1 - ear[v]) * Math.exp(-((p[0] / (0.011 * u)) ** 2)) * smoothstep(0, 0.45, nn[1] + nn[2] * 0.6) * smoothstep(stop[2] - 0.07 * u, stop[2] - 0.03 * u, p[2]);
    coatD.set([back, under, mask, blaze], v * 4);
    const pale = Math.min(1, headW + neck[v] * smoothstep(bone("Head").head[2] - 0.08 * u, bone("Head").head[2] + 0.02 * u, p[2])) * (1 - ear[v]) * smoothstep(0.006 * u, -0.01 * u, p[1] - lineY(p[2])) * smoothstep(bone("Head").head[2] - 0.01 * u, bone("Head").head[2] + 0.07 * u, p[2]);
    // Pale ring around the eye (squirrels, some cats), the tail, and how far out along the ear (for ear tufts).
    const ring = headW * Math.max(...eyes.map((e) => {
      const d = Math.hypot(p[0] - e.center[0], p[1] - e.center[1], p[2] - e.center[2]) - e.radius;
      return smoothstep(0.0005 * u, 0.002 * u, d) * smoothstep(0.016 * u, 0.008 * u, d);
    }));
    let earT = 0;
    if (ear[v] > 0) {
      const side = p[0] >= 0 ? "L" : "R";
      const a = bone(`Ear_${side}`).head, b = bone(`Ear_Tip_${side}`).tail;
      earT = ear[v] * segmentDistance(p, a, b).t;
    }
    coatE.set([pale, ring, Math.min(1, tail[v]), earT], v * 4);
    const q: Vec3 = [p[0] - marks.nose[0], p[1] - marks.nose[1], p[2] - marks.nose[2]];
    coatF.set([q[0] / u, dot(q, noseUp) / u, dot(q, noseFwd) / u, 0], v * 4);
  }
  return { coatA, coatB, coatC, coatD, coatE, coatF };
}

/** A simple cylindrical UV layout around the body's long axis (for exports; the fur material works without UVs). */
function cylinderUV(P: Float32Array): Float32Array {
  const n = P.length / 3;
  const uv = new Float32Array(n * 2);
  let zmin = Infinity, zmax = -Infinity;
  for (let i = 0; i < n; i++) {
    zmin = Math.min(zmin, P[i * 3 + 2]);
    zmax = Math.max(zmax, P[i * 3 + 2]);
  }
  for (let i = 0; i < n; i++) {
    uv[i * 2] = Math.atan2(P[i * 3], P[i * 3 + 1] - 0.4) / (2 * Math.PI) + 0.5;
    uv[i * 2 + 1] = (P[i * 3 + 2] - zmin) / (zmax - zmin);
  }
  return uv;
}

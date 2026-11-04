import { MeshoptSimplifier } from "meshoptimizer";
import type { LodDef, MeshDef } from "@actors/core";
import type { BlobWriter } from "./blob";

/** Finger bones of the game_engine rig: the crowd level animates the hand as one piece. */
const FINGER = /^(thumb|index|middle|ring|pinky)_\d\d_[lr]$/;

/** Detail levels of the human pack. Distances are for a ~1.7 m character in a ~50° view. */
export function humanLods(boneNames: string[]): LodDef[] {
  return [
    { name: "Full", distance: 0 },
    { name: "Medium", distance: 8 },
    { name: "Crowd", distance: 25, bones: boneNames.filter((b) => !FINGER.test(b)), merge: true },
  ];
}

/**
 * How far each level reduces a kind of mesh: [level, share of triangles kept, max error relative
 * to the mesh size, at most this many triangles (optional)]. The caps keep heavy garments (some
 * MakeHuman clothes have 70k triangles) from dominating a crowd: a person at the crowd level is
 * about 100 pixels tall.
 */
export type LodSteps = [level: number, ratio: number, error: number, maxTriangles?: number, weld?: boolean][];

// The crowd level may weld split vertices to get under its cap: it draws garments in flat colours, so the UVs that welding blurs are not used.
export const GARMENT_LODS: LodSteps = [[1, 0.5, 0.015, 12000], [2, 0.2, 0.06, 1500, true]];
export const HAIR_LODS: LodSteps = [[1, 0.5, 0.02, 6000], [2, 0.25, 0.08, 1200]];
export const SMALL_LODS: LodSteps = [[1, 0.35, 0.02]];

export const ready = MeshoptSimplifier.ready;

/**
 * Reduced triangle lists over the same render vertices (meshoptimizer: UV
 * seams stay closed because split vertices share a position). `positions`:
 * source vertex positions in meters; `clip`: per render vertex hem value,
 * kept as an attribute so the cut stays where it was.
 */
export function simplifyLevels(
  writer: BlobWriter,
  positions: ArrayLike<number>,
  mesh: { map: ArrayLike<number>; indices: ArrayLike<number> },
  steps: LodSteps,
  clip?: ArrayLike<number>,
): MeshDef["simplified"] {
  const n = mesh.map.length;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) pos[i * 3 + c] = positions[mesh.map[i] * 3 + c];
  const source = Uint32Array.from(mesh.indices);
  const out: NonNullable<MeshDef["simplified"]> = [];
  let last = source.length;
  let welded: ReturnType<typeof weldMesh> | undefined;
  for (const [level, ratio, error, cap = Infinity, weld = false] of steps) {
    const target = Math.max(3, Math.floor(Math.min((source.length * ratio) / 3, cap)) * 3);
    const run = (e: number) =>
      (clip
        ? MeshoptSimplifier.simplifyWithAttributes(source, pos, 3, Float32Array.from(clip), 1, [1], null, target, e)
        : MeshoptSimplifier.simplify(source, pos, 3, target, e))[0];
    let indices = run(error);
    // A capped level that the error bound stops far short (ruffles, many small pieces): allow more error, up to 4x.
    for (let e = error * 2; cap < Infinity && (indices.length > target * 1.5 || !indices.length) && e <= error * 4; e *= 2) {
      const looser = run(e);
      if (looser.length && (looser.length < indices.length || !indices.length)) indices = looser;
    }
    // Still far over: the mesh is many loose pieces (a triangle soup, every triangle with its own
    // corners), which the simplifier cannot collapse. Weld corners that share a position (and hem value).
    if (weld && cap < Infinity && (indices.length > target * 1.5 || !indices.length)) {
      welded ??= weldMesh(source, pos, clip);
      const w = welded;
      const found = w.clip
        ? MeshoptSimplifier.simplifyWithAttributes(w.indices, w.pos, 3, w.clip, 1, [1], null, target, error * 4)[0]
        : MeshoptSimplifier.simplify(w.indices, w.pos, 3, target, error * 4)[0];
      const solid = found.map((i) => w.vertex[i]);
      if (solid.length && (solid.length < indices.length || !indices.length)) indices = solid;
    }
    // Only worth storing when it saves a good share over the previous level.
    if (indices.length > last * 0.85 || !indices.length) continue;
    out.push({ level, indices: writer.add("u32", indices) });
    last = indices.length;
  }
  return out.length ? out : undefined;
}

/**
 * The mesh with one vertex per distinct position (and hem value): compact positions, triangles
 * over them, and per welded vertex the render vertex it stands for. (Unused duplicates must not
 * stay in the buffer: the simplifier would take them for seams and lock them.)
 */
function weldMesh(indices: Uint32Array, pos: Float32Array, clip?: ArrayLike<number>): { indices: Uint32Array; pos: Float32Array; clip?: Float32Array; vertex: Uint32Array } {
  const first = new Map<string, number>();
  const vertex: number[] = [];
  const rep = new Int32Array(pos.length / 3).fill(-1);
  const at = (i: number) => {
    if (rep[i] >= 0) return rep[i];
    const key = `${Math.round(pos[i * 3] * 1e5)},${Math.round(pos[i * 3 + 1] * 1e5)},${Math.round(pos[i * 3 + 2] * 1e5)},${clip ? Math.round(clip[i] * 1e3) : 0}`;
    let r = first.get(key);
    if (r === undefined) {
      first.set(key, (r = vertex.length));
      vertex.push(i);
    }
    return (rep[i] = r);
  };
  const out: number[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const a = at(indices[t]), b = at(indices[t + 1]), c = at(indices[t + 2]);
    if (a !== b && b !== c && a !== c) out.push(a, b, c);
  }
  const p = new Float32Array(vertex.length * 3);
  vertex.forEach((v, k) => p.set(pos.subarray(v * 3, v * 3 + 3), k * 3));
  return { indices: Uint32Array.from(out), pos: p, clip: clip ? Float32Array.from(vertex, (v) => clip[v]) : undefined, vertex: Uint32Array.from(vertex) };
}

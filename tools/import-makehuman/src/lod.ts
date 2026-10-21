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

/** How far each level reduces a kind of mesh: [level, share of triangles kept, max error relative to the mesh size]. */
export type LodSteps = [level: number, ratio: number, error: number][];

export const GARMENT_LODS: LodSteps = [[1, 0.5, 0.01], [2, 0.2, 0.04]];
export const HAIR_LODS: LodSteps = [[1, 0.5, 0.02], [2, 0.25, 0.06]];
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
  for (const [level, ratio, error] of steps) {
    const target = Math.max(3, Math.floor((source.length * ratio) / 3) * 3);
    const [indices] = clip
      ? MeshoptSimplifier.simplifyWithAttributes(source, pos, 3, Float32Array.from(clip), 1, [1], null, target, error)
      : MeshoptSimplifier.simplify(source, pos, 3, target, error);
    // Only worth storing when it saves a good share over the previous level.
    if (indices.length > last * 0.85 || !indices.length) continue;
    out.push({ level, indices: writer.add("u32", indices) });
    last = indices.length;
  }
  return out.length ? out : undefined;
}

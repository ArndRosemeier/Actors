/**
 * What a new shape needs besides itself: generated parts (beard, horns, tail ...) and face deltas
 * (an expression, the blink). Built in the worker together with the shape when the main thread
 * asks for them ahead (`Human.extras`), so dressing a character does not build them on the main
 * thread; a beard alone took tens of milliseconds there.
 */
import type { ActorRuntime, ActorShape, PartMesh, ShapeTask, SurfaceDelta } from "@actors/core";
import { type PartsConfig, buildParts, hasParts, partsBody } from "./parts";

/** The ear and lip targets parts are fitted to (resolved on the main thread, by pack target name). */
export interface PartTargets {
  l?: string;
  r?: string;
  lip?: string;
}

/** Parts for a shape (see `Human.parts`), on whichever thread holds `runtime`. */
export async function partsFor(runtime: ActorRuntime, shape: ActorShape, cfg: PartsConfig, names: PartTargets): Promise<PartMesh[]> {
  if (!hasParts(cfg)) return [];
  const wanted = Object.values(names).filter((n): n is string => !!n);
  await runtime.ensureTargets(wanted);
  const mask = (n?: string) => (n ? runtime.targetMask(n) : null);
  const ears = names.l && names.r ? ([mask(names.l)!, mask(names.r)!] as [Float32Array, Float32Array]) : null;
  const body = partsBody(shape, runtime.meshes, ears, mask(names.lip));
  return body ? buildParts(body, cfg) : [];
}

/** Name of the worker shape task that builds parts and face deltas with the shape (see `serveRuntime`). */
export const EXTRAS_TASK = "human-extras";

export interface ExtrasArgs {
  parts: { cfg: PartsConfig; names: PartTargets } | null;
  /** Face deltas by key, each as pack target weights. */
  faces: [string, [string, number][]][];
}

export interface Extras {
  parts: PartMesh[] | null;
  faces: [string, SurfaceDelta][];
}

/** Worker shape task: the parts and face deltas in `ExtrasArgs`, their buffers transferred. */
export const extrasTask: ShapeTask = async (runtime, shape, args) => {
  const a = args as ExtrasArgs;
  const parts = a.parts ? await partsFor(runtime, shape, a.parts.cfg, a.parts.names) : null;
  const faces: [string, SurfaceDelta][] = [];
  for (const [key, weights] of a.faces) {
    const w = new Map(weights);
    await runtime.ensureTargets(w.keys());
    faces.push([key, runtime.surfaceDelta(shape, w)]);
  }
  const transfer: ArrayBuffer[] = [];
  for (const p of parts ?? []) for (const x of [p.positions, p.normals, p.uvs, p.shade, p.joints, p.weights, p.indices, p.anchors]) if (x) transfer.push(x.buffer as ArrayBuffer);
  for (const [, d] of faces) {
    transfer.push(d.positions.buffer as ArrayBuffer, d.normals.buffer as ArrayBuffer);
    for (const m of d.meshes.values()) transfer.push(m.positions.buffer as ArrayBuffer, m.normals.buffer as ArrayBuffer);
  }
  return { result: { parts, faces } satisfies Extras, transfer: [...new Set(transfer)] };
};

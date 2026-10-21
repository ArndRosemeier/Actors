/**
 * Detail levels (LOD). Every level draws from the same `ActorShape`, so
 * morphs, garment fitting and the skeleton carry over; a level only picks
 * which meshes are drawn, with which (reduced) triangles and which bones.
 * See `LodDef` and `MeshDef.lods` / `lodOf` / `simplified` in format.ts.
 */
import type { ActorPackManifest, LodDef, MeshDef, SkeletonDef } from "./format";
import type { ActorShape, MeshData } from "./runtime";

/** The pack's detail levels (a single full-detail level when it defines none). */
export function lodLevels(manifest: ActorPackManifest): LodDef[] {
  return manifest.lods?.length ? manifest.lods : [{ name: "Full", distance: 0 }];
}

/** Whether a mesh is drawn at a detail level. */
export function drawnAt(def: MeshDef, level: number): boolean {
  return !def.lods || def.lods.includes(level);
}

/** The level to use at a camera distance (meters): the last level whose `distance` is reached. */
export function lodForDistance(lods: LodDef[], distance: number, bias = 1): number {
  let level = 0;
  lods.forEach((l, i) => {
    if (distance >= l.distance * bias) level = i;
  });
  return level;
}

/** The triangle list of a mesh at a detail level (its closest simplified list at or below the level). */
export function lodIndices(mesh: MeshData, level: number): Uint32Array {
  let best = mesh.indices;
  let at = 0;
  for (const [l, indices] of mesh.simplified ?? []) {
    if (l <= level && l > at) {
      best = indices;
      at = l;
    }
  }
  return best;
}

/**
 * Per bone: the bone that drives it at a level (itself if kept, otherwise its
 * closest kept ancestor). Null when the level keeps every bone.
 */
export function lodBoneMap(skeleton: SkeletonDef, lod: LodDef | undefined): Uint16Array | null {
  if (!lod?.bones) return null;
  const keep = new Set(lod.bones);
  const map = new Uint16Array(skeleton.bones.length);
  skeleton.bones.forEach((b, i) => {
    map[i] = keep.has(b.name) || b.parent < 0 ? i : map[b.parent];
  });
  return map;
}

/** Moves skin influences to other bones (see lodBoneMap): merges duplicates, keeps the top 4, renormalizes. */
export function remapSkin(joints: Uint16Array, weights: Float32Array, boneMap: Uint16Array): { joints: Uint16Array; weights: Float32Array } {
  const n = joints.length / 4;
  const outJ = new Uint16Array(joints.length);
  const outW = new Float32Array(weights.length);
  const acc = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    acc.clear();
    for (let k = 0; k < 4; k++) {
      const w = weights[i * 4 + k];
      if (w > 0) {
        const j = boneMap[joints[i * 4 + k]] ?? joints[i * 4 + k];
        acc.set(j, (acc.get(j) ?? 0) + w);
      }
    }
    const top = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top.reduce((s, [, w]) => s + w, 0) || 1;
    top.forEach(([j, w], k) => {
      outJ[i * 4 + k] = j;
      outW[i * 4 + k] = w / sum;
    });
  }
  return { joints: outJ, weights: outW };
}

/** A mesh cut down to the render vertices a triangle list uses. `vertices[i]` is the original render vertex of vertex i. */
export interface CompactMesh extends MeshData {
  vertices: Uint32Array;
}

/**
 * Standalone data for one mesh at a reduced triangle list: only the render
 * vertices the triangles use, skin moved to the level's bones. Positions still
 * come from the same shape (`map` keeps pointing at source vertices).
 */
export function compactMesh(mesh: MeshData, indices: Uint32Array, boneMap?: Uint16Array | null): CompactMesh {
  const remap = new Int32Array(mesh.map.length).fill(-1);
  const vertices: number[] = [];
  const out = new Uint32Array(indices.length);
  for (let t = 0; t < indices.length; t++) {
    const v = indices[t];
    if (remap[v] < 0) {
      remap[v] = vertices.length;
      vertices.push(v);
    }
    out[t] = remap[v];
  }
  const vs = Uint32Array.from(vertices);
  const pick = <T extends Float32Array | Uint32Array | Uint16Array>(src: T, size: number): T => {
    const dst = new (src.constructor as new (n: number) => T)(vs.length * size);
    for (let i = 0; i < vs.length; i++) for (let k = 0; k < size; k++) dst[i * size + k] = src[vs[i] * size + k];
    return dst;
  };
  let joints = mesh.joints ? pick(mesh.joints, 4) : undefined;
  let weights = mesh.weights ? pick(mesh.weights, 4) : undefined;
  if (joints && weights && boneMap) ({ joints, weights } = remapSkin(joints, weights, boneMap));
  return {
    ...mesh,
    map: pick(mesh.map, 1),
    uv: pick(mesh.uv, 2),
    indices: out,
    joints,
    weights,
    clip: mesh.clip ? pick(mesh.clip, 1) : undefined,
    simplified: undefined,
    vertices: vs,
  };
}

/** Positions and normals a mesh reads from a shape (its source space: base, proxy or own stencil vertices). */
export function shapeSource(shape: ActorShape, data: MeshData): { positions: Float32Array; normals: Float32Array } {
  if (data.stencil) return shape.meshes.get(data.def.name)!;
  return data.def.source.kind === "base" ? shape : shape.proxies.get(data.def.source.proxy)!;
}

/** Several meshes merged into one (e.g. a crowd actor's body and garments: one draw call). */
export interface MergedMesh {
  parts: { data: CompactMesh; offset: number; count: number }[];
  vertexCount: number;
  uv: Float32Array;
  indices: Uint32Array;
  joints?: Uint16Array;
  weights?: Float32Array;
  /** Per vertex: index into `parts`. */
  part: Uint16Array;
  /** Per vertex hem cut (see MeshDef.clip; 1 for parts without one), when any part has one. */
  clip?: Float32Array;
}

/**
 * Merges meshes, each with its own triangle list (default: its full list),
 * into one vertex and index buffer. Skins are moved to `boneMap`'s bones.
 * Fill positions with `fillMerged` whenever the shape changes.
 */
export function mergeMeshes(list: { data: MeshData; indices?: Uint32Array }[], boneMap?: Uint16Array | null): MergedMesh {
  const parts = list.map(({ data, indices }) => compactMesh(data, indices ?? data.indices, boneMap));
  const vertexCount = parts.reduce((s, p) => s + p.map.length, 0);
  const indexCount = parts.reduce((s, p) => s + p.indices.length, 0);
  const skinned = parts.every((p) => p.joints && p.weights);
  const merged: MergedMesh = {
    parts: [],
    vertexCount,
    uv: new Float32Array(vertexCount * 2),
    indices: new Uint32Array(indexCount),
    joints: skinned ? new Uint16Array(vertexCount * 4) : undefined,
    weights: skinned ? new Float32Array(vertexCount * 4) : undefined,
    part: new Uint16Array(vertexCount),
    clip: parts.some((p) => p.clip) ? new Float32Array(vertexCount).fill(1) : undefined,
  };
  let offset = 0;
  let at = 0;
  parts.forEach((p, k) => {
    const count = p.map.length;
    merged.parts.push({ data: p, offset, count });
    merged.uv.set(p.uv, offset * 2);
    if (skinned) {
      merged.joints!.set(p.joints!, offset * 4);
      merged.weights!.set(p.weights!, offset * 4);
    }
    merged.part.fill(k, offset, offset + count);
    if (p.clip) merged.clip!.set(p.clip, offset);
    for (let i = 0; i < p.indices.length; i++) merged.indices[at++] = p.indices[i] + offset;
    offset += count;
  });
  return merged;
}

/** Writes a shape's positions and normals into a merged mesh's vertex buffers (garments pushed out by their `inflate`). */
export function fillMerged(merged: MergedMesh, shape: ActorShape, positions: Float32Array, normals: Float32Array): void {
  for (const { data, offset } of merged.parts) {
    const src = shapeSource(shape, data);
    const inflate = data.def.inflate ?? 0;
    const map = data.map;
    for (let i = 0; i < map.length; i++) {
      const s = map[i] * 3, d = (offset + i) * 3;
      const nx = src.normals[s], ny = src.normals[s + 1], nz = src.normals[s + 2];
      positions[d] = src.positions[s] + nx * inflate;
      positions[d + 1] = src.positions[s + 1] + ny * inflate;
      positions[d + 2] = src.positions[s + 2] + nz * inflate;
      normals[d] = nx;
      normals[d + 1] = ny;
      normals[d + 2] = nz;
    }
  }
}

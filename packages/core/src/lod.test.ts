import { describe, expect, it } from "vitest";
import type { MeshDef, SkeletonDef } from "./format";
import { compactMesh, drawnAt, fillMerged, lodBoneMap, lodForDistance, lodIndices, mergeMeshes, remapSkin } from "./lod";
import type { ActorShape, MeshData } from "./runtime";

const def = (over: Partial<MeshDef> = {}): MeshDef => ({ name: "m", source: { kind: "base" }, role: "body", material: { kind: "skin" }, ...over });

describe("detail levels", () => {
  it("draws meshes at their listed levels (all levels by default)", () => {
    expect(drawnAt(def(), 2)).toBe(true);
    expect(drawnAt(def({ lods: [0, 1] }), 1)).toBe(true);
    expect(drawnAt(def({ lods: [0, 1] }), 2)).toBe(false);
  });

  it("picks the level by distance", () => {
    const lods = [{ name: "a", distance: 0 }, { name: "b", distance: 8 }, { name: "c", distance: 25 }];
    expect(lodForDistance(lods, 3)).toBe(0);
    expect(lodForDistance(lods, 10)).toBe(1);
    expect(lodForDistance(lods, 30)).toBe(2);
    expect(lodForDistance(lods, 10, 2)).toBe(0);
  });

  it("uses the closest simplified triangle list at or below the level", () => {
    const full = new Uint32Array([0, 1, 2, 0, 2, 3]);
    const one = new Uint32Array([0, 1, 2]);
    const mesh = { def: def(), map: new Uint32Array(4), uv: new Float32Array(8), indices: full, simplified: new Map([[1, one]]) } as MeshData;
    expect(lodIndices(mesh, 0)).toBe(full);
    expect(lodIndices(mesh, 1)).toBe(one);
    expect(lodIndices(mesh, 2)).toBe(one);
  });
});

describe("crowd skeleton", () => {
  const skeleton: SkeletonDef = {
    name: "s",
    bones: ["root", "hand", "finger1", "finger2"].map((name, i) => ({ name, parent: i - 1, head: { vertices: [] }, tail: { vertices: [] }, roll: 0 })),
  };

  it("hands dropped bones to their closest kept ancestor", () => {
    expect([...lodBoneMap(skeleton, { name: "c", distance: 0, bones: ["root", "hand"] })!]).toEqual([0, 1, 1, 1]);
    expect(lodBoneMap(skeleton, { name: "c", distance: 0 })).toBeNull();
  });

  it("merges influences that land on the same bone", () => {
    const { joints, weights } = remapSkin(new Uint16Array([2, 3, 0, 0]), new Float32Array([0.5, 0.3, 0.2, 0]), new Uint16Array([0, 1, 1, 1]));
    expect(joints[0]).toBe(1);
    expect(weights[0]).toBeCloseTo(0.8, 5);
    expect(joints[1]).toBe(0);
    expect(weights[1]).toBeCloseTo(0.2, 5);
    expect(weights[2]).toBe(0);
  });
});

describe("merged meshes", () => {
  // A quad (4 render vertices over base vertices 0..3) and a one-triangle garment on a proxy.
  const body: MeshData = {
    def: def({ name: "body" }),
    map: new Uint32Array([0, 1, 2, 3]),
    uv: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    joints: new Uint16Array([0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0]),
    weights: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
  };
  const cape: MeshData = {
    def: def({ name: "cape", role: "garment", source: { kind: "proxy", proxy: "cape" }, inflate: 0.5 }),
    map: new Uint32Array([0, 1, 2]),
    uv: new Float32Array(6),
    indices: new Uint32Array([0, 1, 2]),
    joints: new Uint16Array(12),
    weights: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
  };

  it("keeps only the vertices a reduced triangle list uses", () => {
    const c = compactMesh(body, new Uint32Array([0, 2, 3]));
    expect([...c.vertices]).toEqual([0, 2, 3]);
    expect([...c.map]).toEqual([0, 2, 3]);
    expect([...c.indices]).toEqual([0, 1, 2]);
    expect([...c.uv]).toEqual([0, 0, 1, 1, 0, 1]);
    expect([...c.joints!].filter((_, i) => i % 4 === 0)).toEqual([0, 2, 3]);
  });

  it("merges meshes from different sources and fills them from one shape", () => {
    const merged = mergeMeshes([{ data: body, indices: new Uint32Array([0, 1, 2]) }, { data: cape }], new Uint16Array([0, 1, 1, 1]));
    expect(merged.vertexCount).toBe(6);
    expect([...merged.indices]).toEqual([0, 1, 2, 3, 4, 5]);
    expect([...merged.part]).toEqual([0, 0, 0, 1, 1, 1]);
    expect(merged.joints![8]).toBe(1); // body vertex 2 (bone 2) now follows bone 1
    const up = (n: number) => new Float32Array(n * 3).map((_, i) => (i % 3 === 1 ? 1 : 0));
    const shape: ActorShape = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
      normals: up(4),
      proxies: new Map([["cape", { positions: new Float32Array([5, 0, 0, 6, 0, 0, 5, 1, 0]), normals: up(3) }]]),
      meshes: new Map(),
    };
    const pos = new Float32Array(18), nor = new Float32Array(18);
    fillMerged(merged, shape, pos, nor);
    expect([...pos.slice(6, 9)]).toEqual([1, 1, 0]);
    // Garment vertices are pushed out along the normal by `inflate`.
    expect([...pos.slice(9, 12)]).toEqual([5, 0.5, 0]);
    expect(nor[10]).toBe(1);
  });
});

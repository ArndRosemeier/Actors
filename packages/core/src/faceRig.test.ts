import { describe, expect, it } from "vitest";
import { type ActorRuntime, type ActorShape, applyStencil } from "./runtime";
import { computeNormals } from "./normals";
import { BASE_SPACE, FACE_RIG_WIDTH, buildFaceRig, fromHalf, toHalf } from "./faceRig";

describe("half floats", () => {
  it("round-trip millimetre deltas and normals closely", () => {
    // Half floats keep about 11 bits: a 2 mm delta to within a micrometre.
    for (const v of [0, 1, -1, 0.5, 0.0123, -0.00042, 3.5e-5, 0.9999, 65504]) expect(Math.abs(fromHalf(toHalf(v)) - v)).toBeLessThanOrEqual(Math.abs(v) / 2048 + 1e-8);
    expect(fromHalf(toHalf(1e-9))).toBe(0);
    expect(fromHalf(toHalf(1e6))).toBe(Infinity);
  });
});

describe("face rig", () => {
  // A 3x3 grid of base vertices (8 triangles), a stencil mesh "body-hi" with one row per base vertex
  // plus a midpoint row, and a garment stencil that must be left out.
  const grid = new Float32Array(27);
  for (let i = 0; i < 9; i++) grid.set([i % 3, Math.floor(i / 3), 0], i * 3);
  const quads = [0, 1, 4, 3, 1, 2, 5, 4, 3, 4, 7, 6, 4, 5, 8, 7];
  const tris: number[] = [];
  for (let q = 0; q < quads.length; q += 4) tris.push(quads[q], quads[q + 1], quads[q + 2], quads[q], quads[q + 2], quads[q + 3]);
  const iota = (n: number) => Uint32Array.from({ length: n }, (_, i) => i);
  const rowPtr: number[] = [0], cols: number[] = [], weights: number[] = [];
  for (let i = 0; i < 9; i++) (cols.push(i), weights.push(1), rowPtr.push(cols.length));
  cols.push(4, 5), weights.push(0.5, 0.5), rowPtr.push(cols.length); // row 9: between 4 and 5
  const stencil = { rows: 10, rowPtr: Uint32Array.from(rowPtr), cols: Uint32Array.from(cols), weights: Float32Array.from(weights) };
  const hiTris = [...tris, 4, 9, 8];
  const mesh = (name: string, extra: object) => ({ def: { name, source: { kind: "base" }, role: "body" }, uv: new Float32Array(0), ...extra });
  const meshes = [
    mesh("base", { map: iota(9), indices: Uint32Array.from(tris) }),
    mesh("body-hi", { map: iota(10), indices: Uint32Array.from(hiTris), stencil }),
    mesh("skirt", { map: iota(10), indices: Uint32Array.from(hiTris), stencil }),
  ];
  const targets = new Map([
    ["ta", { indices: Uint32Array.from([4]), deltas: Int16Array.from([0, 0, 100]), scale: 0.0001, count: 1 }],
    ["tb", { indices: Uint32Array.from([0, 8]), deltas: Int16Array.from([50, 0, 0, 0, 0, -30]), scale: 0.0001, count: 2 }],
  ]);
  // A face proxy ("teeth": two vertices, each bound to three grid vertices) and a hair proxy that doesn't follow the face.
  const binding = (n: number) => ({ def: { name: "p", vertexCount: n }, refs: Uint32Array.from([4, 5, 1, 7, 8, 5].slice(0, n * 3)), weights: Float32Array.from([0.5, 0.25, 0.25, 0.6, 0.2, 0.2].slice(0, n * 3)), offsets: new Float32Array(n * 3) });
  const proxies = new Map([["teeth", binding(2)], ["hair", binding(2)]]);
  meshes.push(mesh("teeth", { def: { name: "teeth", source: { kind: "proxy", proxy: "teeth" }, role: "bodypart" }, map: iota(2), indices: Uint32Array.from([0, 1, 1]) }));
  meshes.push(mesh("hair", { def: { name: "hair", source: { kind: "proxy", proxy: "hair" }, role: "hair" }, map: iota(2), indices: Uint32Array.from([0, 1, 1]) }));
  const runtime = { meshes, targets, proxies } as unknown as ActorRuntime;
  const hi = applyStencil(stencil, grid);
  const lists = (name: string) => meshes.filter((m) => m.def.name === name) as unknown as { indices: Uint32Array; map: Uint32Array }[];
  const shape = {
    positions: grid,
    normals: computeNormals(grid, 9, lists("base")),
    proxies: new Map([["teeth", { positions: new Float32Array(6), normals: new Float32Array(6) }], ["hair", { positions: new Float32Array(6), normals: new Float32Array(6) }]]),
    meshes: new Map([["body-hi", { positions: hi, normals: computeNormals(hi, 10, lists("body-hi")) }], ["skirt", { positions: hi, normals: computeNormals(hi, 10, lists("skirt")) }]]),
  } as unknown as ActorShape;
  const units: [string, Map<string, number>][] = [["a", new Map([["ta", 1]])], ["b", new Map([["tb", 0.5]])]];

  /** Brute force: the whole surface with the unit applied, minus the shape. */
  const expected = (unit: number, space: string) => {
    const p = Float32Array.from(grid);
    for (const [name, w] of units[unit][1]) {
      const t = targets.get(name)!;
      for (let i = 0; i < t.count; i++) for (let c = 0; c < 3; c++) p[t.indices[i] * 3 + c] += t.deltas[i * 3 + c] * t.scale * w;
    }
    const pos = space === BASE_SPACE ? p : applyStencil(stencil, p);
    const nrm = computeNormals(pos, pos.length / 3, lists(space === BASE_SPACE ? "base" : space));
    const ref = space === BASE_SPACE ? shape : shape.meshes.get(space)!;
    return { dp: pos.map((x, i) => x - ref.positions[i]), dn: nrm.map((x, i) => x - ref.normals[i]) };
  };

  it("matches the full surface deltas, stored only for moved vertices", () => {
    const rig = buildFaceRig(runtime, shape, units, ["body-hi"]);
    expect(rig.units).toEqual(["a", "b"]);
    expect([...rig.slots.keys()]).toEqual([BASE_SPACE, "body-hi"]);
    expect(rig.width).toBe(FACE_RIG_WIDTH);
    for (const space of [BASE_SPACE, "body-hi"]) {
      const slots = rig.slots.get(space)!;
      for (let k = 0; k < 2; k++) {
        const { dp, dn } = expected(k, space);
        for (let v = 0; v < slots.length; v++) {
          const t = ((slots[v] - 1) * 2 + k) * 8;
          const got = slots[v] ? [0, 1, 2, 4, 5, 6].map((c) => fromHalf(rig.data[t + c])) : [0, 0, 0, 0, 0, 0];
          const want = [dp[v * 3], dp[v * 3 + 1], dp[v * 3 + 2], dn[v * 3], dn[v * 3 + 1], dn[v * 3 + 2]];
          for (let c = 0; c < 6; c++) expect(Math.abs(got[c] - want[c])).toBeLessThan(c < 3 ? 1e-5 : 1e-3);
        }
      }
    }
    // The midpoint row moves with vertex 4 (half of it).
    expect(rig.slots.get("body-hi")![9]).toBeGreaterThan(0);
  });

  it("moves face proxies with the base vertices they are bound to", () => {
    const rig = buildFaceRig(runtime, shape, units, null);
    expect(rig.slots.has("proxy:teeth")).toBe(true);
    expect(rig.slots.has("proxy:hair")).toBe(false); // hair doesn't follow the face
    const s = rig.slots.get("proxy:teeth")!;
    // Unit "a" lifts base vertex 4 by 1 cm: teeth vertex 0 (half bound to it) by 5 mm; vertex 1 is bound to 7, 8, 5.
    const z = (v: number, k: number) => fromHalf(rig.data[((s[v] - 1) * 2 + k) * 8 + 2]);
    expect(z(0, 0)).toBeCloseTo(0.005, 5);
    // Unit "b" moves vertex 8 by -1.5 mm (half weight): teeth vertex 1 by 0.2 of that.
    expect(z(1, 1)).toBeCloseTo(-0.0003, 5);
  });

  it("gives no slots to vertices nothing moves", () => {
    const rig = buildFaceRig(runtime, shape, [["a", new Map([["ta", 1]])]], []);
    const slots = rig.slots.get(BASE_SPACE)!;
    // Vertex 4 moves and the normals around it turn; corners 2 and 6 share no triangle with it.
    expect(slots.filter((s) => s).length).toBe(7);
    expect([slots[2], slots[6]]).toEqual([0, 0]);
    const far = buildFaceRig(runtime, shape, [["b", new Map([["tb", 1]])]], []).slots.get(BASE_SPACE)!;
    expect(far[2]).toBe(0); // vertex 2 shares no triangle with 0 or 8
    expect(far[6]).toBe(0);
  });
});

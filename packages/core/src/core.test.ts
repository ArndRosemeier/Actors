import { describe, expect, it } from "vitest";
import { applyTarget, decodeTarget, encodeTarget } from "./target";
import { boneRotationFromRoll } from "./skeleton";
import { mat3Apply, normalize } from "./math";
import { fitProxy } from "./proxy";

describe("morph targets", () => {
  it("round-trips sparse targets within quantization error", () => {
    const t = decodeTarget(encodeTarget([2, 5], [0.1, -0.2, 0.3, 0.01, 0, -0.05], 10));
    expect(t.indices).not.toBeNull();
    const pos = new Float32Array(30);
    applyTarget(pos, t, 1);
    expect(pos[6]).toBeCloseTo(0.1, 4);
    expect(pos[7]).toBeCloseTo(-0.2, 4);
    expect(pos[17]).toBeCloseTo(-0.05, 4);
    expect(pos[0]).toBe(0);
  });

  it("stores targets densely when they touch most vertices", () => {
    const idx = [0, 1, 2, 3];
    const t = decodeTarget(encodeTarget(idx, new Array(12).fill(0.5), 4));
    expect(t.indices).toBeNull();
    const pos = new Float32Array(12);
    applyTarget(pos, t, 0.5);
    expect(pos[11]).toBeCloseTo(0.25, 4);
  });
});

describe("bone rotation", () => {
  it("maps local +Y onto the bone direction for any roll", () => {
    const dir = normalize([0.3, -0.5, 0.8]);
    for (const roll of [0, 1, -2.5]) {
      const y = mat3Apply(boneRotationFromRoll(dir, roll), [0, 1, 0]);
      y.forEach((v, i) => expect(v).toBeCloseTo(dir[i], 6));
    }
  });
});

describe("proxy fitting", () => {
  it("places proxy vertices from barycentric weights plus scaled offsets", () => {
    const positions = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2]);
    const def = {
      name: "p",
      vertexCount: 1,
      refs: { offset: 0, count: 3, type: "u32" as const },
      weights: { offset: 0, count: 3, type: "f32" as const },
      offsets: { offset: 0, count: 3, type: "f32" as const },
      // rest lengths 1 -> current distance 2 => offsets doubled
      scaleRefs: [[0, 1, 1], [0, 2, 1], [0, 3, 1]] as [[number, number, number], [number, number, number], [number, number, number]],
    };
    const out = fitProxy(
      { def, refs: new Uint32Array([0, 1, 2]), weights: new Float32Array([0.5, 0.5, 0]), offsets: new Float32Array([0, 0, 0.1]) },
      positions,
    );
    expect([...out].map((v) => +v.toFixed(5))).toEqual([1, 0, 0.2]);
  });
});

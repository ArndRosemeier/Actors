import { describe, expect, it } from "vitest";
import { catmullClark } from "./subdivide";

describe("catmull-clark stencil", () => {
  it("keeps every stencil row an affine combination (weights sum to 1)", () => {
    // A cube: 8 vertices, 6 quads, closed.
    const f = (a: number, b: number, c: number, d: number) => ({ v: [a, b, c, d], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] as [number, number][] });
    const s = catmullClark([f(0, 1, 2, 3), f(4, 7, 6, 5), f(0, 4, 5, 1), f(1, 5, 6, 2), f(2, 6, 7, 3), f(3, 7, 4, 0)]);
    expect(s.vertexCount).toBe(8 + 12 + 6);
    expect(s.quads.length).toBe(24);
    for (let r = 0; r < s.vertexCount; r++) {
      let sum = 0;
      for (let i = s.rowPtr[r]; i < s.rowPtr[r + 1]; i++) sum += s.weights[i];
      expect(sum).toBeCloseTo(1, 6);
    }
  });
});

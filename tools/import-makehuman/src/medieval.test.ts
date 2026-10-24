import { describe, expect, it } from "vitest";
import { Envelope, MEDIEVAL } from "./medieval";

describe("medieval garments", () => {
  it("have unique file-safe names, a category and body layers", () => {
    const names = MEDIEVAL.map((g) => g.name);
    expect(new Set(names).size).toBe(names.length);
    for (const g of MEDIEVAL) {
      expect(g.name).toMatch(/^med-[a-z0-9-]+$/);
      expect(g.occupies.length).toBeGreaterThan(0);
      expect(g.category.startsWith("Medieval")).toBe(true);
    }
  });

  it("builds a convex envelope around a slice", () => {
    // A square column of points, 0.2 m wide, with a dent on the front that the envelope bridges.
    const pts: number[] = [];
    for (let y = 0; y <= 0.2; y += 0.01)
      for (const [x, z] of [[-0.1, -0.1], [0.1, -0.1], [0.1, 0.1], [-0.1, 0.1], [0, 0.02]]) pts.push(x, y, z);
    const env = new Envelope(pts, Array.from({ length: pts.length / 3 }, (_, i) => i), [0, 0], 0, 0.2, { dilate: 0, blur: 0 });
    expect(env.radius(0, 0.1)).toBeCloseTo(0.1, 3); // front, across the dent
    expect(env.radius(Math.PI / 4, 0.1)).toBeCloseTo(Math.SQRT2 * 0.1, 3); // corner
    const push = env.pushOut({ x: 0, y: 0.1, z: 0.02 }, 0.01);
    expect(push[2]).toBeCloseTo(0.09, 3);
    expect(env.pushOut({ x: 0, y: 0.1, z: 0.3 }, 0.01)).toEqual([0, 0, 0]);
  });
});

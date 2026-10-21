import { describe, expect, it } from "vitest";
import { project, surfaceNets } from "./mesher";
import { capsule, ellipsoid, frameFrom, smin } from "./sdf";

describe("surface nets", () => {
  it("meshes a sphere with outward-facing, closed quads", () => {
    const r = 0.1;
    const f = (p: [number, number, number]) => Math.hypot(...p) - r;
    const nets = surfaceNets(f, [-0.15, -0.15, -0.15], [0.15, 0.15, 0.15], 0.01);
    const P = nets.positions;
    project(f, P);
    for (let i = 0; i < P.length; i += 3) expect(Math.abs(Math.hypot(P[i], P[i + 1], P[i + 2]) - r)).toBeLessThan(1e-4);
    // Every edge is shared by exactly two quads (closed surface).
    const edges = new Map<string, number>();
    for (let q = 0; q < nets.quads.length; q += 4)
      for (let k = 0; k < 4; k++) {
        const a = nets.quads[q + k], b = nets.quads[q + ((k + 1) % 4)];
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    expect([...edges.values()].every((c) => c === 2)).toBe(true);
    // Consistent winding: the signed volume of the triangulated quads is the sphere's (either sign).
    let vol = 0;
    const v = (i: number) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
    for (let q = 0; q < nets.quads.length; q += 4) {
      const [a, b, c, d] = [0, 1, 2, 3].map((k) => v(nets.quads[q + k]));
      for (const [x, y, z] of [[a, b, c], [a, c, d]]) vol += (x[0] * (y[1] * z[2] - y[2] * z[1]) - x[1] * (y[0] * z[2] - y[2] * z[0]) + x[2] * (y[0] * z[1] - y[1] * z[0])) / 6;
    }
    expect(Math.abs(vol)).toBeCloseTo((4 / 3) * Math.PI * r ** 3, 3);
  });
});

describe("primitives", () => {
  it("measure distances to ellipsoids and capsules", () => {
    const e = ellipsoid("e", [0, 0, 0], frameFrom([0, 0, 1]), [0.1, 0.2, 0.3]);
    expect(e.distance([0, 0, 0.3])).toBeCloseTo(0, 5);
    expect(e.distance([0, 0, 0])).toBeLessThan(0);
    const c = capsule("c", [0, 0, 0], [0, 1, 0], 0.1, 0.1);
    expect(c.distance([0.1, 0.5, 0])).toBeCloseTo(0, 5);
    expect(c.distance([0.3, 0.5, 0])).toBeCloseTo(0.2, 5);
  });

  it("smooth union never exceeds the plain union", () => {
    for (const [a, b] of [[0.1, 0.12], [0.3, -0.1], [0, 0]]) {
      expect(smin(a, b, 0.05)).toBeLessThanOrEqual(Math.min(a, b));
      expect(smin(a, b, 0.05)).toBeGreaterThanOrEqual(Math.min(a, b) - 0.05);
    }
  });
});

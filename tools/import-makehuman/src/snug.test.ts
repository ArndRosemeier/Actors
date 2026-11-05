import { describe, expect, it } from "vitest";
import { snugMoves } from "./snug";

// Skin: a flat floor-facing quad at y = 0 (normal +y), 20 cm square.
const skin = [-0.1, 0, -0.1, 0.1, 0, -0.1, 0.1, 0, 0.1, -0.1, 0, 0.1];
const skinTris: [number, number, number][] = [[0, 2, 1], [0, 3, 2]];

describe("snugMoves", () => {
  it("halves the gap beyond the clearance, leaves close and far-below vertices, keeps far ones' shape", () => {
    // Vertices: 2 cm above, 3 mm above, 2 cm below (a sole), 10 cm above (past reach), a rim 3 cm out beside the skin.
    const garment = [0, 0.02, 0, 0.05, 0.003, 0, 0, -0.02, 0, -0.05, 0.1, 0, 0.13, 0.005, 0];
    const m = snugMoves(garment, [], skin, skinTris, { keep: 0.5, clearance: 0.004, reach: 0.04, smooth: 0 });
    expect(m[1]).toBeCloseTo(-0.008, 5); // gap 20 mm -> 4 + 16 / 2 = 12 mm
    expect(m[4]).toBeCloseTo(0, 9);
    expect(m[7]).toBeCloseTo(0, 9);
    expect(m[10]).toBeCloseTo(-0.018, 5); // moves as far as a 40 mm gap does
    // The rim moves in sideways, towards the skin's edge.
    expect(m[12]).toBeLessThan(-0.005);
    expect(Math.abs(m[13])).toBeLessThan(Math.abs(m[12]));
  });

  it("leaves a garment's open edges where they are", () => {
    // A strip of two quads 2 cm above the skin: every vertex is on its rim.
    const garment = [-0.05, 0.02, 0, 0, 0.02, 0, 0.05, 0.02, 0, -0.05, 0.02, 0.03, 0, 0.02, 0.03, 0.05, 0.02, 0.03];
    const m = snugMoves(garment, [[0, 1, 4, 3], [1, 2, 5, 4]], skin, skinTris, { keep: 0.5 });
    expect(Math.max(...m.map(Math.abs))).toBe(0);  });

  it("does not let smoothing push a vertex into the skin", () => {
    const garment = [0, 0.03, 0, 0.01, 0.002, 0, 0.02, 0.03, 0];
    const m = snugMoves(garment, [[0, 1, 2]], skin, skinTris, { keep: 0.5, clearance: 0.004, smooth: 3, edge: 0 });
    expect(0.002 + m[4]).toBeGreaterThanOrEqual(0.002 - 1e-9);
    expect(0.03 + m[1]).toBeGreaterThan(0.004);
  });
});

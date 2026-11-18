import { describe, expect, it } from "vitest";
import { type Shell, nestMoves } from "./nest";

/** A flat square of side `s` at height `y`, facing up. */
const square = (y: number, s = 0.2): { pos: number[]; tris: [number, number, number][] } => ({
  pos: [-s, y, -s, s, y, -s, s, y, s, -s, y, s],
  tris: [[0, 2, 1], [0, 3, 2]],
});

describe("nestMoves", () => {
  const inner: Shell = { ...square(0), inflate: 0.005 };

  it("lifts a surface that lies under or inside the one beneath until it stands clear", () => {
    const outer = square(-0.01);
    const moves = nestMoves(outer.pos, outer.tris, 0.01, [inner], { margin: 0.004, smooth: 0 });
    // Height over the inner surface: -0.01 + 0.01 (inflate) - 0.005 = -0.005; it needs 0.009 more.
    for (let v = 0; v < 4; v++) expect(moves[v * 3 + 1]).toBeCloseTo(0.009, 5);
  });

  it("leaves a surface that already stands clear, and one beside the inner one, alone", () => {
    const clear = square(0.02);
    expect(Array.from(nestMoves(clear.pos, clear.tris, 0.01, [inner])).every((m) => m === 0)).toBe(true);
    const beside = { pos: clear.pos.map((p, i) => (i % 3 === 0 ? p + 1 : p)), tris: clear.tris };
    expect(Array.from(nestMoves(beside.pos, beside.tris, 0.01, [inner])).every((m) => m === 0)).toBe(true);
  });
});

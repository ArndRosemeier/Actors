import { describe, expect, it } from "vitest";
import { scalpVertices } from "./scalp";

/** Body vertices 0..3 (a scalp patch facing up, a forehead facing forward, a neck low down, a patch far from the hair), hair vertices 4..5. */
function scene(hair: number[][]) {
  const body = [[0, 1.7, 0], [0, 1.6, 0.1], [0, 1.45, -0.05], [0.5, 1.7, 0]];
  const normals = [[0, 1, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]];
  const positions = [...body, ...hair].flat();
  return { positions, normals: [...normals, ...hair.map(() => [0, 1, 0])].flat(), hairAt: body.length };
}

describe("scalpVertices", () => {
  it("paints the body vertices that have hair just above them, and no others", () => {
    const { positions, normals, hairAt } = scene([[0.005, 1.715, 0], [0, 1.47, -0.07]]);
    const found = scalpVertices(positions, normals, [{ offset: 0, count: 4 }], [{ offset: hairAt, count: 2 }]);
    // The neck (vertex 2) is low: below the head's depth. The forehead (1) has no hair in front of it. 3 is far away.
    expect([...found]).toEqual([0]);
  });

  it("leaves everything alone when hair is below the surface or absent", () => {
    const { positions, normals, hairAt } = scene([[0, 1.6, 0]]);
    expect(scalpVertices(positions, normals, [{ offset: 0, count: 4 }], [{ offset: hairAt, count: 1 }]).length).toBe(0);
    expect(scalpVertices(positions, normals, [{ offset: 0, count: 4 }], []).length).toBe(0);
  });
});

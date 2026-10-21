import { describe, expect, it } from "vitest";
import { BlobWriter } from "./blob";
import { humanLods, ready, simplifyLevels } from "./lod";

/** A flat n x n grid of quads, split at a UV seam down the middle (seam vertices doubled). */
function grid(n: number) {
  const positions: number[] = [];
  for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) positions.push(x / n, y / n, 0);
  const map: number[] = [];
  const key = new Map<string, number>();
  const corner = (x: number, y: number, side: number) => {
    const k = `${x},${y},${x === n / 2 ? side : 0}`;
    if (!key.has(k)) {
      key.set(k, map.length);
      map.push(y * (n + 1) + x);
    }
    return key.get(k)!;
  };
  const indices: number[] = [];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const side = x < n / 2 ? 0 : 1;
      const [a, b, c, d] = [corner(x, y, side), corner(x + 1, y, side), corner(x + 1, y + 1, side), corner(x, y + 1, side)];
      indices.push(a, b, c, a, c, d);
    }
  return { positions, map, indices };
}

describe("LOD simplification", () => {
  it("reduces a mesh per level over the same render vertices", async () => {
    await ready;
    const g = grid(16);
    const writer = new BlobWriter();
    const levels = simplifyLevels(writer, g.positions, g, [[1, 0.5, 0.05], [2, 0.1, 0.2]])!;
    expect(levels.map((l) => l.level)).toEqual([1, 2]);
    const buf = writer.toBuffer().buffer;
    const lists = levels.map((l) => new Uint32Array(buf, l.indices.offset, l.indices.count));
    expect(lists[0].length).toBeLessThanOrEqual(g.indices.length * 0.5);
    expect(lists[1].length).toBeLessThan(lists[0].length);
    for (const list of lists) for (const v of list) expect(v).toBeLessThan(g.map.length);
  });

  it("keeps fingers out of the crowd skeleton", () => {
    const [, , crowd] = humanLods(["pelvis", "hand_l", "index_01_l", "thumb_03_r"]);
    expect(crowd.bones).toEqual(["pelvis", "hand_l"]);
    expect(crowd.merge).toBe(true);
  });
});

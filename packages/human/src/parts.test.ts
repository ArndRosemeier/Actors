import { describe, expect, it } from "vitest";
import { type PartsBody, type PartsConfig, beardCoverage, beardPaint, buildParts, hasParts } from "./parts";

/** A synthetic body: a head sphere on a cylinder trunk, skinned to head / pelvis. */
function body(): PartsBody {
  const pos: number[] = [], nrm: number[] = [], tri: number[] = [], bone: number[] = [];
  const grid = (rows: number, cols: number, at: (i: number, j: number) => [number[], number[]], b: (p: number[]) => number) => {
    const base = pos.length / 3;
    for (let i = 0; i <= rows; i++)
      for (let j = 0; j <= cols; j++) {
        const [p, n] = at(i / rows, j / cols);
        pos.push(...p);
        nrm.push(...n);
        bone.push(b(p));
      }
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < cols; j++) {
        const a = base + i * (cols + 1) + j, c = a + cols + 1;
        tri.push(a, c, a + 1, a + 1, c, c + 1);
      }
  };
  const C = [0, 1.6, 0], R = 0.1;
  grid(24, 32, (u, v) => {
    const th = u * Math.PI, ph = v * Math.PI * 2;
    const n = [Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph)];
    return [n.map((x, k) => C[k] + x * R), n];
  }, () => 3);
  grid(20, 32, (u, v) => {
    const ph = v * Math.PI * 2;
    const n = [Math.sin(ph), 0, Math.cos(ph)];
    return [[n[0] * 0.15, 1.45 - u * 0.6, n[2] * 0.12], n];
  }, (p) => (p[1] < 1.1 ? 0 : 1));
  const n = pos.length / 3;
  const joints = new Uint16Array(n * 4), weights = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    joints[v * 4] = bone[v];
    weights[v * 4] = 1;
  }
  return {
    positions: Float32Array.from(pos),
    normals: Float32Array.from(nrm),
    triangles: Uint32Array.from(tri),
    joints,
    weights,
    uvs: new Float32Array(n * 2).fill(0.5),
    isBody: new Uint8Array(n).fill(1),
    skeleton: { names: ["pelvis", "spine_01", "neck_01", "head"], heads: [[0, 0.95, 0], [0, 1.1, 0], [0, 1.45, 0], [0, 1.52, 0]] },
    eyes: [[0.032, 1.62, 0.09], [-0.032, 1.62, 0.09]],
    earMid: [0, 1.6, 0],
    mouth: [0, 1.53, 0.095],
  };
}

const NONE: PartsConfig = { seed: 0.3, scale: 1, horns: "none", hornSize: 0.8, hornColor: [0.8, 0.75, 0.6], tusks: 0, tail: "none", tailLength: 0.9, beard: "none", hair: "none" };

describe("race parts", () => {
  it("builds nothing without add-ons", () => {
    expect(hasParts(NONE)).toBe(false);
    expect(buildParts(body(), NONE)).toEqual([]);
  });

  it("puts horns on the upper head, skinned to the head", () => {
    const [horns] = buildParts(body(), { ...NONE, horns: "swept" });
    expect(horns.name).toBe("horns");
    for (let v = 0; v < horns.positions.length / 3; v++) expect(horns.positions[v * 3 + 1]).toBeGreaterThan(1.6);
    expect(new Set(horns.joints.filter((_, i) => horns.weights[i] > 0))).toEqual(new Set([3]));
    // Both sides: left (+X) and right.
    expect(Math.max(...horns.positions.filter((_, i) => i % 3 === 0))).toBeGreaterThan(0.04);
    expect(Math.min(...horns.positions.filter((_, i) => i % 3 === 0))).toBeLessThan(-0.04);
  });

  it("grows the tail backwards (-Z) from inside the lower back, on its own bone chain", () => {
    const [tail] = buildParts(body(), { ...NONE, tail: "reptile" });
    expect(tail.kind).toBe("skin");
    const z = tail.positions.filter((_, i) => i % 3 === 2);
    expect(Math.min(...z)).toBeLessThan(-0.5);
    // The base starts inside the trunk (back surface at z = -0.12).
    expect(Math.max(...z)).toBeGreaterThan(-0.12);
    expect(Math.max(...z)).toBeLessThan(0.05);
    expect(tail.bones?.map((b) => b.parent)).toEqual(["pelvis", "tail_01", "tail_02", "tail_03", "tail_04", "tail_05"]);
    // Joints: the hips (pelvis = 0) at the base, then the 6 tail bones after the 4 pack bones.
    const used = new Set(tail.joints.filter((_, i) => tail.weights[i] > 0));
    expect(used.has(0)).toBe(true);
    for (let k = 4; k < 10; k++) expect(used.has(k)).toBe(true);
    expect(Math.max(...used)).toBe(9);
  });

  it("anchors beard strands to the skin they grow from (face morphs)", () => {
    const [beard] = buildParts(body(), { ...NONE, beard: "full" });
    expect(beard.anchors?.length).toBe(beard.positions.length / 3);
    const [horns] = buildParts(body(), { ...NONE, horns: "ram" });
    expect(horns.anchors).toBeUndefined();
  });

  it("roots beards on the lower front of the face and is deterministic", () => {
    const a = buildParts(body(), { ...NONE, beard: "full" })[0];
    expect(a.kind).toBe("hair");
    expect(a.positions.length).toBeGreaterThan(1000);
    // Card roots (v = 0) lie on the front half of the head (sideburns reach the ears) and below the eyes.
    for (let v = 0; v < a.uvs.length / 2; v++) {
      if (a.uvs[v * 2 + 1] !== 0) continue;
      expect(a.positions[v * 3 + 2]).toBeGreaterThan(-0.02);
      expect(a.positions[v * 3 + 1]).toBeLessThan(1.62);
    }
    const b = buildParts(body(), { ...NONE, beard: "full" })[0];
    expect(b.positions).toEqual(a.positions);
  });

  it("draws beards as hair masses: a shell over the skin and a few hundred wide locks, no single hairs", () => {
    const [beard] = buildParts(body(), { ...NONE, beard: "full" });
    const verts = beard.positions.length / 3;
    // The mass uses the right half of the beard texture, the locks the left half.
    let shell = 0;
    for (let v = 0; v < verts; v++) if (beard.uvs[v * 2] > 0.5) shell++;
    expect(shell).toBeGreaterThan(50);
    // Locks are 2 vertices per row; far fewer cards than the old 2,400 strands.
    expect((verts - shell) / 10).toBeLessThan(800);
    expect(beardPaint("full")).toEqual({ amount: 2, blur: expect.any(Number) });
  });

  it("paints short beards on the skin instead of building geometry", () => {
    expect(buildParts(body(), { ...NONE, beard: "short" })).toEqual([]);
    expect(beardPaint("short")?.amount).toBe(2);
    expect(beardPaint("none")).toBeNull();
  });

  it("keeps the chinstrap to a band along the jaw", () => {
    expect(beardCoverage(4, 0, -2.0, 1)).toBeGreaterThan(0.9);
    expect(beardCoverage(4, 0.6, -1.0, 1)).toBe(0);
    expect(beardCoverage(0, 0.6, -1.0, 1)).toBeGreaterThan(0.5);
  });

  it("puts tusks at the mouth pointing up and forward", () => {
    const [t] = buildParts(body(), { ...NONE, tusks: 0.8 });
    const y = t.positions.filter((_, i) => i % 3 === 1), z = t.positions.filter((_, i) => i % 3 === 2);
    expect(Math.min(...y)).toBeGreaterThan(1.48);
    expect(Math.max(...y)).toBeLessThan(1.6);
    expect(Math.min(...z)).toBeGreaterThan(0.03);
  });

  it("makes leaf hair on the scalp", () => {
    const [l] = buildParts(body(), { ...NONE, hair: "leaves" });
    expect(l.kind).toBe("leaf");
    expect(Math.max(...l.positions.filter((_, i) => i % 3 === 1))).toBeGreaterThan(1.7);
  });
});

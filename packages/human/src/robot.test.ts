import { describe, expect, it } from "vitest";
import type { FittedSkeleton } from "@actors/core";
import { type RobotBody, DEFAULT_ROBOT, buildRobot, sanitizeRobot } from "./robot";

const ID = () => new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

/**
 * A synthetic body: a trunk (pelvis -> spine_01 -> neck_01) under a head
 * sphere, weights blending linearly over 8 cm at each joint.
 */
function body(): RobotBody {
  const names = ["pelvis", "spine_01", "neck_01", "head"];
  const heads: [number, number, number][] = [[0, 0.9, 0], [0, 1.15, 0], [0, 1.42, 0], [0, 1.52, 0]];
  const tails: [number, number, number][] = [[0, 1.15, 0], [0, 1.42, 0], [0, 1.52, 0], [0, 1.75, 0]];
  const skeleton: FittedSkeleton = {
    names,
    parents: Int32Array.from([-1, 0, 1, 2]),
    heads,
    tails,
    worldRotations: names.map(ID),
    localPositions: heads,
    localRotations: names.map(() => [0, 0, 0, 1]),
  };
  const pos: number[] = [], nrm: number[] = [], tri: number[] = [], infl: [number, number][][] = [];
  const blend = (y: number): [number, number][] => {
    // pelvis | spine_01 at 1.15, spine_01 | neck_01 at 1.42.
    const t1 = Math.min(1, Math.max(0, (y - 1.11) / 0.08)), t2 = Math.min(1, Math.max(0, (y - 1.38) / 0.08));
    if (y < 1.3) return [[0, 1 - t1], [1, t1]];
    return [[1, 1 - t2], [2, t2]];
  };
  const grid = (rows: number, cols: number, at: (u: number, v: number) => [number[], number[]], w: (p: number[]) => [number, number][]) => {
    const base = pos.length / 3;
    for (let i = 0; i <= rows; i++)
      for (let j = 0; j <= cols; j++) {
        const [p, n] = at(i / rows, j / cols);
        pos.push(...p);
        nrm.push(...n);
        infl.push(w(p));
      }
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < cols; j++) {
        const a = base + i * (cols + 1) + j, c = a + cols + 1;
        tri.push(a, a + 1, c, a + 1, c + 1, c);
      }
  };
  grid(60, 40, (u, v) => {
    const ph = v * Math.PI * 2;
    const n = [Math.sin(ph), 0, Math.cos(ph)];
    return [[n[0] * 0.15, 1.46 - u * 0.56, n[2] * 0.11], n];
  }, (p) => blend(p[1]));
  const C = [0, 1.62, 0];
  grid(30, 40, (u, v) => {
    const th = u * Math.PI, ph = v * Math.PI * 2;
    const n = [Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph)];
    return [n.map((x, k) => C[k] + x * 0.1), n];
  }, () => [[3, 1]]);
  const n = pos.length / 3;
  const joints = new Uint16Array(n * 4), weights = new Float32Array(n * 4);
  infl.forEach((list, v) => list.forEach(([j, w], k) => ((joints[v * 4 + k] = j), (weights[v * 4 + k] = w))));
  const map = Uint32Array.from({ length: n }, (_, i) => i);
  return {
    positions: Float32Array.from(pos),
    normals: Float32Array.from(nrm),
    triangles: Uint32Array.from(tri),
    joints,
    weights,
    used: new Uint8Array(n).fill(1),
    render: { map, uv: new Float32Array(n * 2), indices: Uint32Array.from(tri) },
    skeleton,
    eyes: [[0.032, 1.63, 0.09], [-0.032, 1.63, 0.09]],
  };
}

describe("robot", () => {
  const b = body();
  // Sleek plating keeps a plate on the abdomen (segmented shows actuator rings there).
  const SLEEK = { ...DEFAULT_ROBOT, plating: "sleek" as const };
  const { parts, lift } = buildRobot(b, SLEEK);
  const byKind = new Map(parts.map((p) => [p.kind, p]));

  it("builds plates, frame, joints, visor and lights", () => {
    expect(buildRobot(b, DEFAULT_ROBOT).parts.length).toBeGreaterThanOrEqual(5);
    for (const kind of ["plate", "trim", "frame", "joint", "visor", "glow"]) expect(byKind.has(kind as never), kind).toBe(true);
    for (const p of parts) {
      expect(p.positions.every(Number.isFinite), p.name).toBe(true);
      expect(p.normals.every(Number.isFinite), p.name).toBe(true);
      expect(Math.max(...p.indices)).toBeLessThan(p.positions.length / 3);
    }
    expect(lift).toBeGreaterThanOrEqual(0);
  });

  it("keeps plates rigid on one bone and opens gaps at the joints", () => {
    const plate = byKind.get("plate")!;
    const bones = new Set<number>();
    for (let v = 0; v < plate.positions.length / 3; v++) {
      expect(plate.weights[v * 4]).toBeCloseTo(1, 5);
      bones.add(plate.joints[v * 4]);
    }
    // The abdomen plate (spine_01) and the head shell are plates; the neck is bare.
    expect(bones.has(1)).toBe(true);
    expect(bones.has(3)).toBe(true);
    expect(bones.has(2)).toBe(false);
    // No spine_01 plate vertex reaches into the blend zone at 1.15 (its plate starts above the threshold).
    for (let v = 0; v < plate.positions.length / 3; v++) if (plate.joints[v * 4] === 1) expect(plate.positions[v * 3 + 1]).toBeGreaterThan(1.13);
  });

  it("puts plates outside the frame", () => {
    const plate = byKind.get("plate")!;
    let outside = 0, total = 0;
    for (let v = 0; v < plate.positions.length / 3; v++) {
      if (plate.joints[v * 4] !== 1) continue;
      const r = Math.hypot(plate.positions[v * 3] / 0.15, plate.positions[v * 3 + 2] / 0.11);
      total++;
      if (r > 0.995) outside++;
    }
    expect(outside / total).toBeGreaterThan(0.6);
  });

  it("is deterministic and follows the head style", () => {
    const again = buildRobot(body(), SLEEK).parts;
    expect(again.map((p) => p.positions.length)).toEqual(parts.map((p) => p.positions.length));
    const optics = buildRobot(b, { ...DEFAULT_ROBOT, head: "optics", ears: "none" }).parts;
    expect(optics.some((p) => p.kind === "visor")).toBe(false);
  });

  it("sanitizes configs", () => {
    expect(sanitizeRobot({ head: "nope" as never, thickness: 7 })).toEqual({ ...DEFAULT_ROBOT, thickness: 1 });
  });
});

import { describe, expect, it } from "vitest";
import type { FittedSkeleton } from "@actors/core";
import type { RobotBody } from "./robot";
import { DEFAULT_SKELETAL, buildSkeletal, sanitizeSkeletal } from "./skeletal";

type V = [number, number, number];
const ID = () => new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

/** A stick-figure rig (game_engine bone names, A-pose, 1.75 m) under a trunk tube and a head sphere. */
function body(): RobotBody {
  const bones: [string, string | null, V, V][] = [
    ["pelvis", null, [0, 0.92, 0], [0, 1.02, -0.01]],
    ["spine_01", "pelvis", [0, 1.02, -0.01], [0, 1.13, -0.02]],
    ["spine_02", "spine_01", [0, 1.13, -0.02], [0, 1.25, -0.03]],
    ["spine_03", "spine_02", [0, 1.25, -0.03], [0, 1.47, 0]],
    ["neck_01", "spine_03", [0, 1.47, 0], [0, 1.57, 0.03]],
    ["head", "neck_01", [0, 1.57, 0.03], [0, 1.78, 0.03]],
  ];
  for (const [s, x] of [["l", 1], ["r", -1]] as const) {
    const f = (p: V): V => [p[0] * x, p[1], p[2]];
    bones.push(
      [`clavicle_${s}`, "spine_03", f([0.03, 1.42, 0.02]), f([0.18, 1.44, -0.01])],
      [`upperarm_${s}`, `clavicle_${s}`, f([0.18, 1.44, -0.01]), f([0.4, 1.2, -0.02])],
      [`lowerarm_${s}`, `upperarm_${s}`, f([0.4, 1.2, -0.02]), f([0.58, 1.0, 0.02])],
      [`hand_${s}`, `lowerarm_${s}`, f([0.58, 1.0, 0.02]), f([0.64, 0.93, 0.03])],
      [`thigh_${s}`, "pelvis", f([0.1, 0.9, 0]), f([0.12, 0.5, 0.02])],
      [`calf_${s}`, `thigh_${s}`, f([0.12, 0.5, 0.02]), f([0.13, 0.09, 0])],
      [`foot_${s}`, `calf_${s}`, f([0.13, 0.09, 0]), f([0.14, 0.02, 0.13])],
      [`ball_${s}`, `foot_${s}`, f([0.14, 0.02, 0.13]), f([0.14, 0.02, 0.19])],
    );
    for (const [k, finger] of ["thumb", "index", "middle", "ring", "pinky"].entries()) {
      let prev = `hand_${s}`;
      let p: V = f([0.64, 0.93, 0.05 - k * 0.02]);
      for (let j = 1; j <= 3; j++) {
        const q: V = [p[0] + 0.025 * x, p[1] - 0.02, p[2]];
        bones.push([`${finger}_0${j}_${s}`, prev, p, q]);
        prev = `${finger}_0${j}_${s}`;
        p = q;
      }
    }
  }
  const names = bones.map((b) => b[0]);
  const heads = bones.map((b) => b[2]);
  const skeleton: FittedSkeleton = {
    names,
    parents: Int32Array.from(bones.map((b) => (b[1] ? names.indexOf(b[1]) : -1))),
    heads,
    tails: bones.map((b) => b[3]),
    worldRotations: names.map(ID),
    localPositions: heads,
    localRotations: names.map(() => [0, 0, 0, 1]),
  };
  const pos: number[] = [], nrm: number[] = [], tri: number[] = [], infl: number[] = [];
  const grid = (rows: number, cols: number, at: (u: number, v: number) => [number[], number[]], bone: number) => {
    const base = pos.length / 3;
    for (let i = 0; i <= rows; i++)
      for (let j = 0; j <= cols; j++) {
        const [p, n] = at(i / rows, j / cols);
        pos.push(...p);
        nrm.push(...n);
        infl.push(bone);
      }
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < cols; j++) {
        const a = base + i * (cols + 1) + j, c = a + cols + 1;
        tri.push(a, a + 1, c, a + 1, c + 1, c);
      }
  };
  grid(60, 40, (u, v) => {
    const n = [Math.sin(v * Math.PI * 2), 0, Math.cos(v * Math.PI * 2)];
    return [[n[0] * 0.15, 1.5 - u * 0.6, n[2] * 0.11], n];
  }, names.indexOf("spine_02"));
  const C = [0, 1.66, 0.02];
  grid(40, 48, (u, v) => {
    const th = u * Math.PI, ph = v * Math.PI * 2;
    const n = [Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph)];
    return [[C[0] + n[0] * 0.075, C[1] + n[1] * 0.115, C[2] + n[2] * 0.1], n];
  }, names.indexOf("head"));
  const n = pos.length / 3;
  const joints = new Uint16Array(n * 4), weights = new Float32Array(n * 4);
  infl.forEach((j, v) => ((joints[v * 4] = j), (weights[v * 4] = 1)));
  return {
    positions: Float32Array.from(pos),
    normals: Float32Array.from(nrm),
    triangles: Uint32Array.from(tri),
    joints,
    weights,
    used: new Uint8Array(n).fill(1),
    render: { map: Uint32Array.from({ length: n }, (_, i) => i), uv: new Float32Array(n * 2), indices: Uint32Array.from(tri) },
    skeleton,
    eyes: [[0.032, 1.67, 0.09], [-0.032, 1.67, 0.09]],
  };
}

describe("skeletal", () => {
  const b = body();
  const full = buildSkeletal(b, DEFAULT_SKELETAL);
  const bone = full.parts.find((p) => p.kind === "bone")!;

  it("builds bones and eye lights with valid geometry", () => {
    expect(bone).toBeDefined();
    expect(full.parts.some((p) => p.kind === "glow")).toBe(true);
    for (const p of full.parts) {
      expect(p.positions.every(Number.isFinite), p.name).toBe(true);
      expect(p.normals.every(Number.isFinite), p.name).toBe(true);
      expect(p.indices.reduce((m, i) => Math.max(m, i), 0)).toBeLessThan(p.positions.length / 3);
    }
    expect(Number.isFinite(full.lift)).toBe(true);
  });

  it("keeps every bone rigid and covers head, trunk, arms, hands and legs", () => {
    const used = new Set<number>();
    for (let v = 0; v < bone.positions.length / 3; v++) {
      expect(bone.weights[v * 4]).toBeCloseTo(1, 5);
      used.add(bone.joints[v * 4]);
    }
    const names = b.skeleton.names;
    for (const n of ["head", "pelvis", "spine_03", "upperarm_l", "lowerarm_r", "hand_l", "index_02_r", "thigh_l", "calf_r", "foot_l"])
      expect(used.has(names.indexOf(n)), n).toBe(true);
  });

  it("drops bones when asked and is repeatable for a seed", { timeout: 30000 }, () => {
    const build = (c: object) => buildSkeletal(b, { ...DEFAULT_SKELETAL, ...c }).parts;
    const tris = (parts: ReturnType<typeof build>) => parts.find((p) => p.kind === "bone")!.indices.length;
    const bare = build({ missing: 1, jaw: false, eyes: false });
    expect(tris(bare)).toBeLessThan(bone.indices.length);
    expect(bare.some((p) => p.kind === "glow")).toBe(false);
    expect(tris(build({ missing: 0.5, seed: 0.3 }))).toBe(tris(build({ missing: 0.5, seed: 0.3 })));
  });

  it("sanitizes configs", () => {
    expect(sanitizeSkeletal(undefined)).toEqual(DEFAULT_SKELETAL);
    expect(sanitizeSkeletal({ wear: 4, robust: -1, missing: Number.NaN, jaw: undefined })).toMatchObject({ wear: 1, robust: 0, missing: DEFAULT_SKELETAL.missing, jaw: true });
  });
});

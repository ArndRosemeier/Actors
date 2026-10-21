import { describe, expect, it } from "vitest";
import type { Vec3 } from "@actors/core";
import { type Rig, boneFrame, placeBones } from "./rig";
import { Pose } from "./squirrelclips";

/** A hip, a thigh and a shank pointing down with a bent knee. */
function legRig(): Rig {
  const bones = [
    { name: "Hips", parent: -1, head: [0, 0.2, 0] as Vec3, tail: [0, 0.2, 0.1] as Vec3, roll: 0, node: 0 },
    { name: "Upper", parent: 0, head: [0, 0.2, 0] as Vec3, tail: [0, 0.1, 0.03] as Vec3, roll: 0, node: 1 },
    { name: "Lower", parent: 1, head: [0, 0.1, 0.03] as Vec3, tail: [0, 0, 0] as Vec3, roll: 0, node: 2 },
  ];
  return { bones, index: new Map(bones.map((b, i) => [b.name, i])) };
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("squirrel clip posing", () => {
  it("two-bone IK reaches the target and keeps bone lengths and the knee's side", () => {
    const pose = new Pose(legRig());
    pose.turn("Hips", [1, 0, 0], -0.4);
    const target: Vec3 = [0, 0.03, -0.02];
    pose.ik("Upper", "Lower", target);
    expect(dist(pose.tail("Lower"), target)).toBeLessThan(1e-6);
    expect(dist(pose.head("Upper"), pose.head("Lower"))).toBeCloseTo(Math.hypot(0.1, 0.03), 6);
    expect(dist(pose.head("Lower"), pose.tail("Lower"))).toBeCloseTo(Math.hypot(0.1, 0.03), 6);
    // The knee still bends forward (+Z of the hip-to-foot line).
    expect(pose.head("Lower")[2]).toBeGreaterThan(0);
  });

  it("setWorld and aim give bones the asked-for direction", () => {
    const pose = new Pose(legRig());
    pose.aim("Upper", [0, 0, 1]);
    const d = pose.tail("Upper").map((v, k) => v - pose.head("Upper")[k]);
    expect(d[2] / Math.hypot(...d)).toBeCloseTo(1, 6);
    pose.setWorld("Lower", [0, 0, 0, 1]);
    const e = pose.tail("Lower").map((v, k) => v - pose.head("Lower")[k]);
    expect(e[1] / Math.hypot(...e)).toBeCloseTo(-0.1 / Math.hypot(0.1, 0.03), 6);
  });

  it("placeBones moves bones and keeps their frames orthonormal along the new direction", () => {
    const rig = legRig();
    placeBones(rig, { Hips: [[0, 0.1, 0], [0, 0.1, 0.05]], Upper: [[0, 0.1, 0], [0, 0.05, -0.04]], Lower: [[0, 0.05, -0.04], [0, 0, 0.02]] });
    for (const b of rig.bones) {
      const f = boneFrame(b);
      const dir = b.tail.map((v, k) => v - b.head[k]);
      const l = Math.hypot(...dir);
      expect(f[3] * dir[0] + f[4] * dir[1] + f[5] * dir[2]).toBeCloseTo(l, 6);
    }
    expect(rig.bones[2].tail).toEqual([0, 0, 0.02]);
  });
});

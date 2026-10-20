import { describe, expect, it } from "vitest";
import { type Quat, type SkeletonDef, type Vec3, Retargeter, fitSkeleton, quatAxisAngle, quatConjugate, quatMul } from "@actors/core";
import { importClip, targetBone } from "./clips";
import type { Gltf } from "./gltf";

const rotate = (q: Quat, v: Vec3): Vec3 => {
  const p = quatMul(quatMul(q, [v[0], v[1], v[2], 0]), quatConjugate(q));
  return [p[0], p[1], p[2]];
};

describe("Quaternius bone names", () => {
  it("maps Rigify DEF bones and Unreal names onto the game_engine rig", () => {
    expect(targetBone("DEF-hips")).toBe("pelvis");
    expect(targetBone("DEF-upper_arm.L")).toBe("upperarm_l");
    expect(targetBone("DEF-shin.R")).toBe("calf_r");
    expect(targetBone("DEF-f_index.02.L")).toBe("index_02_l");
    expect(targetBone("DEF-thumb.03.R")).toBe("thumb_03_r");
    expect(targetBone("Head")).toBe("head");
    expect(targetBone("ring_01_l")).toBe("ring_01_l");
    expect(targetBone("index_04_leaf_l")).toBeUndefined();
    expect(targetBone("root")).toBeUndefined();
  });
});

describe("clip retargeting", () => {
  // Source: pelvis pointing up, an arm sticking out sideways (T-pose).
  // Target: same bones, but the arm hangs down at 45 degrees (A-pose).
  const armRest = quatAxisAngle([0, 0, 1], -Math.PI / 2); // +Y -> +X
  const armPose = quatAxisAngle([0, 0, 1], -Math.PI); // arm straight down
  const source: Gltf = {
    nodes: [
      { name: "pelvis", children: [1], translation: [0, 1, 0], rotation: [0, 0, 0, 1] },
      { name: "upperarm_l", children: [], translation: [0.2, 0.4, 0], rotation: armRest },
      { name: "ball_l", children: [], translation: [0, -1, 0], rotation: [0, 0, 0, 1] },
    ],
    parents: new Int32Array([-1, 0, 0]),
    joints: [0, 1, 2],
    animations: [
      {
        name: "Drop",
        duration: 1,
        channels: [{ node: 1, path: "rotation", times: new Float32Array([0, 1]), values: new Float32Array([...armRest, ...armPose]), interpolation: "LINEAR" }],
      },
    ],
  };

  it("anchors deltas to the rest pose and lands bones on the source directions", () => {
    const { def, data } = importClip({ name: "drop", archive: "ual1", animation: "Drop", loop: false }, source, "test");
    expect(def.bones).toEqual(["pelvis", "upperarm_l", "ball_l"]);
    // Frame 0 is the rest pose: identity deltas.
    expect(Math.abs(data[7])).toBeCloseTo(1, 5);

    // Target skeleton from vertex positions: pelvis up, arm at 45 degrees down-left.
    const s = Math.SQRT1_2;
    const positions = new Float32Array([0, 1, 0, 0, 1.4, 0, 0.2, 1.4, 0, 0.2 + s, 1.4 - s, 0, 0, 0, 0, 0, 0, 0.2]);
    const skel: SkeletonDef = {
      name: "t",
      bones: [
        { name: "pelvis", parent: -1, head: { vertices: [0] }, tail: { vertices: [1] }, roll: 0 },
        { name: "upperarm_l", parent: 0, head: { vertices: [2] }, tail: { vertices: [3] }, roll: 0 },
      ],
    };
    const fitted = fitSkeleton(skel, positions);
    const r = new Retargeter(fitted, { def, data });

    const worldArm = (t: number) => {
      const pose = r.sample(t);
      return rotate(quatMul(pose.rotations[0], pose.rotations[1]), [0, 1, 0]);
    };
    // At rest the arm is lifted to the source's T-pose; at the end it points straight down like the source.
    worldArm(0).forEach((v, c) => expect(v).toBeCloseTo([1, 0, 0][c], 4));
    worldArm(1).forEach((v, c) => expect(v).toBeCloseTo([0, -1, 0][c], 4));
  });
});

import { describe, expect, it } from "vitest";
import type { Vec3 } from "@actors/core";
import { LEG, TAIL, WING_INNER, WING_OUTER, chickenRig } from "./chicken";
import { chickenClips } from "./chickenclips";
import type { Rig } from "./rig";
import { Pose } from "./squirrelclips";

/** The bone tree of Mesh2Motion's bird rig (positions don't matter: the chicken places every bone). */
function birdRig(): Rig {
  const tree: [string, string | null][] = [
    ["hips", null], ["spine_0", "hips"], ["spine_1", "spine_0"], ["spine_2", "spine_1"], ["spine_3", "spine_2"], ["head", "spine_3"],
    ["mouth_upper", "head"], ["mouth_upper_tip", "mouth_upper"], ["mouth_lower", "mouth_upper"], ["mouth_lower_tip", "mouth_lower"],
    ["tail_1", "hips"], ["tail_2", "tail_1"], ["tail_3", "tail_2"], ["tail_tip", "tail_3"],
  ];
  for (const s of ["L", "R"]) {
    tree.push([`wing_1_${s}`, "spine_1"], [`wing_2_${s}`, `wing_1_${s}`], [`wing_feather_1_1_${s}`, `wing_2_${s}`], [`wing_feather_1_2_${s}`, `wing_feather_1_1_${s}`]);
    tree.push([`wing_3_${s}`, `wing_2_${s}`], [`wing_4_${s}`, `wing_3_${s}`], [`wing_5_${s}`, `wing_4_${s}`], [`wing_tip_${s}`, `wing_5_${s}`]);
    tree.push([`wing_feather_2_1_${s}`, `wing_3_${s}`], [`wing_feather_2_2_${s}`, `wing_feather_2_1_${s}`], [`wing_feather_3_1_${s}`, `wing_4_${s}`], [`wing_feather_3_2_${s}`, `wing_feather_3_1_${s}`]);
    tree.push([`wing_feather_4_1_${s}`, `wing_5_${s}`], [`wing_feather_4_2_${s}`, `wing_feather_4_1_${s}`]);
    LEG.forEach((b, i) => tree.push([`${b}_${s}`, i === 0 ? "hips" : `${LEG[i - 1]}_${s}`]));
  }
  const index = new Map(tree.map(([n], i) => [n, i]));
  const bones = tree.map(([name, parent], i) => ({ name, parent: parent ? index.get(parent)! : -1, head: [0, 0.5, i * 0.01] as Vec3, tail: [0, 0.6, i * 0.01] as Vec3, roll: 0, node: i }));
  return { bones, index };
}

describe("chicken rig and clips", () => {
  const rig = chickenRig(birdRig());
  const bone = (n: string) => rig.bones[rig.index.get(n)!];

  it("stands on its feet with the head up and the wings folded along the body", () => {
    expect(bone("Toes_tip_L").tail[1]).toBeLessThan(0.006);
    expect(bone("head").head[1]).toBeGreaterThan(0.35);
    expect(bone("mouth_upper_tip").tail[2]).toBeGreaterThan(bone("head").head[2]);
    // Folded: the wing tip lies behind the shoulder, close to the body's side.
    for (const s of ["L", "R"]) {
      const shoulder = bone(`wing_1_${s}`).head, tip = bone(`wing_tip_${s}`).tail;
      expect(tip[2]).toBeLessThan(shoulder[2] - 0.15);
      expect(Math.abs(tip[0])).toBeLessThan(0.1);
      expect(Math.sign(tip[0])).toBe(s === "L" ? 1 : -1);
    }
    expect(bone(TAIL[3]).tail[1]).toBeGreaterThan(bone("hips").head[1]);
    expect(WING_INNER.length + WING_OUTER.length).toBe(14);
  });

  it("makes looping clips of finite turns; the walk keeps the standing foot on the ground", () => {
    const clips = chickenClips(rig);
    expect(clips.map((c) => c.def.name)).toEqual(["idle", "walk", "run", "peck", "scratch", "flap", "sit"]);
    for (const { def, data } of clips) {
      expect(data.every(Number.isFinite), def.name).toBe(true);
      expect(def.bones.length).toBe(rig.bones.length);
    }
    // Re-pose the walk's first frame and check the stance foot (the left one starts its stance).
    const walk = clips[1];
    const stride = walk.def.bones.length * 4 + 3;
    const pose = new Pose(rig);
    walk.def.bones.forEach((_, k) => pose.D.splice(k, 1, Array.from(walk.data.subarray(k * 4, k * 4 + 4)) as never));
    const hip = rig.bones[rig.index.get("hips")!].head[1];
    pose.root = Array.from(walk.data.subarray(walk.def.bones.length * 4, stride)).map((v) => v * hip) as Vec3;
    const foot = pose.tail("AnkleLeg_L");
    expect(Math.abs(foot[1] - bone("AnkleLeg_L").tail[1])).toBeLessThan(0.003);
  });
});

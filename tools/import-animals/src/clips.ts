/**
 * Quadruped clips from the rig's glTF: per bone the world-space rotation change
 * since the rig's rest pose plus the bone's rest direction (the pack's
 * retargetable clip format, see @actors/core ClipDef), root motion in hip heights.
 */
import { type ClipDef, type Quat, type Vec3, normalize, quatConjugate, quatMul } from "@actors/core";
import { type Gltf } from "../../import-makehuman/src/gltf";
import { animLocals, restLocals, worldPose } from "../../import-makehuman/src/clips";
import type { Rig } from "./rig";

const FPS = 30;

/** Our name, source animation, loops, category. "Rest Pose" is left out. */
export const DOG_CLIPS: [string, string, boolean, string][] = [
  ["idle", "Idle", true, "Idle"],
  ["alert", "Idle Alert", true, "Idle"],
  ["sit", "Sit", true, "Idle"],
  ["walk", "Walk", true, "Locomotion"],
  ["run", "Run", true, "Locomotion"],
  ["sneak", "Sneak", true, "Locomotion"],
  ["jump", "Jump", false, "Locomotion"],
  ["bark", "Bark", true, "Actions"],
  ["howl", "Howl", true, "Actions"],
  ["fetch", "Fetch", true, "Actions"],
  ["bite", "Bite", false, "Actions"],
  ["fall", "Fall", false, "Reactions"],
  ["death", "Death", false, "Reactions"],
];

function rotate(q: Quat, v: Vec3): Vec3 {
  const p = quatMul(quatMul(q, [v[0], v[1], v[2], 0]), quatConjugate(q));
  return [p[0], p[1], p[2]];
}

export function convertClips(g: Gltf, rig: Rig, source = "Mesh2Motion fox rig (CC0)"): { def: ClipDef; data: Float32Array }[] {
  const nodes = rig.bones.map((b) => b.node);
  const names = rig.bones.map((b) => b.name);
  const hips = rig.bones[rig.index.get("Hips")!].node;
  const rest = worldPose(g, restLocals(g));
  const refDirs = nodes.flatMap((j) => normalize(rotate(rest.rot[j], [0, 1, 0])));
  const restInv = nodes.map((j) => quatConjugate(rest.rot[j]));
  const footY = Math.min(...rig.bones.filter((b) => /Tip_[LR]$/.test(b.name) && /Leg/.test(b.name)).map((b) => rest.pos[b.node][1]));
  const hipHeight = rest.pos[hips][1] - footY;
  const out: { def: ClipDef; data: Float32Array }[] = [];
  for (const [name, animation, loop, category] of DOG_CLIPS) {
    const anim = g.animations.find((a) => a.name === animation);
    if (!anim) throw new Error(`No animation ${animation}`);
    const frameCount = Math.max(2, Math.round(anim.duration * FPS) + 1);
    const stride = nodes.length * 4 + 3;
    const data = new Float32Array(frameCount * stride);
    const first = worldPose(g, animLocals(g, anim, 0)).pos[hips];
    for (let f = 0; f < frameCount; f++) {
      const pose = worldPose(g, animLocals(g, anim, (f / (frameCount - 1)) * anim.duration));
      nodes.forEach((j, k) => {
        const q = quatMul(pose.rot[j], restInv[k]);
        if (f > 0) {
          const o = (f - 1) * stride + k * 4;
          if (q[0] * data[o] + q[1] * data[o + 1] + q[2] * data[o + 2] + q[3] * data[o + 3] < 0) q.forEach((v, c) => (q[c] = -v));
        }
        data.set(q, f * stride + k * 4);
      });
      const p = pose.pos[hips];
      data.set([(p[0] - first[0]) / hipHeight, (p[1] - rest.pos[hips][1]) / hipHeight, (p[2] - first[2]) / hipHeight], f * stride + nodes.length * 4);
    }
    out.push({
      def: {
        name,
        file: `clips/${name}.bin`,
        fps: (frameCount - 1) / anim.duration,
        frameCount,
        loop,
        bones: names,
        refDirs,
        rootBone: "Hips",
        source: `${source}: ${animation}`,
        category,
      },
      data,
    });
  }
  return out;
}

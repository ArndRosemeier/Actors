/**
 * Turns Quaternius' Universal Animation Library (CC0, glTF) into retargetable
 * clips. The source rig has a proper rest pose (a T-pose) stored in the file,
 * so every track is anchored to it: per target bone, the world-space rotation
 * change since the rest pose, plus the bone's rest direction. The runtime turns
 * each fitted bone to that rest direction and then applies the change, which is
 * the usual "copy world rotation after aligning rest poses" retarget used by
 * Blender/Unreal retargeting tools.
 *
 * Source bones follow Blender's convention (local +Y runs from head to tail),
 * so the rest direction is read from the bone frame itself; no child joint is
 * needed and zero-length bones cannot occur.
 */
import { type ClipDef, type Quat, type Vec3, normalize, quatConjugate, quatMul } from "@actors/core";
import { type Gltf, type GltfAnimation, sampleChannel } from "./gltf";

const QUATERNIUS = "https://opengameart.org/sites/default/files";
export const UAL_ARCHIVES = {
  ual1: {
    url: `${QUATERNIUS}/universal_animation_librarystandard.zip`,
    glb: "Animation Library[Standard]/Godot/AnimationLibrary_Godot_Standard.glb",
  },
  ual2: {
    url: `${QUATERNIUS}/universal_animation_library_2standard.zip`,
    glb: "Universal Animation Library 2 [Standard]/Unreal-Godot/UAL2_Standard.glb",
  },
} as const;
export type UalArchive = keyof typeof UAL_ARCHIVES;

export interface ClipSpec {
  name: string;
  archive: UalArchive;
  animation: string;
  loop: boolean;
}

export const CLIP_SPECS: ClipSpec[] = [
  { name: "idle", archive: "ual1", animation: "Idle_Loop", loop: true },
  { name: "talk", archive: "ual1", animation: "Idle_Talking_Loop", loop: true },
  { name: "arms folded", archive: "ual2", animation: "Idle_FoldArms_Loop", loop: true },
  { name: "phone", archive: "ual2", animation: "Idle_TalkingPhone_Loop", loop: true },
  { name: "walk", archive: "ual1", animation: "Walk_Loop", loop: true },
  { name: "walk formal", archive: "ual1", animation: "Walk_Formal_Loop", loop: true },
  { name: "jog", archive: "ual1", animation: "Jog_Fwd_Loop", loop: true },
  { name: "sprint", archive: "ual1", animation: "Sprint_Loop", loop: true },
  { name: "crouch walk", archive: "ual1", animation: "Crouch_Fwd_Loop", loop: true },
  { name: "dance", archive: "ual1", animation: "Dance_Loop", loop: true },
  { name: "sit", archive: "ual1", animation: "Sitting_Idle_Loop", loop: true },
  { name: "nod", archive: "ual2", animation: "Yes", loop: true },
  { name: "pick up", archive: "ual1", animation: "PickUp_Table", loop: true },
];

/** game_engine bone name for a Quaternius bone (UAL1 uses Rigify DEF names, UAL2 Unreal names). */
export function targetBone(source: string): string | undefined {
  const fingers = source.match(/^DEF-(?:f_)?(index|middle|ring|pinky|thumb)\.0([1-3])\.([LR])$/);
  if (fingers) return `${fingers[1]}_0${fingers[2]}_${fingers[3].toLowerCase()}`;
  const sided = source.match(/^DEF-(shoulder|upper_arm|forearm|hand|thigh|shin|foot|toe)\.([LR])$/);
  if (sided) {
    const map: Record<string, string> = { shoulder: "clavicle", upper_arm: "upperarm", forearm: "lowerarm", hand: "hand", thigh: "thigh", shin: "calf", foot: "foot", toe: "ball" };
    return `${map[sided[1]]}_${sided[2].toLowerCase()}`;
  }
  const center: Record<string, string> = { "DEF-hips": "pelvis", "DEF-spine.001": "spine_01", "DEF-spine.002": "spine_02", "DEF-spine.003": "spine_03", "DEF-neck": "neck_01", "DEF-head": "head" };
  if (center[source]) return center[source];
  if (/_leaf_|^root$/.test(source)) return undefined;
  if (source === "Head") return "head";
  // UAL2 already uses Unreal mannequin names, which the game_engine rig mirrors.
  return /^(pelvis|spine_0[1-3]|neck_01|(clavicle|upperarm|lowerarm|hand|thigh|calf|foot|ball)_[lr]|(index|middle|ring|pinky|thumb)_0[1-3]_[lr])$/.test(source) ? source : undefined;
}

const FPS = 30;

function rotate(q: Quat, v: Vec3): Vec3 {
  const p = quatMul(quatMul(q, [v[0], v[1], v[2], 0]), quatConjugate(q));
  return [p[0], p[1], p[2]];
}

/** World rotation and position of every node for the given local transforms. */
function worldPose(g: Gltf, local: { t: Vec3; r: Quat }[]) {
  const rot: Quat[] = new Array(g.nodes.length);
  const pos: Vec3[] = new Array(g.nodes.length);
  const visit = (i: number) => {
    if (rot[i]) return;
    const p = g.parents[i];
    if (p < 0) {
      rot[i] = local[i].r;
      pos[i] = local[i].t;
      return;
    }
    visit(p);
    rot[i] = quatMul(rot[p], local[i].r);
    const o = rotate(rot[p], local[i].t);
    pos[i] = [pos[p][0] + o[0], pos[p][1] + o[1], pos[p][2] + o[2]];
  };
  g.nodes.forEach((_, i) => visit(i));
  return { rot, pos };
}

function restLocals(g: Gltf) {
  return g.nodes.map((n) => ({ t: [...n.translation] as Vec3, r: [...n.rotation] as Quat }));
}

function animLocals(g: Gltf, anim: GltfAnimation, t: number) {
  const local = restLocals(g);
  for (const ch of anim.channels) {
    if (ch.path === "rotation") local[ch.node].r = sampleChannel(ch, t) as Quat;
    else if (ch.path === "translation") local[ch.node].t = sampleChannel(ch, t) as Vec3;
  }
  return local;
}

export function importClip(spec: ClipSpec, g: Gltf, source: string): { def: ClipDef; data: Float32Array } {
  const anim = g.animations.find((a) => a.name === spec.animation);
  if (!anim) throw new Error(`${source} has no animation ${spec.animation}`);
  const joints = g.joints.filter((j) => targetBone(g.nodes[j].name));
  const bones = joints.map((j) => targetBone(g.nodes[j].name)!);
  const hips = joints[bones.indexOf("pelvis")];

  // Rest pose of the source rig (glTF node transforms = Blender rest pose).
  const rest = worldPose(g, restLocals(g));
  const refDirs = joints.flatMap((j) => normalize(rotate(rest.rot[j], [0, 1, 0])));
  const restInv = joints.map((j) => quatConjugate(rest.rot[j]));
  const footY = Math.min(...g.joints.filter((j) => /toe|ball_[lr]$/.test(g.nodes[j].name)).map((j) => rest.pos[j][1]));
  const hipHeight = rest.pos[hips][1] - footY;

  const frameCount = Math.max(2, Math.round(anim.duration * FPS) + 1);
  const first = worldPose(g, animLocals(g, anim, 0)).pos[hips];
  const stride = joints.length * 4 + 3;
  const data = new Float32Array(frameCount * stride);
  for (let f = 0; f < frameCount; f++) {
    const pose = worldPose(g, animLocals(g, anim, (f / (frameCount - 1)) * anim.duration));
    joints.forEach((j, k) => {
      const q = quatMul(pose.rot[j], restInv[k]);
      // Keep neighbouring frames on the same hemisphere so interpolation takes the short way.
      if (f > 0) {
        const o = (f - 1) * stride + k * 4;
        if (q[0] * data[o] + q[1] * data[o + 1] + q[2] * data[o + 2] + q[3] * data[o + 3] < 0) q.forEach((v, c) => (q[c] = -v));
      }
      data.set(q, f * stride + k * 4);
    });
    const p = pose.pos[hips];
    data.set([(p[0] - first[0]) / hipHeight, (p[1] - rest.pos[hips][1]) / hipHeight, (p[2] - first[2]) / hipHeight], f * stride + joints.length * 4);
  }

  return {
    def: {
      name: spec.name,
      file: `clips/${spec.name.replace(/\s+/g, "-")}.bin`,
      fps: (frameCount - 1) / anim.duration,
      frameCount,
      loop: spec.loop,
      bones,
      refDirs,
      rootBone: "pelvis",
      source: `${source}: ${spec.animation}`,
    },
    data,
  };
}

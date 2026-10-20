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
  category?: string;
}

// [our name, archive, source animation, category]. Loops are the source's "_Loop" clips.
// Left out: the T-pose and the "_RM" twins of in-place clips (Roll, Sword_Attack, Hit_Knockback):
// root motion is extracted from the hips anyway, so they would play the same.
const CLIPS: [string, UalArchive, string, string][] = [
  ["idle", "ual1", "Idle_Loop", "Idle"],
  ["talk", "ual1", "Idle_Talking_Loop", "Idle"],
  ["arms folded", "ual2", "Idle_FoldArms_Loop", "Idle"],
  ["phone", "ual2", "Idle_TalkingPhone_Loop", "Idle"],
  ["nod", "ual2", "Yes", "Idle"],
  ["shake head", "ual2", "Idle_No_Loop", "Idle"],
  ["lean on rail", "ual2", "Idle_Rail_Loop", "Idle"],
  ["call from rail", "ual2", "Idle_Rail_Call", "Idle"],
  ["hold torch", "ual1", "Idle_Torch_Loop", "Idle"],
  ["hold lantern", "ual2", "Idle_Lantern_Loop", "Idle"],
  ["crouch", "ual1", "Crouch_Idle_Loop", "Idle"],
  ["walk", "ual1", "Walk_Loop", "Locomotion"],
  ["walk formal", "ual1", "Walk_Formal_Loop", "Locomotion"],
  ["walk carrying", "ual2", "Walk_Carry_Loop", "Locomotion"],
  ["jog", "ual1", "Jog_Fwd_Loop", "Locomotion"],
  ["sprint", "ual1", "Sprint_Loop", "Locomotion"],
  ["crouch walk", "ual1", "Crouch_Fwd_Loop", "Locomotion"],
  ["swim", "ual1", "Swim_Fwd_Loop", "Locomotion"],
  ["tread water", "ual1", "Swim_Idle_Loop", "Locomotion"],
  ["jump start", "ual1", "Jump_Start", "Locomotion"],
  ["jump", "ual1", "Jump_Loop", "Locomotion"],
  ["jump land", "ual1", "Jump_Land", "Locomotion"],
  ["ninja jump start", "ual2", "NinjaJump_Start", "Locomotion"],
  ["ninja jump", "ual2", "NinjaJump_Idle_Loop", "Locomotion"],
  ["ninja jump land", "ual2", "NinjaJump_Land", "Locomotion"],
  ["roll", "ual1", "Roll", "Locomotion"],
  ["slide start", "ual2", "Slide_Start", "Locomotion"],
  ["slide", "ual2", "Slide_Loop", "Locomotion"],
  ["slide exit", "ual2", "Slide_Exit", "Locomotion"],
  ["climb up", "ual2", "ClimbUp_1m_RM", "Locomotion"],
  ["push", "ual1", "Push_Loop", "Locomotion"],
  ["drive", "ual1", "Driving_Loop", "Locomotion"],
  ["sit", "ual1", "Sitting_Idle_Loop", "Sitting and lying"],
  ["sit and talk", "ual1", "Sitting_Talking_Loop", "Sitting and lying"],
  ["sit down", "ual1", "Sitting_Enter", "Sitting and lying"],
  ["stand up", "ual1", "Sitting_Exit", "Sitting and lying"],
  ["get up from lying", "ual2", "LayToIdle", "Sitting and lying"],
  ["dance", "ual1", "Dance_Loop", "Actions"],
  ["pick up", "ual1", "PickUp_Table", "Actions"],
  ["interact", "ual1", "Interact", "Actions"],
  ["open chest", "ual2", "Chest_Open", "Actions"],
  ["eat or drink", "ual2", "Consume", "Actions"],
  ["throw", "ual2", "OverhandThrow", "Actions"],
  ["repair (kneeling)", "ual1", "Fixing_Kneeling", "Work"],
  ["harvest", "ual2", "Farm_Harvest", "Work"],
  ["plant seeds", "ual2", "Farm_PlantSeed", "Work"],
  ["water plants", "ual2", "Farm_Watering", "Work"],
  ["chop wood", "ual2", "TreeChopping_Loop", "Work"],
  ["punch jab", "ual1", "Punch_Jab", "Combat"],
  ["punch cross", "ual1", "Punch_Cross", "Combat"],
  ["fight stance", "ual1", "Punch_Enter", "Combat"],
  ["hook", "ual2", "Melee_Hook", "Combat"],
  ["hook recover", "ual2", "Melee_Hook_Rec", "Combat"],
  ["sword idle", "ual1", "Sword_Idle", "Combat"],
  ["sword attack", "ual1", "Sword_Attack", "Combat"],
  ["sword slash A", "ual2", "Sword_Regular_A", "Combat"],
  ["sword slash A recover", "ual2", "Sword_Regular_A_Rec", "Combat"],
  ["sword slash B", "ual2", "Sword_Regular_B", "Combat"],
  ["sword slash B recover", "ual2", "Sword_Regular_B_Rec", "Combat"],
  ["sword slash C", "ual2", "Sword_Regular_C", "Combat"],
  ["sword combo", "ual2", "Sword_Regular_Combo", "Combat"],
  ["sword block", "ual2", "Sword_Block", "Combat"],
  ["sword dash", "ual2", "Sword_Dash_RM", "Combat"],
  ["shield idle", "ual2", "Idle_Shield_Loop", "Combat"],
  ["shield bash", "ual2", "Shield_OneShot", "Combat"],
  ["shield dash", "ual2", "Shield_Dash_RM", "Combat"],
  ["shield break", "ual2", "Idle_Shield_Break", "Combat"],
  ["pistol idle", "ual1", "Pistol_Idle_Loop", "Combat"],
  ["pistol aim", "ual1", "Pistol_Aim_Neutral", "Combat"],
  ["pistol aim up", "ual1", "Pistol_Aim_Up", "Combat"],
  ["pistol aim down", "ual1", "Pistol_Aim_Down", "Combat"],
  ["pistol shoot", "ual1", "Pistol_Shoot", "Combat"],
  ["pistol reload", "ual1", "Pistol_Reload", "Combat"],
  ["spell ready", "ual1", "Spell_Simple_Idle_Loop", "Combat"],
  ["spell raise", "ual1", "Spell_Simple_Enter", "Combat"],
  ["spell cast", "ual1", "Spell_Simple_Shoot", "Combat"],
  ["spell lower", "ual1", "Spell_Simple_Exit", "Combat"],
  ["hit to chest", "ual1", "Hit_Chest", "Reactions"],
  ["hit to head", "ual1", "Hit_Head", "Reactions"],
  ["knocked back", "ual2", "Hit_Knockback", "Reactions"],
  ["death", "ual1", "Death01", "Reactions"],
  ["zombie idle", "ual2", "Zombie_Idle_Loop", "Zombie"],
  ["zombie walk", "ual2", "Zombie_Walk_Fwd_Loop", "Zombie"],
  ["zombie scratch", "ual2", "Zombie_Scratch", "Zombie"],
];

export const CLIP_SPECS: ClipSpec[] = CLIPS.map(([name, archive, animation, category]) => ({ name, archive, animation, category, loop: /_Loop$/.test(animation) || animation === "Yes" }));

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
      ...(spec.category ? { category: spec.category } : {}),
    },
    data,
  };
}

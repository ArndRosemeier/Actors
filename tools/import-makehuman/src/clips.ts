/**
 * Turns CMU motion capture (BVH, Bruce Hahne's MotionBuilder-friendly
 * conversion, which starts every file with a T-pose frame) into
 * retargetable clips: per target bone, the world-space rotation change since
 * the T-pose, plus the bone's T-pose direction.
 */
import { type ClipDef, type Quat, type Vec3, normalize, quatAxisAngle, quatConjugate, quatMul, quatSlerp } from "@actors/core";
import { type Bvh, parseBvh, poseFrame, rotate } from "./bvh";

const CMU = "https://raw.githubusercontent.com/una-dinosauria/cmu-mocap/master/data";

export interface ClipSpec {
  name: string;
  url: string;
  /** Seconds into the motion (after the T-pose frame). */
  start?: number;
  end?: number;
  loop: boolean;
  source: string;
}

export const CLIP_SPECS: ClipSpec[] = [
  { name: "walk", url: `${CMU}/007/07_01.bvh`, loop: true, source: "CMU mocap 07_01 (walk)" },
  { name: "run", url: `${CMU}/009/09_01.bvh`, loop: true, source: "CMU mocap 09_01 (run)" },
  { name: "idle", url: `${CMU}/040/40_10.bvh`, start: 3, end: 13, loop: true, source: "CMU mocap 40_10 (wait for bus)" },
  { name: "dance", url: `${CMU}/005/05_02.bvh`, loop: true, source: "CMU mocap 05_02 (dance)" },
  { name: "wave", url: `${CMU}/013/13_26.bvh`, start: 0, end: 8, loop: true, source: "CMU mocap 13_26 (direct traffic, wave)" },
];

/** Target bone <- source joint, and the joint the bone points toward ("end" = the joint's end site). */
const MAP: [string, string, string][] = [
  ["pelvis", "Hips", "LowerBack"],
  ["spine_01", "LowerBack", "Spine"],
  ["spine_02", "Spine", "Spine1"],
  ["spine_03", "Spine1", "Neck"],
  ["neck_01", "Neck", "Head"],
  ["head", "Head", "end"],
  ["clavicle_l", "LeftShoulder", "LeftArm"],
  ["upperarm_l", "LeftArm", "LeftForeArm"],
  ["lowerarm_l", "LeftForeArm", "LeftHand"],
  ["hand_l", "LeftHand", "LeftFingerBase"],
  ["clavicle_r", "RightShoulder", "RightArm"],
  ["upperarm_r", "RightArm", "RightForeArm"],
  ["lowerarm_r", "RightForeArm", "RightHand"],
  ["hand_r", "RightHand", "RightFingerBase"],
  ["thigh_l", "LeftUpLeg", "LeftLeg"],
  ["calf_l", "LeftLeg", "LeftFoot"],
  ["foot_l", "LeftFoot", "LeftToeBase"],
  ["ball_l", "LeftToeBase", "end"],
  ["thigh_r", "RightUpLeg", "RightLeg"],
  ["calf_r", "RightLeg", "RightFoot"],
  ["foot_r", "RightFoot", "RightToeBase"],
  ["ball_r", "RightToeBase", "end"],
];

const FPS = 30;
const BLEND = 0.3; // seconds of loop crossfade

function jointIndex(bvh: Bvh, name: string): number {
  const i = bvh.joints.findIndex((j) => j.name === name);
  if (i < 0) throw new Error(`BVH has no joint ${name}`);
  return i;
}

export function importClip(spec: ClipSpec, text: string): { def: ClipDef; data: Float32Array } {
  const bvh = parseBvh(text);
  const tpose = poseFrame(bvh, bvh.frames[0]);
  const map = MAP.filter(([, s]) => bvh.joints.some((j) => j.name === s));
  const srcIdx = map.map(([, s]) => jointIndex(bvh, s));

  // Reference (T-pose) directions per mapped bone.
  const refDirs: number[] = [];
  map.forEach(([, s, toward], k) => {
    const i = srcIdx[k];
    let dir: Vec3;
    if (toward === "end") {
      const end = bvh.joints[i].endSite ?? [0, 1, 0];
      dir = rotate(tpose.rot[i], end);
    } else {
      const t = tpose.pos[jointIndex(bvh, toward)], h = tpose.pos[i];
      dir = [t[0] - h[0], t[1] - h[1], t[2] - h[2]];
    }
    refDirs.push(...normalize(dir));
    void s;
  });

  // Hip height above the feet in the T-pose: unit for root motion.
  const hips = jointIndex(bvh, "Hips");
  const footY = Math.min(...["LeftToeBase", "RightToeBase", "LeftFoot", "RightFoot"].map((n) => tpose.pos[jointIndex(bvh, n)][1]));
  const hipHeight = tpose.pos[hips][1] - footY;

  // Resample the motion (frames after the T-pose) to 30 fps.
  const srcFps = 1 / bvh.frameTime;
  const motion = bvh.frames.length - 1;
  const first = 1 + Math.round((spec.start ?? 0) * srcFps);
  const last = Math.min(motion, Math.round((spec.end ?? Infinity) * srcFps));
  const step = srcFps / FPS;
  const poses: ReturnType<typeof poseFrame>[] = [];
  for (let f = first; f <= last; f += step) poses.push(poseFrame(bvh, bvh.frames[Math.round(f)]));

  // Face +Z at the start: remove the initial heading.
  const fwd = rotate(poses[0].rot[hips], [0, 0, 1]);
  const yaw = Math.atan2(fwd[0], fwd[2]);
  const unYaw = quatAxisAngle([0, 1, 0], -yaw);
  const start = poses[0].pos[hips];

  type Frame = { q: Quat[]; root: Vec3 };
  let frames: Frame[] = poses.map((p) => ({
    q: srcIdx.map((i) => quatMul(unYaw, quatMul(p.rot[i], quatConjugate(tpose.rot[i])))),
    root: (() => {
      const d = rotate(unYaw, [p.pos[hips][0] - start[0], 0, p.pos[hips][2] - start[2]]);
      return [d[0] / hipHeight, (p.pos[hips][1] - tpose.pos[hips][1]) / hipHeight, d[2] / hipHeight] as Vec3;
    })(),
  }));

  // Seamless loop: crossfade the tail into the head.
  if (spec.loop) {
    const n = Math.min(Math.round(BLEND * FPS), Math.floor(frames.length / 3));
    const L = frames.length;
    const blended: Frame[] = [];
    for (let k = 0; k < L - n; k++) {
      if (k >= n) {
        blended.push(frames[k]);
        continue;
      }
      const a = frames[L - n + k], b = frames[k], t = k / n;
      blended.push({ q: a.q.map((q, j) => quatSlerp(q, b.q[j], t)), root: [0, 1, 2].map((c) => a.root[c] + (b.root[c] - a.root[c]) * t) as Vec3 });
    }
    blended.push({ q: blended[0].q, root: blended[0].root });
    frames = blended;
  }

  const stride = map.length * 4 + 3;
  const data = new Float32Array(frames.length * stride);
  frames.forEach((fr, f) => {
    fr.q.forEach((q, k) => data.set(q, f * stride + k * 4));
    data.set(fr.root, f * stride + map.length * 4);
  });

  return {
    def: {
      name: spec.name,
      file: `clips/${spec.name}.bin`,
      fps: FPS,
      frameCount: frames.length,
      loop: spec.loop,
      bones: map.map(([t]) => t),
      refDirs,
      rootBone: "pelvis",
      source: spec.source,
    },
    data,
  };
}

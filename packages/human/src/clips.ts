import type { AxisClip, AxisTrack } from "@actors/core";

/**
 * Small procedural clips for the "game_engine" rig, used to check skinning
 * and deformation. Real animation comes from the retargeted clips in the pack.
 * Axes are model space in the bind pose: +X = character's left, +Y = up, +Z = forward.
 */
const X: [number, number, number] = [1, 0, 0];
const Y: [number, number, number] = [0, 1, 0];
const Z: [number, number, number] = [0, 0, 1];

function track(bone: string, axis: [number, number, number], ...pairs: [number, number][]): AxisTrack {
  return { bone, axis, keys: pairs.map(([t, deg]) => ({ t, deg })) };
}

// Bring the arms down from the base A-pose to relaxed at the sides.
const armsDown = (extra = 0): AxisTrack[] => [
  track("upperarm_l", Z, [0, -38 - extra], [1, -38 - extra]),
  track("upperarm_r", Z, [0, 38 + extra], [1, 38 + extra]),
];

export const IDLE: AxisClip = {
  name: "idle",
  duration: 4,
  tracks: [
    ...armsDown(),
    track("spine_02", X, [0, 0], [2, 1.5], [4, 0]),
    track("spine_03", X, [0, 0], [2, 1.5], [4, 0]),
    track("neck_01", Y, [0, -4], [2, 4], [4, -4]),
    track("pelvis", Z, [0, -1.5], [2, 1.5], [4, -1.5]),
    track("lowerarm_l", X, [0, -8], [2, -12], [4, -8]),
    track("lowerarm_r", X, [0, -8], [2, -12], [4, -8]),
  ],
};

const s = 1.1; // stride duration in seconds (full cycle)
export const WALK: AxisClip = {
  name: "walk",
  duration: s,
  tracks: [
    ...armsDown(4),
    track("thigh_l", X, [0, -25], [s / 2, 22], [s, -25]),
    track("thigh_r", X, [0, 22], [s / 2, -25], [s, 22]),
    track("calf_l", X, [0, 5], [s * 0.25, 55], [s / 2, 5], [s, 5]),
    track("calf_r", X, [0, 5], [s / 2, 5], [s * 0.75, 55], [s, 5]),
    track("foot_l", X, [0, -10], [s / 2, 15], [s, -10]),
    track("foot_r", X, [0, 15], [s / 2, -10], [s, 15]),
    track("upperarm_l", X, [0, 20], [s / 2, -20], [s, 20]),
    track("upperarm_r", X, [0, -20], [s / 2, 20], [s, -20]),
    track("lowerarm_l", X, [0, -20], [s / 2, -10], [s, -20]),
    track("lowerarm_r", X, [0, -10], [s / 2, -20], [s, -10]),
    track("spine_02", Y, [0, 6], [s / 2, -6], [s, 6]),
    track("pelvis", Y, [0, -5], [s / 2, 5], [s, -5]),
  ],
};

/**
 * Riding seat (for a horse, see `Mount` in @actors/three): thighs forward and
 * apart round the barrel, knees bent, heels down, upright back, hands low in
 * front holding the reins. A held pose with a little breathing in the back.
 */
export const RIDE: AxisClip = {
  name: "ride",
  duration: 4,
  tracks: [
    track("thigh_l", X, [0, -62], [4, -62]),
    track("thigh_r", X, [0, -62], [4, -62]),
    track("thigh_l", Z, [0, 24], [4, 24]),
    track("thigh_r", Z, [0, -24], [4, -24]),
    track("calf_l", X, [0, 78], [4, 78]),
    track("calf_r", X, [0, 78], [4, 78]),
    track("foot_l", X, [0, -14], [4, -14]),
    track("foot_r", X, [0, -14], [4, -14]),
    track("foot_l", Y, [0, 10], [4, 10]),
    track("foot_r", Y, [0, -10], [4, -10]),
    track("spine_02", X, [0, 3], [2, 4.5], [4, 3]),
    track("spine_03", X, [0, 2], [2, 3], [4, 2]),
    track("neck_01", X, [0, -4], [4, -4]),
    // Arms: down from the A-pose and a little forward, forearms turned in so the hands meet low in front (the reins).
    ...armsDown(4),
    track("upperarm_l", X, [0, -15], [4, -15]),
    track("upperarm_r", X, [0, -15], [4, -15]),
    track("lowerarm_l", X, [0, -10], [4, -10]),
    track("lowerarm_r", X, [0, -10], [4, -10]),
    track("lowerarm_l", Z, [0, -50], [4, -50]),
    track("lowerarm_r", Z, [0, 50], [4, 50]),
  ],
};

export const CLIPS: AxisClip[] = [IDLE, WALK];

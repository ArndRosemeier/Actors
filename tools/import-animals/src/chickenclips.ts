/**
 * Chicken clips, made procedurally on the hen's placed bird rig (Mesh2Motion's
 * CC0 bird skeleton; its own clips are flying-bird clips from a spread-wing
 * rest pose, so they don't fit a hen with folded wings). Each frame is posed
 * with forward kinematics plus two-bone IK for the legs (knee to foot) and
 * the neck (neck base to the back of the skull), like the squirrel's clips.
 * The rest pose is the reference pose, so a clip of zero turns is the rest.
 *
 *   idle     standing, breathing, looking about in quick jerks
 *   walk     the head-bobbing walk (in place): the head holds still, then thrusts forward
 *   run      leaning forward, neck out, wings a little open
 *   peck     tipping forward to peck at the ground three times
 *   scratch  raking the ground back with each foot, then looking down at it
 *   flap     stretching up and beating the wings
 *   sit      sitting down on folded legs (brooding)
 */
import { type ClipDef, type Quat, type Vec3, normalize, quatAxisAngle, quatMul } from "@actors/core";
import type { Rig } from "./rig";
import { Pose } from "./squirrelclips";

const FPS = 30;
const TAU = Math.PI * 2;
const X: Vec3 = [1, 0, 0], Y: Vec3 = [0, 1, 0], Z: Vec3 = [0, 0, 1];
const SIDES = ["L", "R"] as const;
type Side = (typeof SIDES)[number];

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const lerpV = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const wrap = (x: number) => x - Math.floor(x);
/** 1 between a and b (eased in and out over `e`), else 0. */
const hold = (a: number, b: number, x: number, e = 0.03) => smooth(a - e, a, x) * (1 - smooth(b, b + e, x));
const sideSign = (s: Side) => (s === "L" ? 1 : -1);

interface Rest {
  foot: Record<Side, Vec3>;
  /** Back of the skull (the head bone's head) and the beak tip. */
  skull: Vec3;
  beak: Vec3;
  hipY: number;
  /** Rest direction of every wing bone (for blending to the spread wing). */
  wingDir: Record<string, Vec3>;
}

const WING_CHAIN = ["wing_1", "wing_2", "wing_3", "wing_4", "wing_5", "wing_tip"];
const FEATHERS = ["wing_feather_1_1", "wing_feather_1_2", "wing_feather_2_1", "wing_feather_2_2", "wing_feather_3_1", "wing_feather_3_2", "wing_feather_4_1", "wing_feather_4_2"];

/** Directions of the spread wing (left side; x mirrors on the right). */
const SPREAD: Record<string, Vec3> = {
  wing_1: [0.85, 0.38, -0.2],
  wing_2: [0.95, 0.12, 0.2],
  wing_3: [0.97, 0, -0.18],
  wing_4: [0.92, -0.04, -0.36],
  wing_5: [0.84, -0.06, -0.52],
  wing_tip: [0.75, -0.06, -0.62],
  wing_feather_1_1: [0.15, -0.12, -1],
  wing_feather_1_2: [0.15, -0.12, -1],
  wing_feather_2_1: [0.3, -0.12, -1],
  wing_feather_2_2: [0.3, -0.12, -1],
  wing_feather_3_1: [0.55, -0.1, -1],
  wing_feather_3_2: [0.6, -0.1, -1],
  wing_feather_4_1: [0.75, -0.08, -1],
  wing_feather_4_2: [0.8, -0.08, -1],
};

/**
 * Opens the wings: `open` 0 (folded, the rest) .. 1 (spread), then beats them by `beat` radians
 * (positive raises them) about the shoulder's fore-aft axis.
 */
function wings(p: Pose, rest: Rest, open: number, beat = 0, sides: readonly Side[] = SIDES): void {
  if (open <= 0 && !beat) return;
  for (const s of sides) {
    const k = sideSign(s);
    for (const b of [...WING_CHAIN, ...FEATHERS]) {
      const spread = SPREAD[b];
      const target = normalize(lerpV(rest.wingDir[`${b}_${s}`], [spread[0] * k, spread[1], spread[2]], open));
      p.aim(`${b}_${s}`, target);
    }
    p.turn(`wing_1_${s}`, Z, beat * k);
  }
}

/** Plants both feet at `foot(side)` (toes pitched by `pitch`, curled by `curl`); the knee swings with the foot. */
function legs(p: Pose, rest: Rest, foot: (s: Side) => Vec3, pitch: (s: Side) => number = () => 0, curl: (s: Side) => number = () => 0): void {
  for (const s of SIDES) {
    // Undo whatever the body did to the thigh, then swing the knee after the foot.
    p.setWorld(`UpperLeg_${s}`, [0, 0, 0, 1]);
    const target = foot(s);
    const dz = target[2] - rest.foot[s][2];
    p.turn(`UpperLeg_${s}`, X, -4.5 * dz - 2 * Math.max(0, target[1] - rest.foot[s][1]));
    p.ik(`LowerLeg_${s}`, `AnkleLeg_${s}`, target);
    p.setWorld(`Foot_${s}`, quatAxisAngle(X, pitch(s)));
    p.turn(`Toes_${s}`, X, curl(s));
    p.turn(`Toes_tip_${s}`, X, curl(s) * 0.8);
  }
}

/** Puts the back of the skull at `skull` (neck by IK) and turns the head: pitch (+: beak down), yaw (+: to the left), roll. */
function head(p: Pose, skull: Vec3, pitch: number, yaw = 0, roll = 0): void {
  p.ik("spine_2", "spine_3", skull);
  let q: Quat = quatAxisAngle(X, pitch);
  if (yaw) q = quatMul(quatAxisAngle(Y, yaw), q);
  if (roll) q = quatMul(q, quatAxisAngle(Z, roll));
  p.setWorld("head", q);
}

/** Pitches the body forward (+) about the hips, the tail following a little less. */
function lean(p: Pose, angle: number, tailLift = 0): void {
  p.turn("hips", X, angle);
  p.turn("tail_1", X, -angle * 0.3 - tailLift);
}

/** Head look-about as held poses with quick jerks between them (keys: time, yaw, pitch, roll). */
function jerks(keys: [number, number, number, number][], t: number, e = 0.035): [number, number, number] {
  let out: [number, number, number] = [keys[0][1], keys[0][2], keys[0][3]];
  for (let i = 1; i < keys.length; i++) {
    const w = smooth(keys[i][0] - e, keys[i][0], t);
    if (w <= 0) break;
    out = [out[0] + (keys[i][1] - out[0]) * w, out[1] + (keys[i][2] - out[1]) * w, out[2] + (keys[i][3] - out[2]) * w];
  }
  return out;
}

type Clip = { name: string; seconds: number; loop: boolean; category: string; pose: (pose: Pose, t: number, rest: Rest) => void };

/** One leg's step: stance slides back along the ground, swing lifts and carries it forward. */
function step(phase: number, stance: number, reach: number, lift: number) {
  const u = wrap(phase);
  if (u < stance) return { z: reach - 2 * reach * (u / stance), y: 0, swing: 0 };
  const v = (u - stance) / (1 - stance);
  return { z: -reach + 2 * reach * smooth(0.1, 0.9, v), y: lift * Math.sin(Math.PI * Math.min(1, v * 1.15)), swing: Math.sin(Math.PI * v) };
}

const CLIPS: Clip[] = [
  {
    name: "idle", seconds: 6, loop: true, category: "Idle",
    pose(p, t, rest) {
      const ph = t / 6;
      p.root = [0, 0.0015 * Math.sin(TAU * ph * 9), 0];
      p.turn("spine_0", X, 0.012 * Math.sin(TAU * ph * 9));
      const [yaw, pitch, roll] = jerks([
        [0, 0, 0, 0], [0.1, 0.45, -0.05, 0.1], [0.22, 0.2, 0.1, -0.05], [0.34, -0.35, 0, 0.25], [0.46, -0.1, 0.15, 0],
        [0.56, 0.05, 0.3, 0], [0.62, 0.05, 0.05, 0], [0.74, 0.6, -0.1, -0.3], [0.86, 0.15, 0, 0], [0.97, 0, 0, 0],
      ], ph);
      // The neck turns and lifts with the head a little.
      const skull = add(rest.skull, [0.012 * Math.sin(yaw), 0.004 * Math.cos(TAU * ph * 3) - 0.01 * Math.max(0, pitch), 0.004 * Math.max(0, pitch)]);
      head(p, skull, pitch, yaw, roll);
      // A shake of the tail now and then.
      p.turn("tail_1", Y, 0.12 * hold(0.66, 0.7, ph, 0.01) * Math.sin(TAU * ph * 40));
      legs(p, rest, (s) => rest.foot[s]);
    },
  },
  {
    name: "walk", seconds: 1.1, loop: true, category: "Locomotion",
    pose(p, t, rest) {
      const ph = t / 1.1;
      const reach = 0.05;
      const f = (s: Side) => step(ph + (s === "L" ? 0 : 0.5), 0.6, reach, 0.045);
      // Body: low, rolling a little onto the standing leg, bobbing with the steps.
      p.root = [0, -0.01 + 0.004 * Math.cos(TAU * ph * 2), 0];
      p.turn("hips", Z, 0.05 * Math.sin(TAU * ph));
      lean(p, 0.06);
      // Head bob: held still over the ground (sliding back on the body), then thrust forward, twice a cycle.
      const u = wrap(ph * 2);
      const back = u < 0.7 ? u / 0.7 : 1 - smooth(0.7, 1, u);
      const skull = add(rest.skull, [0, -0.008, 0.035 - 0.06 * back]);
      head(p, skull, 0.05, 0.05 * Math.sin(TAU * ph), 0);
      p.turn("tail_1", Y, 0.06 * Math.sin(TAU * ph));
      legs(
        p,
        rest,
        (s) => add(rest.foot[s], [0, f(s).y, f(s).z]),
        (s) => 0.7 * f(s).swing,
        (s) => 0.9 * f(s).swing,
      );
    },
  },
  {
    name: "run", seconds: 0.5, loop: true, category: "Locomotion",
    pose(p, t, rest) {
      const ph = t / 0.5;
      const f = (s: Side) => step(ph + (s === "L" ? 0 : 0.5), 0.45, 0.07, 0.055);
      p.root = [0, -0.016 + 0.01 * Math.abs(Math.sin(TAU * ph)), 0];
      lean(p, 0.35, 0.15);
      p.turn("hips", Z, 0.04 * Math.sin(TAU * ph));
      head(p, add(rest.skull, [0, -0.045, 0.06]), -0.25, 0, 0);
      wings(p, rest, 0.18, 0.15 + 0.12 * Math.sin(TAU * ph * 2));
      legs(
        p,
        rest,
        (s) => add(rest.foot[s], [0, f(s).y, f(s).z]),
        (s) => 0.8 * f(s).swing,
        (s) => 1.0 * f(s).swing,
      );
    },
  },
  {
    name: "peck", seconds: 2.4, loop: true, category: "Actions",
    pose(p, t, rest) {
      const ph = t / 2.4;
      // Down (0.1 .. 0.25), three pecks, back up (0.8 .. 0.95).
      const down = smooth(0.06, 0.24, ph) * (1 - smooth(0.78, 0.95, ph));
      p.root = [0, -0.018 * down, 0];
      lean(p, 0.55 * down, 0.2 * down);
      p.turn("spine_1", X, 0.25 * down);
      // The beak aims at a point on the ground in front of the feet; each peck reaches down to it.
      const pecks = [0.32, 0.47, 0.62].reduce((a, c) => Math.max(a, hold(c, c + 0.03, ph, 0.04)), 0);
      const ground: Vec3 = [0.004 * Math.sin(TAU * ph * 2), 0.006, rest.foot.L[2] + 0.13];
      const headLen = Math.hypot(...sub(rest.beak, rest.skull));
      const pitch = 1.25 * down;
      // Skull above the target along the head's pitched direction, a little higher between pecks.
      const dir: Vec3 = [0, -Math.sin(pitch - 0.2), Math.cos(pitch - 0.2)];
      const atGround = sub(ground, scale(dir, headLen * 0.96));
      const up = 0.035 * (1 - pecks);
      const skull = lerpV(rest.skull, add(atGround, [0, up, -up * 0.5]), down);
      head(p, skull, pitch, 0.15 * Math.sin(TAU * ph * 1.5) * down, 0);
      p.turn("mouth_lower", X, 0.15 * pecks);
      legs(p, rest, (s) => rest.foot[s]);
    },
  },
  {
    name: "scratch", seconds: 3.2, loop: true, category: "Actions",
    pose(p, t, rest) {
      const ph = t / 3.2;
      // Rake with the left foot twice, the right foot twice, then look down at the ground.
      const rake = (s: Side) => {
        const start = s === "L" ? 0.05 : 0.33;
        const u = (ph - start) / 0.26;
        if (u < 0 || u > 1) return { z: 0, y: 0, curl: 0, pitch: 0 };
        const w = wrap(u * 2);
        // Forward and up quickly, then a hard scrape back along the ground.
        const fwd = w < 0.35 ? smooth(0, 0.35, w) : 1 - smooth(0.35, 1, w);
        const y = w < 0.35 ? 0.035 * Math.sin(Math.PI * (w / 0.35)) : 0;
        return { z: -0.04 + 0.1 * fwd, y, curl: w < 0.35 ? 0.8 : -0.2, pitch: w < 0.35 ? 0.4 : -0.15 };
      };
      const look = smooth(0.62, 0.7, ph) * (1 - smooth(0.92, 0.99, ph));
      p.root = [0, -0.006, 0];
      lean(p, 0.1 + 0.4 * look, 0.1 * look);
      const shift = (s: Side) => (rake(s).y || rake(s).z ? 1 : 0);
      p.turn("hips", Z, 0.05 * (shift("R") - shift("L")));
      const skull = lerpV(add(rest.skull, [0, -0.01, 0.01]), add(rest.skull, [0, -0.08, 0.05]), look);
      head(p, skull, 0.15 + 0.9 * look, 0.25 * Math.sin(TAU * ph * 2) * look, 0);
      legs(
        p,
        rest,
        (s) => add(rest.foot[s], [0, rake(s).y, rake(s).z]),
        (s) => rake(s).pitch,
        (s) => rake(s).curl,
      );
    },
  },
  {
    name: "flap", seconds: 1.8, loop: true, category: "Actions",
    pose(p, t, rest) {
      const ph = t / 1.8;
      const up = smooth(0.05, 0.2, ph) * (1 - smooth(0.78, 0.95, ph));
      const open = smooth(0.12, 0.25, ph) * (1 - smooth(0.7, 0.85, ph));
      // Stand tall: the body tips up, the neck stretches.
      p.root = [0, 0.012 * up, 0];
      lean(p, -0.35 * up, 0.2 * up);
      const beat = 0.75 * Math.sin(TAU * (ph - 0.2) * 5.5) * open;
      wings(p, rest, open, beat + 0.15 * open);
      head(p, add(rest.skull, [0, 0.025 * up, -0.012 * up]), -0.15 * up, 0, 0);
      legs(p, rest, (s) => rest.foot[s]);
    },
  },
  {
    name: "sit", seconds: 4, loop: true, category: "Idle",
    pose(p, t, rest) {
      const ph = t / 4;
      // Settle on the folded legs: the body rests just above the ground, the shanks lie forward under it.
      const drop = rest.hipY - 0.13;
      p.root = [0, -drop + 0.0015 * Math.sin(TAU * ph * 4), 0];
      p.turn("spine_0", X, 0.01 * Math.sin(TAU * ph * 4));
      lean(p, -0.05);
      const [yaw, pitch] = jerks([[0, 0, 0.05, 0], [0.25, 0.35, 0, 0], [0.5, -0.2, 0.1, 0], [0.75, 0, 0.05, 0]], ph);
      head(p, add(rest.skull, [0, -0.03, -0.01]), pitch, yaw, 0);
      legs(
        p,
        rest,
        (s) => add(rest.foot[s], [0, 0.012, 0.035]),
        () => 0.25,
        () => 0.4,
      );
    },
  },
];

/** The chicken's clips on its rig. */
export function chickenClips(rig: Rig): { def: ClipDef; data: Float32Array }[] {
  const names = rig.bones.map((b) => b.name);
  const refDirs = rig.bones.flatMap((b) => normalize(sub(b.tail, b.head)));
  const hipY = rig.bones[rig.index.get("hips")!].head[1];
  const p0 = new Pose(rig);
  const wingDir: Record<string, Vec3> = {};
  for (const s of SIDES) for (const b of [...WING_CHAIN, ...FEATHERS]) wingDir[`${b}_${s}`] = normalize(sub(p0.tail(`${b}_${s}`), p0.head(`${b}_${s}`)));
  const rest: Rest = {
    foot: { L: p0.tail("AnkleLeg_L"), R: p0.tail("AnkleLeg_R") },
    skull: p0.head("head"),
    beak: p0.tail("mouth_upper_tip"),
    hipY,
    wingDir,
  };
  return CLIPS.map((clip) => {
    const frameCount = Math.max(2, Math.round(clip.seconds * FPS) + 1);
    const stride = names.length * 4 + 3;
    const data = new Float32Array(frameCount * stride);
    for (let f = 0; f < frameCount; f++) {
      const pose = new Pose(rig);
      clip.pose(pose, (f / (frameCount - 1)) * clip.seconds, rest);
      pose.D.forEach((q, k) => {
        const o = f * stride + k * 4;
        if (f > 0 && q[0] * data[o - stride] + q[1] * data[o - stride + 1] + q[2] * data[o - stride + 2] + q[3] * data[o - stride + 3] < 0) q = q.map((v) => -v) as Quat;
        data.set(q, o);
      });
      data.set(scale(pose.root, 1 / hipY), f * stride + names.length * 4);
    }
    return {
      def: {
        name: clip.name,
        file: `clips/${clip.name}.bin`,
        fps: (frameCount - 1) / clip.seconds,
        frameCount,
        loop: clip.loop,
        bones: names,
        refDirs,
        rootBone: "hips",
        source: "Procedural chicken clip (Actors, MIT) on Mesh2Motion's bird rig (CC0)",
        category: clip.category,
      },
      data,
    };
  });
}

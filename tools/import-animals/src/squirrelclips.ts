/**
 * Squirrel clips, made procedurally on the squirrel's re-posed quadruped rig
 * (the same bones as the dog, so they are ordinary retargetable clips; see
 * @actors/core ClipDef). Each frame is posed with forward kinematics (world
 * space turns of bone chains) plus two-bone IK that keeps the feet planted or
 * moves them along a step path. Reference directions are the squirrel's own
 * rest directions, so its rest pose is the clip's reference pose.
 *
 *   idle   crouched, breathing, looking about, the odd tail twitch
 *   alert  sitting up on the haunches, forepaws at the chest, scanning
 *   eat    sitting up, nibbling something held in the forepaws
 *   hop    the bounding gait (in place; hind feet land together, then the front)
 *   run    a faster, longer bound with the tail streaming behind
 *   flick  the alarm tail flick
 */
import { type ClipDef, type Quat, type Vec3, normalize, quatAxisAngle, quatConjugate, quatMul } from "@actors/core";
import type { Rig } from "./rig";

const FPS = 30;
const TAU = Math.PI * 2;
const X: Vec3 = [1, 0, 0], Y: Vec3 = [0, 1, 0], Z: Vec3 = [0, 0, 1];

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Phase distance on a loop (0..0.5). */
const wrap = (x: number) => x - Math.floor(x);

function rotate(q: Quat, v: Vec3): Vec3 {
  const p = quatMul(quatMul(q, [v[0], v[1], v[2], 0]), quatConjugate(q));
  return [p[0], p[1], p[2]];
}

function fromTo(a: Vec3, b: Vec3): Quat {
  const u = normalize(a), v = normalize(b);
  const d = dot(u, v);
  if (d < -0.999999) return quatAxisAngle(Math.abs(u[0]) < 0.9 ? normalize([0, -u[2], u[1]]) : normalize([u[2], 0, -u[0]]), Math.PI);
  const c: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const q: Quat = [c[0], c[1], c[2], 1 + d];
  const l = Math.hypot(...q);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/** A pose under construction: per bone its world rotation since the rest pose, plus a root offset. */
export class Pose {
  readonly D: Quat[];
  root: Vec3 = [0, 0, 0];
  private readonly subtree: number[][];

  constructor(private readonly rig: Rig) {
    this.D = rig.bones.map(() => [0, 0, 0, 1] as Quat);
    const children = rig.bones.map(() => [] as number[]);
    rig.bones.forEach((b, i) => b.parent >= 0 && children[b.parent].push(i));
    const collect = (i: number): number[] => [i, ...children[i].flatMap(collect)];
    this.subtree = rig.bones.map((_, i) => collect(i));
  }

  private i(name: string): number {
    const i = this.rig.index.get(name);
    if (i === undefined) throw new Error(`No bone ${name}`);
    return i;
  }

  headOf(i: number): Vec3 {
    const b = this.rig.bones[i];
    if (b.parent < 0) return add(b.head, this.root);
    const p = this.rig.bones[b.parent];
    return add(this.headOf(b.parent), rotate(this.D[b.parent], sub(b.head, p.head)));
  }

  head(name: string): Vec3 {
    return this.headOf(this.i(name));
  }

  tail(name: string): Vec3 {
    const i = this.i(name), b = this.rig.bones[i];
    return add(this.headOf(i), rotate(this.D[i], sub(b.tail, b.head)));
  }

  /** Turns a bone and everything below it by q (world space, about the bone's head). */
  apply(name: string, q: Quat): void {
    for (const j of this.subtree[this.i(name)]) this.D[j] = quatMul(q, this.D[j]);
  }

  turn(name: string, axis: Vec3, angle: number): void {
    if (angle) this.apply(name, quatAxisAngle(normalize(axis), angle));
  }

  /** Points the bone along `dir` (shortest arc), carrying its children. */
  aim(name: string, dir: Vec3): void {
    this.apply(name, fromTo(sub(this.tail(name), this.head(name)), dir));
  }

  /** Gives the bone this world rotation since rest (children follow). */
  setWorld(name: string, q: Quat): void {
    this.apply(name, quatMul(q, quatConjugate(this.D[this.i(name)])));
  }

  /**
   * Two-bone IK: turns `upper` and `lower` so the tail of `lower` reaches
   * `target`, bending in the plane of the current bend (the knee or elbow
   * keeps its side). Out-of-reach targets leave the limb straight toward them.
   */
  ik(upper: string, lower: string, target: Vec3): void {
    const A = this.head(upper), B = this.head(lower), C = this.tail(lower);
    const a = len(sub(B, A)), b = len(sub(C, B));
    const toT = sub(target, A);
    const d = Math.max(Math.abs(a - b) + 1e-4, Math.min(a + b - 1e-4, len(toT)));
    const dir = normalize(toT);
    const along = (a * a - b * b + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, a * a - along * along));
    let pole = sub(B, A);
    pole = sub(pole, scale(dir, dot(pole, dir)));
    if (len(pole) < 1e-6) pole = [0, 0, 1];
    const knee = add(A, add(scale(dir, along), scale(normalize(pole), h)));
    this.apply(upper, fromTo(sub(B, A), sub(knee, A)));
    const end = add(A, scale(dir, d));
    this.apply(lower, fromTo(sub(this.tail(lower), knee), sub(end, knee)));
  }
}

interface Rest {
  heel: Record<"L" | "R", Vec3>;
  wrist: Record<"L" | "R", Vec3>;
}

const SIDES = ["L", "R"] as const;

/** Keeps the hind feet flat with the heels at `heel` (per side), toes pitched down by `pitch`. */
function hindFeet(pose: Pose, heel: (s: "L" | "R") => Vec3, pitch: (s: "L" | "R") => number = () => 0): void {
  for (const s of SIDES) {
    pose.ik(`Back_Leg_Upper_${s}`, `Back_Leg_Lower_${s}`, heel(s));
    pose.setWorld(`Back_Leg_Ankle_${s}`, quatAxisAngle(X, pitch(s)));
  }
}

function frontFeet(pose: Pose, wrist: (s: "L" | "R") => Vec3, pitch: (s: "L" | "R") => number = () => 0): void {
  for (const s of SIDES) {
    pose.ik(`Front_Leg_Upper_${s}`, `Front_Leg_Lower_${s}`, wrist(s));
    pose.setWorld(`Front_Leg_Ankle_${s}`, quatAxisAngle(X, pitch(s)));
  }
}

/** The tail swaying as a wave running from the root to the tip. */
function tailWave(pose: Pose, axis: Vec3, amp: number, phase: number, lag = 0.9, grow = 1.2): void {
  ["Tail_Base", "Tail_Mid", "Tail_Mid.001", "Tail_End", "Tail_Tip"].forEach((n, k) => pose.turn(n, axis, amp * grow ** k * Math.sin(phase - k * lag) / 2));
}

/** Sitting up on the haunches: the body pitched up about the rump, head level, tail up behind. `tall` 0..1. */
function sitUp(pose: Pose, rest: Rest, tall: number, hunch: number): void {
  pose.root = [0, -0.006 * tall, -0.004 * tall];
  pose.turn("Hips", X, -1.0 * tall);
  pose.turn("Spine_2", X, 0.12 * hunch);
  pose.turn("Spine_2.001", X, 0.1 * tall + 0.15 * hunch);
  pose.turn("Spine_3", X, 0.25 * tall + 0.1 * hunch);
  pose.turn("Head", X, 0.35 * tall + 0.15 * hunch);
  // Tail: stays up against the back.
  pose.turn("Tail_Base", X, 0.75 * tall);
  pose.turn("Tail_Mid", X, -0.2 * tall);
  hindFeet(pose, (s) => rest.heel[s]);
}

function restOf(pose: Pose): Rest {
  return {
    heel: { L: pose.tail("Back_Leg_Lower_L"), R: pose.tail("Back_Leg_Lower_R") },
    wrist: { L: pose.tail("Front_Leg_Lower_L"), R: pose.tail("Front_Leg_Lower_R") },
  };
}

type Clip = { name: string; seconds: number; loop: boolean; category: string; pose: (pose: Pose, t: number, rest: Rest) => void };

const CLIPS: Clip[] = [
  {
    name: "idle", seconds: 4, loop: true, category: "Idle",
    pose(p, t, rest) {
      const ph = t / 4;
      p.turn("Spine_1", X, 0.015 * Math.sin(TAU * ph * 5));
      // Look left, then right, with a little tilt.
      const look = 0.4 * (smooth(0.1, 0.18, ph) - smooth(0.36, 0.44, ph)) - 0.35 * (smooth(0.55, 0.63, ph) - smooth(0.82, 0.9, ph));
      p.turn("Spine_4", Y, look * 0.5);
      p.turn("Head", Y, look * 0.5);
      p.turn("Head", Z, -look * 0.25);
      p.turn("Head", X, -0.08 * (smooth(0.45, 0.5, ph) - smooth(0.52, 0.56, ph)));
      // Ear twitch.
      p.turn("Ear_L", X, -0.25 * (smooth(0.3, 0.32, ph) - smooth(0.33, 0.36, ph)));
      // Tail: slow sway and one quick twitch.
      tailWave(p, Y, 0.06, TAU * ph * 2);
      tailWave(p, X, 0.3 * (smooth(0.68, 0.7, ph) - smooth(0.72, 0.78, ph)), TAU * ph * 12, 0.7);
      hindFeet(p, (s) => rest.heel[s]);
      frontFeet(p, (s) => rest.wrist[s]);
    },
  },
  {
    name: "alert", seconds: 3, loop: true, category: "Idle",
    pose(p, t, rest) {
      const ph = t / 3;
      sitUp(p, rest, 1, 0);
      // Forepaws held against the chest.
      for (const s of SIDES) {
        p.aim(`Front_Leg_Upper_${s}`, [0, -0.9, -0.15]);
        p.aim(`Front_Leg_Lower_${s}`, [0, 0.35, 0.94]);
        p.aim(`Front_Leg_Ankle_${s}`, [0, -0.7, 0.7]);
        p.aim(`Front_Leg_Foot_${s}`, [0, -1, 0.2]);
      }
      p.turn("Spine_1", X, 0.012 * Math.sin(TAU * ph * 4));
      const look = 0.45 * Math.sin(TAU * ph) * smooth(0.05, 0.2, Math.abs(Math.sin(TAU * ph)));
      p.turn("Spine_4", Y, look * 0.4);
      p.turn("Head", Y, look * 0.6);
      tailWave(p, Y, 0.05, TAU * ph * 2);
    },
  },
  {
    name: "eat", seconds: 2, loop: true, category: "Actions",
    pose(p, t, rest) {
      const ph = t / 2;
      sitUp(p, rest, 0.9, 1);
      p.turn("Head", X, 0.05 * Math.sin(TAU * ph * 2));
      p.turn("Head", Y, 0.08 * Math.sin(TAU * ph));
      // Forepaws up under the mouth, turning the food.
      const mouth = p.tail("Chin");
      for (const s of SIDES) {
        const k = s === "L" ? 1 : -1;
        p.aim(`Front_Leg_Upper_${s}`, [0.1 * k, -0.9, 0.3]);
        p.ik(`Front_Leg_Upper_${s}`, `Front_Leg_Lower_${s}`, add(mouth, [0.008 * k, -0.016 + 0.002 * Math.sin(TAU * ph * 2 + k), -0.006]));
        p.aim(`Front_Leg_Ankle_${s}`, [-0.3 * k, 0.8, 0.5]);
        p.aim(`Front_Leg_Foot_${s}`, [-0.6 * k, 0.6, 0.2]);
      }
      // Chewing.
      p.turn("Chin", X, 0.1 + 0.1 * Math.sin(TAU * ph * 10));
      tailWave(p, Y, 0.04, TAU * ph);
    },
  },
  ...[
    { name: "hop", seconds: 0.44, stride: 1, lift: 0.032 },
    { name: "run", seconds: 0.32, stride: 1.45, lift: 0.042 },
  ].map(({ name, seconds, stride, lift }): Clip => ({
    name, seconds, loop: true, category: "Locomotion",
    pose(p, t, rest) {
      const ph = t / seconds;
      const run = stride > 1 ? 1 : 0;
      // Flight after the hind feet push off (0.25 .. 0.55).
      const flight = Math.max(0, Math.sin((Math.PI * (ph - 0.22)) / 0.36)) * (ph > 0.22 && ph < 0.58 ? 1 : 0);
      p.root = [0, lift * flight - 0.004, 0];
      // Body pitch: front up at push-off, down on the front landing, level when gathered.
      const pitch = -0.28 * Math.sin(TAU * (ph - 0.05)) * stride ** 0.5;
      p.turn("Hips", X, pitch);
      // Back flexes (arches) when the hind feet come forward, extends in flight.
      const flex = 0.5 + 0.5 * Math.cos(TAU * (ph - 0.95));
      p.turn("Spine_1", X, 0.22 * (flex - 0.5) * stride);
      p.turn("Spine_2.001", X, 0.1 * (flex - 0.5));
      // Head steadied against the pitch.
      p.turn("Spine_3", X, -pitch * 0.5);
      p.turn("Head", X, -pitch * 0.4);
      p.turn("Ear_L", X, 0.15 * run);
      p.turn("Ear_R", X, 0.15 * run);
      // Tail: laid back when running, waving with the bound.
      p.turn("Tail_Mid", X, -0.9 * run);
      p.turn("Tail_End", X, -0.4 * run);
      tailWave(p, X, 0.35, TAU * ph, 0.8, 1.1);
      // Feet: stance slides back along the ground, swing arcs forward.
      const step = (phase: number, start: number, stance: number, from: number, to: number, height: number) => {
        const u = wrap(phase - start);
        if (u < stance) return { z: from + (to - from) * (u / stance), y: 0, swing: 0, u: u / stance };
        const v = (u - stance) / (1 - stance);
        const e = smooth(0, 1, v);
        return { z: to + (from - to) * e, y: height * Math.sin(Math.PI * v), swing: Math.sin(Math.PI * v), u: 1 };
      };
      hindFeet(
        p,
        (s) => {
          const f = step(ph + (s === "L" ? 0 : 0.025), 0.85, 0.42, 0.045 * stride, -0.035 * stride, 0.03);
          // Heel rises at the end of the stance (push off from the toes) and in the swing.
          return add(rest.heel[s], [0, f.y + 0.02 * smooth(0.5, 1, f.u), f.z]);
        },
        (s) => {
          const f = step(ph + (s === "L" ? 0 : 0.025), 0.85, 0.42, 0, 0, 0);
          return 0.7 * smooth(0.5, 1, f.u) * (1 - f.swing * 0.5);
        },
      );
      frontFeet(
        p,
        (s) => {
          const f = step(ph + (s === "L" ? 0 : 0.04), 0.52, 0.32, 0.03 * stride, -0.035 * stride, 0.028);
          return add(rest.wrist[s], [0, f.y + 0.006 * smooth(0.6, 1, f.u), f.z]);
        },
        (s) => {
          const f = step(ph + (s === "L" ? 0 : 0.04), 0.52, 0.32, 0, 0, 0);
          return 0.9 * f.swing + 0.4 * smooth(0.6, 1, f.u) * (1 - f.swing);
        },
      );
    },
  })),
  {
    name: "flick", seconds: 1.6, loop: true, category: "Actions",
    pose(p, t, rest) {
      const ph = t / 1.6;
      // Two quick flicks, the body jerking with them; head up and alert.
      const burst = smooth(0, 0.08, ph) * (1 - smooth(0.32, 0.42, ph)) + smooth(0.5, 0.58, ph) * (1 - smooth(0.82, 0.92, ph));
      p.root = [0, 0.003 * burst * Math.abs(Math.sin(TAU * ph * 4)), 0];
      p.turn("Spine_3", X, -0.15);
      p.turn("Head", X, -0.1);
      tailWave(p, X, 0.55 * burst, TAU * ph * 4, 1, 1.15);
      tailWave(p, Y, 0.12 * burst, TAU * ph * 4 + 1);
      hindFeet(p, (s) => rest.heel[s]);
      frontFeet(p, (s) => rest.wrist[s]);
    },
  },
];

/** The squirrel's own clips on its rig (bone names as in the shared quadruped rig). */
export function squirrelClips(rig: Rig): { def: ClipDef; data: Float32Array }[] {
  const names = rig.bones.map((b) => b.name);
  const refDirs = rig.bones.flatMap((b) => normalize(sub(b.tail, b.head)));
  const hipHeight = rig.bones[rig.index.get("Hips")!].head[1];
  const rest = restOf(new Pose(rig));
  return CLIPS.map((clip) => {
    const frameCount = Math.max(2, Math.round(clip.seconds * FPS) + 1);
    const stride = names.length * 4 + 3;
    const data = new Float32Array(frameCount * stride);
    for (let f = 0; f < frameCount; f++) {
      const pose = new Pose(rig);
      clip.pose(pose, (f / (frameCount - 1)) * clip.seconds, rest);
      pose.D.forEach((q, k) => {
        const o = f * stride + k * 4;
        // Keep neighbouring frames in the same hemisphere so interpolation takes the short way.
        if (f > 0 && q[0] * data[o - stride] + q[1] * data[o - stride + 1] + q[2] * data[o - stride + 2] + q[3] * data[o - stride + 3] < 0) q = q.map((v) => -v) as Quat;
        data.set(q, o);
      });
      data.set(scale(pose.root, 1 / hipHeight), f * stride + names.length * 4);
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
        rootBone: "Hips",
        source: "Procedural squirrel clip (Actors, MIT)",
        category: clip.category,
      },
      data,
    };
  });
}

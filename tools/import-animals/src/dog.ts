/**
 * The base dog: a medium, mixed-breed body (about 0.6 m at the withers) built
 * as a smooth implicit surface around the quadruped rig. Every part names the
 * bones that carry it (skin weights), the direction its fur lies in and its
 * coat region. Breeds come from bone proportions and morphs on top of this
 * one mesh (see targets.ts and @actors/animal).
 */
import { type Vec3, normalize } from "@actors/core";
import { type Rig, resizeRig, shiftChain, turnChain } from "./rig";
import { type Frame, type LoftKey, type Part, type Primitive, bodyDistance, box, capsule, ellipsoid, frameFrom, loft } from "./sdf";

/** Uniform scale from the source rig to the base dog. */
export const DOG_SCALE = 0.53;

/** Bone length factors of the base dog relative to the (fox) source rig. */
export const DOG_LENGTHS: Record<string, number> = {
  Head: 0.9,
  Nose: 0.7,
  "Head.tip": 0.6,
  Tail_Base: 0.52,
  Tail_Mid: 0.52,
  "Tail_Mid.001": 0.52,
  Tail_End: 0.52,
  Tail_Tip: 0.52,
  Ear_L: 1,
  Ear_R: 1,
  Ear_Tip_L: 1,
  Ear_Tip_R: 1,
};

/** Shell fur length the body surface leaves room for (meters). */
export const FUR = 0.012;

/** Rest stance (degrees about +X; negative lifts a forward-pointing bone). */
export const NECK_RAISE = -30;
export const HEAD_TILT = 37;
export const TAIL_DROP = [-70, -8, 6];
/** Ears turned forward, so they stand up rather than lean back. */
export const EAR_TILT = 18;

export type Region = "torso" | "neck" | "head" | "muzzle" | "jaw" | "nose" | "ear" | "leg" | "paw" | "hoof" | "tail" | "eye" | "mane" | "udder" | "comb" | "wing" | "fluff";

export interface BodyPart extends Part {
  /** Bones that carry this part; each vertex is shared between them by distance to the bone. */
  bones: string[];
  region: Region;
  /** Which way the fur lies on this part (model space, before projection onto the surface). */
  flow: (p: Vec3) => Vec3;
  /** Fur length factor (1 = body fur). */
  fur: number;
  /**
   * Parts on another layer (default 0) make a surface of their own that may lie on or in the body
   * without merging with it (a bird's folded wing, which must lift off the body when it opens).
   */
  layer?: number;
}

/** Height of the mouth line at depth z (the slit runs from the corner forward). */
export function mouthLineY(m: DogBody["marks"]["mouth"], z: number): number {
  return m.y0 + ((m.y1 - m.y0) * (z - m.z0)) / (m.z1 - m.z0);
}

export interface DogBody {
  rig: Rig;
  /** Length scale of the small details (blend widths, marking sizes) relative to the dog (1). */
  unit?: number;
  /** Narrow-band meshing: the coarse grid is this many cells wide (see surfaceNets; default 1, off). */
  band?: number;
  parts: BodyPart[];
  /** Eye centres and radius (eyes are separate meshes in the sockets). */
  /** `depth`: the ball's depth along `look` as a share of the radius (default 1, a sphere; less gives a flatter ball). */
  eyes: { center: Vec3; radius: number; look: Vec3; depth?: number }[];
  /** Points that place coat markings: brow spots, nose tip, mouth corner. */
  marks: { brows: Vec3[]; nose: Vec3; mouth: { y0: number; y1: number; z0: number; z1: number; halfWidth: number } };
  /** Whiskers (cats): root on the skin, direction, length, root radius, carrying bone. */
  whiskers?: { root: Vec3; dir: Vec3; length: number; radius: number; bone: string }[];
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mirror = (p: Vec3): Vec3 => [-p[0], p[1], p[2]];
const along = (a: Vec3, b: Vec3) => () => normalize([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
const BACKWARD = () => [0, -0.25, -1] as Vec3;

/** The base dog's skeleton (source rig resized, ear bones moved onto the skull) and body parts. */
export function dogBody(source: Rig): DogBody {
  const rig = resizeRig(source, DOG_SCALE, DOG_LENGTHS);
  const bone = (n: string) => rig.bones[rig.index.get(n)!];
  const H = (n: string) => bone(n).head;
  const T = (n: string) => bone(n).tail;

  // Ears: the fox rig's ear roots sit high above the skull; put them on it (same direction and length).
  for (const side of ["L", "R"] as const) {
    const ear = bone(`Ear_${side}`), tip = bone(`Ear_Tip_${side}`);
    const s = side === "L" ? 1 : -1;
    const base: Vec3 = [0.05 * s, 0.744, 0.548];
    const dir = normalize([ear.tail[0] - ear.head[0], ear.tail[1] - ear.head[1], ear.tail[2] - ear.head[2]]);
    const tipDir = normalize([tip.tail[0] - tip.head[0], tip.tail[1] - tip.head[1], tip.tail[2] - tip.head[2]]);
    ear.head = base;
    ear.tail = add(base, dir.map((c) => c * 0.065) as Vec3);
    tip.head = ear.tail;
    tip.tail = add(tip.head, tipDir.map((c) => c * 0.05) as Vec3);
  }
  // Stance of a wolfdog standing alert: neck carried high, head level, tail hanging.
  const deg = Math.PI / 180;
  for (const side of ["L", "R"]) turnChain(rig, `Ear_${side}`, [1, 0, 0], EAR_TILT * deg);
  turnChain(rig, "Spine_3", [1, 0, 0], NECK_RAISE * deg);
  turnChain(rig, "Head", [1, 0, 0], HEAD_TILT * deg);
  // Legs stand under the sides of the chest and hips, not tucked under the middle.
  for (const side of ["L", "R"]) {
    const s = side === "L" ? 1 : -1;
    shiftChain(rig, `Front_Leg_Shoulder_${side}`, [0.014 * s, 0, 0]);
    shiftChain(rig, `Back_Leg_Pelvis_${side}`, [0.008 * s, 0, 0]);
  }
  // The tail sets on below the croup's top line, so it falls away from the back instead of rising first.
  shiftChain(rig, "Tail_Base", [0, -0.035, -0.015]);
  turnChain(rig, "Tail_Base", [1, 0, 0], TAIL_DROP[0] * deg);
  turnChain(rig, "Tail_Mid", [1, 0, 0], TAIL_DROP[1] * deg);
  turnChain(rig, "Tail_End", [1, 0, 0], TAIL_DROP[2] * deg);

  const parts: BodyPart[] = [];
  const put = (prim: Primitive, k: number, bones: string[], region: Region, flow: (p: Vec3) => Vec3, fur = 1, carve = false) =>
    parts.push({ prim, k, carve, bones, region, flow, fur });

  // The surface is the coat's outline minus the shell fur on top of it (FUR, see the fur material),
  // so the plush silhouette of a thick coat is part of the shape.
  const F = FUR;
  const sec = (z: number, top: number, bottom: number, w: number, n = 2.2): LoftKey => ({ at: [0, (top + bottom) / 2, z], w: w - F, up: (top - bottom) / 2 - F, down: (top - bottom) / 2 - F, n });

  // --- Trunk: one loft from the forechest to the buttocks (side profile: top line, under line, width) ---
  put(loft("trunk", [
    sec(0.36, 0.53, 0.37, 0.06),
    sec(0.3, 0.585, 0.33, 0.09),
    sec(0.2, 0.615, 0.305, 0.108, 2.6),
    sec(0.08, 0.632, 0.302, 0.114, 2.5),
    sec(-0.04, 0.618, 0.318, 0.115),
    sec(-0.15, 0.6, 0.355, 0.104),
    sec(-0.25, 0.593, 0.385, 0.097),
    sec(-0.35, 0.585, 0.4, 0.1),
    sec(-0.44, 0.56, 0.415, 0.085),
    sec(-0.5, 0.53, 0.44, 0.05),
  ]), 0, ["Hips", "Spine_1", "Spine_2", "Spine_2.001", "Stomach"], "torso", BACKWARD);

  // --- Neck: a loft from inside the chest up to the back of the skull, deep with the ruff ---
  const occiput = H("Head"), stop = H("Nose"), tipN = T("Head.tip"), hinge = H("Chin");
  // The neck's outline is two straight lines, as on a wolf standing alert: the crest from the withers to
  // just behind the ears, the throat from under the jaw to the forechest. Each section reaches both.
  const crestA: Vec3 = [0, 0.635, 0.12], crestB: Vec3 = [0, occiput[1] + 0.05, occiput[2] - 0.005];
  const throatA: Vec3 = [0, hinge[1] - 0.06, hinge[2] - 0.035], throatB: Vec3 = [0, 0.47, 0.36];
  const toLine = (p: Vec3, a: Vec3, b: Vec3) => {
    const dy = b[1] - a[1], dz = b[2] - a[2];
    return Math.abs((p[1] - a[1]) * dz - (p[2] - a[2]) * dy) / Math.hypot(dy, dz);
  };
  const nk = (at: Vec3, w: number): LoftKey => ({ at, w: w - F, up: toLine(at, crestA, crestB) - F, down: toLine(at, throatA, throatB) - F, n: 2.1 });
  put(loft("neck", [
    nk([0, 0.5, 0.2], 0.095),
    nk([0, 0.58, 0.29], 0.09),
    nk(lerp(H("Spine_3"), H("Spine_4"), 0.5), 0.08),
    nk(add(H("Spine_4"), [0, -0.015, 0.015]), 0.07),
    nk(add(occiput, [0, -0.03, 0.04]), 0.06),
  ]), 0.05, ["Spine_2.001", "Spine_3", "Spine_4", "Head"], "neck", () => [0, -0.6, -1], 1.25);

  // --- Head: skull and upper jaw as one wedge-shaped loft from the occiput to the nose ---
  const off = (p: Vec3, dy: number, dz: number): Vec3 => [p[0], p[1] + dy, p[2] + dz];
  const axis = (t: number, dy: number): Vec3 => add(lerp(occiput, tipN, t), [0, dy, 0]);
  const stopT = Math.hypot(...([0, 1, 2].map((i) => stop[i] - occiput[i]) as Vec3)) / Math.hypot(...([0, 1, 2].map((i) => tipN[i] - occiput[i]) as Vec3));
  const hd = (t: number, dy: number, w: number, up: number, down: number, n = 2.2): LoftKey => ({ at: axis(t, dy), w, up, down, n });
  put(loft("skull", [
    hd(-0.08, 0.0, 0.05, 0.045, 0.05),
    hd(0.1, 0.008, 0.062, 0.066, 0.052),
    hd(0.28, 0.004, 0.075, 0.064, 0.058),
    hd(stopT - 0.06, -0.002, 0.056, 0.05, 0.05),
    hd(stopT + 0.04, -0.01, 0.04, 0.032, 0.038, 2.5),
    hd(stopT + 0.22, -0.01, 0.032, 0.025, 0.032, 2.5),
    hd(0.93, -0.009, 0.026, 0.021, 0.027, 2.4),
    hd(0.99, -0.009, 0.019, 0.017, 0.021),
  ]), 0.035, ["Head", "Nose", "Spine_4"], "head", BACKWARD, 0.5);
  // Cheek ruff: the thick fur behind the jaw that frames a wolf's face.
  for (const s of [1, -1]) put(ellipsoid("ruff", add(lerp(occiput, hinge, 0.55), [0.042 * s, -0.035, -0.02]), frameFrom([0, -0.6, 1]), [0.045, 0.07, 0.055]), 0.045, ["Head", "Spine_4"], "neck", () => [0, -0.7, -1], 1.2);
  // Muzzle: the front part of the head (marks the region for coat and morphs).
  put(capsule("muzzle", off(stop, -0.022, 0.01), off(tipN, -0.02, -0.022), 0.03, 0.026, [1, 0, 0], [1, 1]), 0.03, ["Nose", "Head"], "muzzle", BACKWARD, 0.3);
  put(ellipsoid("nose", off(tipN, -0.001, 0.003), frameFrom([0, 0.3, 1]), [0.024, 0.019, 0.016]), 0.008, ["Nose"], "nose", BACKWARD, 0);
  const jawA: Vec3 = [0, hinge[1] - 0.019, hinge[2] - 0.005], jawB: Vec3 = [0, tipN[1] - 0.05, tipN[2] - 0.036];
  put(capsule("jaw", jawA, jawB, 0.025, 0.014, [1, 0, 0], [0.85, 0.6]), 0.03, ["Chin", "Chin_Tip"], "jaw", BACKWARD, 0.3);

  // Mouth: a thin slit between the upper lip and the jaw, open at the front, so the jaw can open.
  const mouthBack: Vec3 = [0, jawA[1] + 0.0195, hinge[2] + 0.018], mouthFront: Vec3 = [0, jawB[1] + 0.0135, tipN[2] + 0.03];
  const mouthZ0 = mouthBack[2], mouthZ1 = mouthFront[2];
  const slitFrame: Frame = frameFrom([0, mouthFront[1] - mouthBack[1], mouthFront[2] - mouthBack[2]]);
  put(box("mouth", lerp(mouthBack, mouthFront, 0.5), slitFrame, [0.06, 0.0018, Math.hypot(mouthFront[1] - mouthBack[1], mouthFront[2] - mouthBack[2]) / 2]), 0.003, ["Chin"], "jaw", BACKWARD, 0, true);

  // Eyes in sockets.
  const eyeR = 0.0108;
  // On the skull's surface just behind the stop, looking forward and out; sunk by most of their radius.
  const eyes = [1, -1].map((s) => {
    const from: Vec3 = [0, stop[1] + 0.012, stop[2] - 0.03];
    const look = normalize([0.62 * s, 0.06, 1]) as Vec3;
    const out = normalize([0.85 * s, 0.14, 0.5]) as Vec3;
    let t = 0;
    while (t < 0.15 && bodyDistance(parts, add(from, out.map((c) => c * t) as Vec3)) < 0) t += 0.0005;
    const center = add(from, out.map((c) => c * (t - eyeR * 0.7)) as Vec3);
    return { center, radius: eyeR, look, out, side: s };
  });
  // Almond-shaped lids, set obliquely (the outer corner higher), and a brow ridge above.
  for (const e of eyes) {
    const slant = normalize([0, 0.3, -1]) as Vec3;
    const frame = frameFrom(e.out, slant);
    put(ellipsoid("brow", add(e.center, [0.002 * e.side, 0.013, -0.006]), frameFrom([0, 0.2, 1]), [0.015, 0.008, 0.018]), 0.012, ["Head"], "head", BACKWARD, 0.4);
    put(ellipsoid("socket", add(e.center, e.out.map((c) => c * 0.002) as Vec3), frame, [eyeR * 1.35, eyeR * 0.4, eyeR * 0.9]), 0.003, ["Head"], "head", BACKWARD, 0.3, true);
  }

  // Ears: pointed flaps along the ear bones (prick ears; floppy ears are a morph).
  for (const side of ["L", "R"] as const) {
    const s = side === "L" ? 1 : -1;
    const a = H(`Ear_${side}`), b = T(`Ear_Tip_${side}`);
    // Flap faces forward and a little outward; its width runs front to back.
    const facing = normalize([0.35 * s, 0, 1]);
    const base = lerp(a, b, 0.12);
    // A cupped cone: thick at the root, hollow in front.
    put(capsule(`ear`, base, b, 0.046, 0.005, facing, [0.45, 1]), 0.03, [`Ear_${side}`, `Ear_Tip_${side}`], "ear", along(a, b), 0.45);
    const fwd = (p: Vec3, d: number): Vec3 => add(p, facing.map((c) => c * d) as Vec3);
    put(capsule(`ear`, fwd(lerp(a, b, 0.2), 0.012), fwd(lerp(a, b, 0.92), 0.004), 0.034, 0.002, facing, [0.4, 1]), 0.004, [`Ear_${side}`, `Ear_Tip_${side}`], "ear", along(a, b), 0.3, true);
  }

  // --- Front legs: shoulder blade, upper arm, forearm, pastern, paw ---
  for (const side of ["L", "R"] as const) {
    const s = side === "L" ? 1 : -1;
    const m = (p: Vec3): Vec3 => (s > 0 ? p : mirror(p));
    const sh = H(`Front_Leg_Shoulder_${side}`), up = H(`Front_Leg_Upper_${side}`), el = H(`Front_Leg_Lower_${side}`);
    const wr = H(`Front_Leg_Ankle_${side}`), ft = H(`Front_Leg_Foot_${side}`), tip = H(`Front_Leg_Tip_${side}`);
    put(capsule("scapula", add(sh, m([0.03, -0.065, 0.012])), add(up, m([-0.004, 0.01, 0])), 0.044, 0.05, [1, 0, 0], [0.6, 1]), 0.09, [`Front_Leg_Shoulder_${side}`, "Spine_2.001"], "torso", along(sh, up));
    put(capsule("upperarm", add(up, m([-0.004, 0, 0])), add(lerp(up, el, 0.8), m([-0.004, 0, 0])), 0.05, 0.033, [1, 0, 0], [0.8, 1]), 0.08, [`Front_Leg_Upper_${side}`, `Front_Leg_Shoulder_${side}`], "leg", along(up, el));
    // Triceps: the muscle mass behind the upper arm, so the leg grows out of the chest side instead of its floor.
    put(ellipsoid("triceps", add(lerp(up, el, 0.55), m([0.014, 0, -0.03])), frameFrom([el[0] - up[0], el[1] - up[1], el[2] - up[2]], [1, 0, 0]), [0.04, 0.05, 0.1]), 0.07, [`Front_Leg_Upper_${side}`, `Front_Leg_Shoulder_${side}`], "leg", along(up, el));
    put(ellipsoid("elbow", add(el, [0, 0.01, -0.02]), frameFrom([0, 1, 0]), [0.026, 0.032, 0.026]), 0.06, [`Front_Leg_Upper_${side}`, `Front_Leg_Lower_${side}`], "leg", along(up, el));
    put(capsule("forearm", lerp(el, wr, 0.14), wr, 0.036, 0.027, [1, 0, 0], [0.88, 1]), 0.07, [`Front_Leg_Lower_${side}`, `Front_Leg_Upper_${side}`], "leg", along(el, wr), 0.7);
    put(capsule("pastern", wr, ft, 0.026, 0.024), 0.035, [`Front_Leg_Ankle_${side}`, `Front_Leg_Lower_${side}`], "leg", along(wr, ft), 0.45);
    const paw = lerp(ft, tip, 0.35);
    put(ellipsoid("paw", [paw[0], 0.022, paw[2]], frameFrom([0, 0, 1]), [0.027, 0.021, 0.036]), 0.03, [`Front_Leg_Foot_${side}`, `Front_Leg_Ankle_${side}`], "paw", () => [0, -0.3, 1], 0.35);
  }

  // --- Hind legs: thigh, gaskin, hock, pastern, paw ---
  for (const side of ["L", "R"] as const) {
    const s = side === "L" ? 1 : -1;
    const m = (p: Vec3): Vec3 => (s > 0 ? p : mirror(p));
    const hip = H(`Back_Leg_Upper_${side}`), knee = H(`Back_Leg_Lower_${side}`), hock = H(`Back_Leg_Ankle_${side}`);
    const ft = H(`Back_Leg_Foot_${side}`), ft1 = H(`Back_Leg_Foot_1_${side}`), tip = H(`Back_Leg_Tip_${side}`);
    put(ellipsoid("thigh", add(lerp(hip, knee, 0.5), m([-0.012, -0.01, -0.016])), frameFrom([knee[0] - hip[0], knee[1] - hip[1], knee[2] - hip[2]], [1, 0, 0]), [0.058, 0.095, 0.125]), 0.08, [`Back_Leg_Upper_${side}`, `Back_Leg_Pelvis_${side}`, "Hips"], "leg", along(hip, knee));
    // Hamstrings: the muscle mass behind the thigh that makes the broad, rounded hindquarters.
    put(ellipsoid("hamstring", add(lerp(hip, knee, 0.35), m([-0.008, 0.0, -0.075])), frameFrom([0, -1, -0.15], [1, 0, 0]), [0.052, 0.06, 0.11]), 0.07, [`Back_Leg_Upper_${side}`, `Back_Leg_Pelvis_${side}`, "Hips"], "leg", along(hip, knee));
    put(capsule("gaskin", add(knee, [0, 0.005, -0.008]), add(hock, [0, 0, -0.006]), 0.046, 0.026, [1, 0, 0], [0.75, 1]), 0.07, [`Back_Leg_Lower_${side}`, `Back_Leg_Upper_${side}`], "leg", along(knee, hock), 0.8);
    put(capsule("hock", hock, ft, 0.026, 0.023), 0.035, [`Back_Leg_Ankle_${side}`, `Back_Leg_Lower_${side}`], "leg", along(hock, ft), 0.5);
    put(capsule("rearpastern", ft, ft1, 0.023, 0.022), 0.03, [`Back_Leg_Foot_${side}`, `Back_Leg_Ankle_${side}`], "leg", along(ft, ft1), 0.4);
    const paw = lerp(ft1, tip, 0.2);
    put(ellipsoid("paw", [paw[0], 0.021, paw[2]], frameFrom([0, 0, 1]), [0.026, 0.02, 0.034]), 0.03, [`Back_Leg_Foot_1_${side}`, `Back_Leg_Foot_${side}`], "paw", () => [0, -0.3, 1], 0.35);
  }

  // --- Tail ---
  const tail = ["Tail_Base", "Tail_Mid", "Tail_Mid.001", "Tail_End", "Tail_Tip"];
  // Bushy: thickest a little below the root, the brush tapering to the tip.
  const radii = [0.033, 0.037, 0.036, 0.031, 0.022, 0.011];
  tail.forEach((n, i) => {
    const a = H(n), b = T(n);
    put(capsule("tail", a, b, radii[i], radii[i + 1]), i === 0 ? 0.04 : 0.012, i === 0 ? [n, "Hips"] : [n, tail[i - 1]], "tail", along(a, b), 1.6);
  });

  return {
    rig,
    parts,
    eyes,
    marks: {
      brows: [1, -1].map((s) => [0.024 * s, stop[1] + 0.04, stop[2] - 0.02] as Vec3),
      nose: off(tipN, 0.002, 0.004),
      mouth: { y0: mouthBack[1], y1: mouthFront[1], z0: mouthZ0, z1: mouthZ1, halfWidth: 0.045 },
    },
  };
}

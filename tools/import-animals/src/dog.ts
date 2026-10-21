/**
 * The base dog: a medium, mixed-breed body (about 0.6 m at the withers) built
 * as a smooth implicit surface around the quadruped rig. Every part names the
 * bones that carry it (skin weights), the direction its fur lies in and its
 * coat region. Breeds come from bone proportions and morphs on top of this
 * one mesh (see targets.ts and @actors/animal).
 */
import { type Vec3, normalize } from "@actors/core";
import { type Rig, resizeRig } from "./rig";
import { type Frame, type Part, type Primitive, box, capsule, ellipsoid, frameFrom } from "./sdf";

/** Uniform scale from the source rig to the base dog. */
export const DOG_SCALE = 0.53;

/** Bone length factors of the base dog relative to the (fox) source rig. */
export const DOG_LENGTHS: Record<string, number> = {
  Head: 0.9,
  Nose: 0.8,
  "Head.tip": 0.7,
  Tail_Base: 0.62,
  Tail_Mid: 0.62,
  "Tail_Mid.001": 0.62,
  Tail_End: 0.62,
  Tail_Tip: 0.62,
  Ear_L: 0.85,
  Ear_R: 0.85,
  Ear_Tip_L: 0.85,
  Ear_Tip_R: 0.85,
};

export type Region = "torso" | "neck" | "head" | "muzzle" | "jaw" | "nose" | "ear" | "leg" | "paw" | "tail" | "eye";

export interface BodyPart extends Part {
  /** Bones that carry this part; each vertex is shared between them by distance to the bone. */
  bones: string[];
  region: Region;
  /** Which way the fur lies on this part (model space, before projection onto the surface). */
  flow: (p: Vec3) => Vec3;
  /** Fur length factor (1 = body fur). */
  fur: number;
}

/** Height of the mouth line at depth z (the slit runs from the corner forward). */
export function mouthLineY(m: DogBody["marks"]["mouth"], z: number): number {
  return m.y0 + ((m.y1 - m.y0) * (z - m.z0)) / (m.z1 - m.z0);
}

export interface DogBody {
  rig: Rig;
  parts: BodyPart[];
  /** Eye centres and radius (eyes are separate meshes in the sockets). */
  eyes: { center: Vec3; radius: number; look: Vec3 }[];
  /** Points that place coat markings: brow spots, nose tip, mouth corner. */
  marks: { brows: Vec3[]; nose: Vec3; mouth: { y0: number; y1: number; z0: number; z1: number; halfWidth: number } };
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
    ear.tail = add(base, dir.map((c) => c * 0.055) as Vec3);
    tip.head = ear.tail;
    tip.tail = add(tip.head, tipDir.map((c) => c * 0.04) as Vec3);
  }

  const parts: BodyPart[] = [];
  const put = (prim: Primitive, k: number, bones: string[], region: Region, flow: (p: Vec3) => Vec3, fur = 1, carve = false) =>
    parts.push({ prim, k, carve, bones, region, flow, fur });

  // --- Torso: ribcage, belly, croup ---
  const spine = ["Hips", "Spine_1", "Spine_2", "Spine_2.001"];
  put(ellipsoid("ribcage", [0, 0.445, 0.12], frameFrom([0, 0.05, 1]), [0.104, 0.165, 0.205]), 0, ["Spine_1", "Spine_2", "Spine_2.001"], "torso", BACKWARD);
  put(ellipsoid("withers", [0, 0.548, 0.16], frameFrom([0, 0.3, 1]), [0.076, 0.07, 0.15]), 0.06, ["Spine_2", "Spine_2.001"], "torso", BACKWARD);
  put(ellipsoid("belly", [0, 0.488, -0.15], frameFrom([0, 0.1, 1]), [0.086, 0.1, 0.2]), 0.08, [...spine, "Stomach"], "torso", BACKWARD, 0.9);
  put(ellipsoid("croup", [0, 0.518, -0.335], frameFrom([0, -0.1, 1]), [0.09, 0.085, 0.135]), 0.07, ["Hips", "Spine_1"], "torso", BACKWARD);
  put(ellipsoid("brisket", [0, 0.385, 0.275], frameFrom([0, -0.35, 1]), [0.078, 0.105, 0.075]), 0.06, ["Spine_2.001", "Spine_2"], "torso", () => [0, -1, -0.2], 1.1);

  // --- Neck and head ---
  const neckA: Vec3 = [0, 0.53, 0.25], neckB: Vec3 = [0, 0.66, 0.475];
  put(capsule("neck", neckA, neckB, 0.1, 0.062, [1, 0, 0], [0.82, 1]), 0.06, ["Spine_2.001", "Spine_3", "Spine_4", "Head"], "neck", () => [0, -0.6, -1], 1.25);
  const occiput = H("Head"), stop = H("Nose"), tipN = T("Head.tip"), hinge = H("Chin");
  const off = (p: Vec3, dy: number, dz: number): Vec3 => [p[0], p[1] + dy, p[2] + dz];
  put(ellipsoid("cranium", off(lerp(occiput, stop, 0.45), 0.01, 0), frameFrom([0, -0.15, 1]), [0.064, 0.057, 0.082]), 0.035, ["Head", "Spine_4"], "head", BACKWARD, 0.5);
  put(ellipsoid("cheeks", off(lerp(occiput, stop, 0.68), -0.032, 0), frameFrom([0, -0.2, 1]), [0.062, 0.046, 0.058]), 0.03, ["Head", "Nose"], "head", () => [0, -0.4, -1], 0.5);
  put(ellipsoid("forehead", off(stop, 0.03, -0.035), frameFrom([0, 0.4, 1]), [0.048, 0.034, 0.042]), 0.03, ["Head", "Nose"], "head", BACKWARD, 0.4);
  for (const s of [1, -1]) put(ellipsoid("brow", [0.029 * s, stop[1] + 0.03, stop[2] - 0.028], frameFrom([0, 0.3, 1]), [0.016, 0.012, 0.018]), 0.014, ["Head", "Nose"], "head", BACKWARD, 0.4);
  const muzzleA = off(stop, -0.012, -0.012), muzzleB = off(tipN, -0.014, -0.016);
  put(capsule("muzzle", muzzleA, muzzleB, 0.04, 0.032, [1, 0, 0], [1.02, 1.05]), 0.035, ["Nose", "Head"], "muzzle", BACKWARD, 0.3);
  put(ellipsoid("nose", off(tipN, 0.002, -0.006), frameFrom([0, 0.25, 1]), [0.021, 0.016, 0.012]), 0.008, ["Nose"], "nose", BACKWARD, 0);
  const jawA: Vec3 = [0, hinge[1] - 0.019, hinge[2] - 0.005], jawB: Vec3 = [0, tipN[1] - 0.053, tipN[2] - 0.03];
  put(capsule("jaw", jawA, jawB, 0.029, 0.018, [1, 0, 0], [0.95, 0.68]), 0.022, ["Chin", "Chin_Tip"], "jaw", BACKWARD, 0.3);

  // Mouth: a thin slit between the upper lip and the jaw, open at the front, so the jaw can open.
  const mouthBack: Vec3 = [0, jawA[1] + 0.0195, hinge[2] + 0.018], mouthFront: Vec3 = [0, jawB[1] + 0.0135, tipN[2] + 0.03];
  const mouthZ0 = mouthBack[2], mouthZ1 = mouthFront[2];
  const slitFrame: Frame = frameFrom([0, mouthFront[1] - mouthBack[1], mouthFront[2] - mouthBack[2]]);
  put(box("mouth", lerp(mouthBack, mouthFront, 0.5), slitFrame, [0.06, 0.0028, Math.hypot(mouthFront[1] - mouthBack[1], mouthFront[2] - mouthBack[2]) / 2]), 0.003, ["Chin"], "jaw", BACKWARD, 0, true);

  // Eyes in sockets.
  const eyeR = 0.0118;
  const eyes = [1, -1].map((s) => {
    const center: Vec3 = [0.032 * s, stop[1] + 0.014, stop[2] - 0.012];
    return { center, radius: eyeR, look: normalize([0.45 * s, 0.05, 1]) as Vec3 };
  });
  for (const e of eyes) put(ellipsoid("socket", e.center, frameFrom([0, 0, 1]), [eyeR * 0.92, eyeR * 0.82, eyeR * 0.92]), 0.004, ["Head"], "head", BACKWARD, 0.3, true);

  // Ears: pointed flaps along the ear bones (prick ears; floppy ears are a morph).
  for (const side of ["L", "R"] as const) {
    const s = side === "L" ? 1 : -1;
    const a = H(`Ear_${side}`), b = T(`Ear_Tip_${side}`);
    // Flap faces forward and a little outward; its width runs front to back.
    const facing = normalize([0.35 * s, 0, 1]);
    const base = lerp(a, b, 0.12);
    put(capsule(`ear`, base, b, 0.026, 0.004, facing, [0.26, 1]), 0.03, [`Ear_${side}`, `Ear_Tip_${side}`], "ear", along(a, b), 0.45);
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
    put(ellipsoid("paw", [paw[0], 0.026, paw[2]], frameFrom([0, 0, 1]), [0.035, 0.025, 0.046]), 0.035, [`Front_Leg_Foot_${side}`, `Front_Leg_Ankle_${side}`], "paw", () => [0, -0.3, 1], 0.35);
  }

  // --- Hind legs: thigh, gaskin, hock, pastern, paw ---
  for (const side of ["L", "R"] as const) {
    const s = side === "L" ? 1 : -1;
    const m = (p: Vec3): Vec3 => (s > 0 ? p : mirror(p));
    const hip = H(`Back_Leg_Upper_${side}`), knee = H(`Back_Leg_Lower_${side}`), hock = H(`Back_Leg_Ankle_${side}`);
    const ft = H(`Back_Leg_Foot_${side}`), ft1 = H(`Back_Leg_Foot_1_${side}`), tip = H(`Back_Leg_Tip_${side}`);
    put(ellipsoid("thigh", add(lerp(hip, knee, 0.42), m([-0.012, 0.0, -0.012])), frameFrom([knee[0] - hip[0], knee[1] - hip[1], knee[2] - hip[2]], [1, 0, 0]), [0.058, 0.09, 0.15]), 0.08, [`Back_Leg_Upper_${side}`, `Back_Leg_Pelvis_${side}`, "Hips"], "leg", along(hip, knee));
    put(capsule("gaskin", add(knee, [0, 0.005, -0.008]), add(hock, [0, 0, -0.006]), 0.046, 0.026, [1, 0, 0], [0.75, 1]), 0.07, [`Back_Leg_Lower_${side}`, `Back_Leg_Upper_${side}`], "leg", along(knee, hock), 0.8);
    put(capsule("hock", hock, ft, 0.026, 0.023), 0.035, [`Back_Leg_Ankle_${side}`, `Back_Leg_Lower_${side}`], "leg", along(hock, ft), 0.5);
    put(capsule("rearpastern", ft, ft1, 0.023, 0.022), 0.03, [`Back_Leg_Foot_${side}`, `Back_Leg_Ankle_${side}`], "leg", along(ft, ft1), 0.4);
    const paw = lerp(ft1, tip, 0.2);
    put(ellipsoid("paw", [paw[0], 0.025, paw[2]], frameFrom([0, 0, 1]), [0.033, 0.024, 0.044]), 0.035, [`Back_Leg_Foot_1_${side}`, `Back_Leg_Foot_${side}`], "paw", () => [0, -0.3, 1], 0.35);
  }

  // --- Tail ---
  const tail = ["Tail_Base", "Tail_Mid", "Tail_Mid.001", "Tail_End", "Tail_Tip"];
  const radii = [0.03, 0.022, 0.017, 0.013, 0.009, 0.006];
  tail.forEach((n, i) => {
    const a = H(n), b = T(n);
    put(capsule("tail", a, b, radii[i], radii[i + 1]), i === 0 ? 0.04 : 0.012, i === 0 ? [n, "Hips"] : [n, tail[i - 1]], "tail", along(a, b), 1.3);
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

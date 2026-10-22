/**
 * The base cat: a Maine Coon (brown tortie tabby) modelled on one side-on
 * reference photo, built like the dog as a smooth implicit surface around the
 * same quadruped rig, so every quadruped clip plays on it.
 *
 * Positions are measured in the photo's pixels (`ph`): the photo is a clean
 * side view, so its silhouette gives the top and under lines directly. The rig
 * is placed onto the photo's joints first (hips, neck, head, tail), then the
 * body is drawn around it.
 */
import { type Vec3, normalize } from "@actors/core";
import type { BodyPart, DogBody, Region } from "./dog";
import { type Rig, resizeRig, shiftChain, turnChain } from "./rig";
import { type Frame, type LoftKey, type Primitive, bodyDistance, box, capsule, ellipsoid, frameFrom, loft } from "./sdf";

/** Uniform scale from the source (fox) rig to the cat. */
export const CAT_SCALE = 0.24;

/** Bone length factors relative to the fox rig (after CAT_SCALE). Neck, head and tail are fitted to the photo below. */
export const CAT_LENGTHS: Record<string, number> = {
  Spine_1: 1.22,
  Spine_2: 1.22,
  Front_Leg_Lower_L: 1.08,
  Front_Leg_Lower_R: 1.08,
};

/** Ear roots from the midline, and ear height without the tuft (metres). */
const EAR_SPREAD = 0.03;
const EAR_LENGTH = 0.047;

/** Metres per photo pixel (the photo cat stands about 0.30 m at the withers, coat included). */
export const PX = 0.0012;
const GROUND_PX = 449;
const ORIGIN_PX = 470;

/** A point measured on the photo (pixels, y down) in pack space; `x` is the offset from the midline in metres. */
export const ph = (px: number, py: number, x = 0): Vec3 => [x, (GROUND_PX - py) * PX, (px - ORIGIN_PX) * PX];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

/** Scales one bone's length; the bones below it move with its tail. */
export function stretchBone(rig: Rig, name: string, factor: number): void {
  const b = rig.bones[rig.index.get(name)!];
  const tail: Vec3 = [b.head[0] + (b.tail[0] - b.head[0]) * factor, b.head[1] + (b.tail[1] - b.head[1]) * factor, b.head[2] + (b.tail[2] - b.head[2]) * factor];
  const d = sub(tail, b.tail);
  b.tail = tail;
  const i = rig.index.get(name)!;
  rig.bones.forEach((c, k) => {
    if (c.parent === i) shiftChain(rig, c.name, d);
  });
}

/** Angle about +X that turns direction a onto direction b (both in the y-z plane). */
function pitch(a: Vec3, b: Vec3): number {
  return Math.atan2(a[1], a[2]) - Math.atan2(b[1], b[2]);
}

/**
 * Turns and stretches a chain of midline bones (`names`, parent first) about the
 * first one's head so that the last bone's tail lands on `target`.
 */
export function reachChain(rig: Rig, names: string[], target: Vec3): void {
  const first = rig.bones[rig.index.get(names[0])!];
  const last = rig.bones[rig.index.get(names[names.length - 1])!];
  const chord = sub(last.tail, first.head), want = sub(target, first.head);
  const f = len(want) / len(chord);
  for (const n of names) stretchBone(rig, n, f);
  turnChain(rig, names[0], [1, 0, 0], pitch(sub(last.tail, first.head), want));
}

/** One midline bone from `head` towards `tail` (moves it, then turns and stretches it). */
export function placeBone(rig: Rig, name: string, head: Vec3, tail: Vec3): void {
  const b = rig.bones[rig.index.get(name)!];
  shiftChain(rig, name, sub(head, b.head));
  reachChain(rig, [name], tail);
}

/** The cat's skeleton: the fox rig scaled, then fitted to the joints measured on the photo. */
export function catRig(source: Rig): Rig {
  const rig = resizeRig(source, CAT_SCALE, CAT_LENGTHS);
  const bone = (n: string) => rig.bones[rig.index.get(n)!];
  // Hip joint onto the photo's.
  shiftChain(rig, "Hips", sub(ph(318, 252), bone("Back_Leg_Upper_L").head).map((v, k) => (k === 0 ? 0 : v)) as Vec3);
  // Neck from the withers to the back of the skull; head to the stop, then the nose.
  reachChain(rig, ["Spine_3", "Spine_4"], ph(642, 196));
  reachChain(rig, ["Head"], ph(702, 206));
  reachChain(rig, ["Nose", "Head.tip"], ph(726, 240));
  // Tail along the centre line of the photo's tail.
  shiftChain(rig, "Tail_Base", sub(ph(268, 226), bone("Tail_Base").head));
  const tailPts = [ph(244, 262), ph(206, 292), ph(150, 314), ph(96, 320), ph(54, 314)];
  ["Tail_Base", "Tail_Mid", "Tail_Mid.001", "Tail_End", "Tail_Tip"].forEach((n, i) => reachChain(rig, [n], tailPts[i]));
  // Jaw: hinge below and behind the eye, tip at the chin.
  placeBone(rig, "Chin", ph(676, 247), ph(703, 259));
  placeBone(rig, "Chin_Tip", ph(703, 259), ph(714, 262));
  // Ears: the fox's ear roots float above the skull. Put them on top of the head, upright,
  // a little forward and flared out (direction and length set here, roll kept).
  for (const side of ["L", "R"] as const) {
    const s = side === "L" ? 1 : -1;
    const ear = bone(`Ear_${side}`), tip = bone(`Ear_Tip_${side}`);
    const base = ph(684, 192, EAR_SPREAD * s);
    const dir = normalize([0.42 * s, 1, 0.16]);
    ear.head = base;
    ear.tail = base.map((c, k) => c + dir[k] * EAR_LENGTH * 0.6) as Vec3;
    tip.head = ear.tail;
    tip.tail = base.map((c, k) => c + dir[k] * EAR_LENGTH) as Vec3;
  }
  return rig;
}


/**
 * A lens (almond) shape: the intersection of two spheres offset along the frame's v axis.
 * Half width `a` along u (pointed corners), half height `b` along v, depth `a` along w.
 */
function lens(name: string, center: Vec3, frame: Frame, a: number, b: number): Primitive {
  const r = (a * a + b * b) / (2 * b), o = r - b;
  const c1 = add(center, scale(frame.v, -o)), c2 = add(center, scale(frame.v, o));
  return {
    name,
    min: center.map((x) => x - a) as Vec3,
    max: center.map((x) => x + a) as Vec3,
    distance: (p) => Math.max(len(sub(p, c1)) - r, len(sub(p, c2)) - r),
  };
}

/**
 * Shell fur the surface leaves room for (metres): the body is the photo's coat outline minus this (times
 * each part's fur factor). Less than the fur length: the outer shells are sparse, so the visible coat is thinner.
 */
export const CAT_FUR = 0.0075;

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const lerp2 = (a: [number, number], b: [number, number], t: number): [number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const mirror = (p: Vec3): Vec3 => [-p[0], p[1], p[2]];
const along = (a: Vec3, b: Vec3) => () => normalize(sub(b, a));
const BACKWARD = () => [0, -0.2, -1] as Vec3;

/**
 * Trunk side profile from the photo: x (pixels), top and under line (pixels,
 * coat included) and half width (metres, coat included; the photo has no top view).
 */
const TRUNK: [number, number, number, number][] = [
  [634, 240, 316, 0.037],
  [614, 206, 334, 0.055],
  [584, 198, 344, 0.064],
  [544, 196, 344, 0.069],
  [504, 195, 340, 0.073],
  [464, 193, 343, 0.075],
  [424, 191, 347, 0.075],
  [384, 189, 338, 0.073],
  [344, 191, 318, 0.070],
  [304, 199, 300, 0.068],
  [276, 205, 296, 0.057],
  [256, 226, 288, 0.033],
];

/** Neck: the crest and throat lines of the photo are straight (pixels). */
const CREST: [[number, number], [number, number]] = [[584, 196], [652, 171]];
const THROAT: [[number, number], [number, number]] = [[626, 318], [690, 264]];

/** Head: an axis from the back of the skull to the nose tip, and sections along it (t, up and down in pixels, half width in metres; coat included). */
const HEAD_AXIS: [[number, number], [number, number]] = [[636, 212], [727, 240]];
const HEAD: [number, number, number, number][] = [
  [-0.08, 30, 34, 0.036],
  [0.08, 40, 42, 0.044],
  [0.25, 43, 44, 0.05],
  [0.42, 41, 40, 0.049],
  [0.58, 37, 33, 0.043],
  [0.75, 33, 25, 0.036],
  [0.85, 25, 21, 0.03],
  [0.93, 16, 16, 0.024],
  [0.99, 7, 9, 0.016],
];

/** The base cat (Maine Coon): skeleton and body parts. */
export function catBody(source: Rig): DogBody {
  const rig = catRig(source);
  const bone = (n: string) => rig.bones[rig.index.get(n)!];
  const H = (n: string) => bone(n).head;
  const T = (n: string) => bone(n).tail;
  const F = CAT_FUR;
  /** A coat measurement minus the fur on top of it. */
  const c = (coat: number, fur = 1) => Math.max(0.0025, coat - F * fur);

  const parts: BodyPart[] = [];
  const put = (prim: Primitive, k: number, bones: string[], region: Region, flow: (p: Vec3) => Vec3, fur = 1, carve = false) =>
    parts.push({ prim, k, carve, bones, region, flow, fur });

  // --- Trunk: one loft from the forechest to the buttocks ---
  const sec = ([px, top, bottom, w]: [number, number, number, number]): LoftKey => {
    const a = ph(px, top), b = ph(px, bottom);
    const half = (a[1] - b[1]) / 2;
    return { at: [0, (a[1] + b[1]) / 2, a[2]], w: c(w), up: c(half), down: c(half), n: 2.2 };
  };
  put(loft("trunk", TRUNK.map(sec)), 0, ["Hips", "Spine_1", "Spine_2", "Spine_2.001", "Stomach"], "torso", BACKWARD);

  // --- Neck with its ruff: sections between the straight crest and throat lines ---
  const neckFur = 1.3;
  const neck = (t: number, w: number): LoftKey => {
    const a = lerp2(CREST[0], CREST[1], t), b = lerp2(THROAT[0], THROAT[1], t);
    const top = ph(a[0], a[1]), bot = ph(b[0], b[1]);
    return { at: lerp(top, bot, 0.5), w: c(w, neckFur), up: c(len(sub(top, bot)) / 2 * 0.93, neckFur), down: c(len(sub(top, bot)) / 2 * 0.93, neckFur), n: 2.1 };
  };
  put(loft("neck", [neck(0.1, 0.058), neck(0.35, 0.056), neck(0.6, 0.053), neck(0.85, 0.05), neck(1, 0.046)]), 0.03, ["Spine_2.001", "Spine_3", "Spine_4", "Head"], "neck", () => [0, -0.5, -1], neckFur);
  // The ruff over the forechest.
  put(ellipsoid("ruff", ph(620, 290), frameFrom([0, -0.4, 1]), [c(0.052, 1.4), c(0.05, 1.4), c(0.034, 1.4)]), 0.03, ["Spine_2.001", "Spine_3"], "neck", () => [0, -1, 0.15], 1.4);

  // --- Head: a loft from the back of the skull to the nose ---
  const [O, N] = HEAD_AXIS;
  const headFur = 0.55;
  const hd = ([t, up, down, w]: [number, number, number, number]): LoftKey => {
    const p = lerp2(O, N, t);
    return { at: ph(p[0], p[1]), w: c(w, headFur), up: c(up * PX, headFur), down: c(down * PX, headFur), n: 2.3 };
  };
  put(loft("skull", HEAD.map(hd)), 0.03, ["Head", "Nose", "Spine_4"], "head", BACKWARD, headFur);
  // Cheeks with the facial ruff.
  for (const s of [1, -1]) put(ellipsoid("cheek", ph(678, 240, 0.028 * s), frameFrom([0, -0.3, 1]), [c(0.022, 1), c(0.027, 1), c(0.03, 1)]), 0.03, ["Head", "Spine_4"], "head", () => [0.4 * s, -0.6, -1], 1);
  // Muzzle: bridge and whisker pads, nose leather on the tip.
  put(capsule("muzzle", ph(709, 228), ph(723, 239), c(0.013, 0.3), c(0.01, 0.3)), 0.012, ["Nose", "Head"], "muzzle", BACKWARD, 0.3);
  for (const s of [1, -1]) put(ellipsoid("whiskerpad", ph(714.5, 247, 0.0115 * s), frameFrom([0, 0, 1]), [0.0125, 0.0105, 0.0115]), 0.008, ["Nose", "Head.tip"], "muzzle", () => [0.6 * s, -0.3, -1], 0.25);
  put(ellipsoid("nose", ph(725.5, 240), frameFrom([0, 0.35, 1]), [0.0068, 0.0042, 0.0035]), 0.004, ["Head.tip", "Nose"], "nose", BACKWARD, 0);
  // Jaw: hinge under the cheek, a small chin.
  const jawA = ph(678, 254), jawB = ph(705, 261);
  put(capsule("jaw", jawA, jawB, 0.0125, 0.0078, [1, 0, 0], [0.9, 0.75]), 0.012, ["Chin", "Chin_Tip"], "jaw", BACKWARD, 0.3);
  // Mouth: a thin slit between the whisker pads and the jaw, so the jaw can open.
  const mouthBack = ph(703, 255.5), mouthFront = ph(720, 255);
  put(box("mouth", lerp(mouthBack, mouthFront, 0.5), frameFrom(sub(mouthFront, mouthBack)), [0.03, 0.0008, len(sub(mouthFront, mouthBack)) / 2]), 0.0015, ["Chin"], "jaw", BACKWARD, 0, true);

  // Eyes: big, set on the front of the face, looking forward; sunk by most of their radius.
  const eyeR = 0.0098;
  const eyes = [1, -1].map((s) => {
    const from = ph(698, 222, 0.012 * s);
    const look = normalize([0.28 * s, 0.02, 1]);
    const out = normalize([0.75 * s, 0.1, 1]);
    let t = 0;
    while (t < 0.1 && bodyDistance(parts, add(from, scale(out, t))) < 0) t += 0.0004;
    const center = add(from, scale(out, t - eyeR * 0.86));
    return { center, radius: eyeR, look, out, side: s };
  });
  for (const e of eyes) {
    // Almond lid opening with pointed corners, the outer corner a little higher; a soft brow above.
    const frame = frameFrom(e.out, normalize([0, 0.25, -1]));
    put(ellipsoid("brow", add(e.center, [0.002 * e.side, 0.0105, -0.004]), frameFrom([0, 0.25, 1]), [0.012, 0.005, 0.012]), 0.008, ["Head"], "head", BACKWARD, 0.4);
    put(lens("socket", add(e.center, scale(e.out, eyeR * 0.6)), frame, eyeR * 1.3, eyeR * 0.56), 0.0025, ["Head"], "head", BACKWARD, 0.3, true);
  }

  // Ears: tall cupped cones with a tuft at the tip (lynx tips).
  for (const side of ["L", "R"] as const) {
    const s = side === "L" ? 1 : -1;
    const a = H(`Ear_${side}`), b = T(`Ear_Tip_${side}`);
    const facing = normalize([0.45 * s, -0.05, 1]);
    const bones = [`Ear_${side}`, `Ear_Tip_${side}`];
    // A half cone: the outer cone (flattened front to back) with a slightly narrower one carved from its front.
    put(capsule("ear", lerp(a, b, 0.05), b, 0.025, 0.0028, facing, [0.7, 1]), 0.01, bones, "ear", along(a, b), 0.35);
    const fwd = (p: Vec3, d: number) => add(p, scale(facing, d));
    put(capsule("ear", fwd(lerp(a, b, 0.12), 0.0045), fwd(lerp(a, b, 0.88), 0.0012), 0.024, 0.0016, facing, [0.7, 0.82]), 0.003, bones, "ear", along(a, b), 0.3, true);
    const dir = normalize(sub(b, a));
    put(capsule("tuft", lerp(a, b, 0.92), add(b, scale(dir, 0.008)), 0.0026, 0.0012), 0.003, [`Ear_Tip_${side}`], "ear", along(a, b), 0.6);
  }

  // Paws: a round bun under the leg and four toes in an arc at the front.
  const pawFur = 0.3;
  const paws = (at: Vec3, size: number, bones: string[]) => {
    put(ellipsoid("paw", [at[0], 0.015 * size, at[2]], frameFrom([0, 0, 1]), [c(0.0175 * size, pawFur), c(0.015 * size, pawFur), c(0.019 * size, pawFur)]), 0.012, bones, "paw", () => [0, -0.3, 1], pawFur);
    for (const dx of [-1.5, -0.5, 0.5, 1.5]) {
      const toe: Vec3 = [at[0] + dx * 0.0078 * size, 0.009 * size, at[2] + (0.0155 - Math.abs(dx) * 0.0035) * size];
      put(ellipsoid("toe", toe, frameFrom([0, 0, 1]), [c(0.0085 * size, pawFur), c(0.009 * size, pawFur), c(0.0095 * size, pawFur)]), 0.003, bones, "paw", () => [0, -0.3, 1], pawFur);
    }
  };

  // --- Front legs ---
  for (const side of ["L", "R"] as const) {
    const s = side === "L" ? 1 : -1;
    const m = (p: Vec3): Vec3 => (s > 0 ? p : mirror(p));
    const sh = H(`Front_Leg_Shoulder_${side}`), up = H(`Front_Leg_Upper_${side}`), el = H(`Front_Leg_Lower_${side}`);
    const wr = H(`Front_Leg_Ankle_${side}`), ft = H(`Front_Leg_Foot_${side}`), tip = T(`Front_Leg_Tip_${side}`);
    const legFur = 0.7;
    put(capsule("scapula", add(sh, m([0.012, -0.025, 0.004])), add(up, m([-0.003, 0.004, 0])), c(0.03), c(0.034), [1, 0, 0], [0.6, 1]), 0.035, [`Front_Leg_Shoulder_${side}`, "Spine_2.001"], "torso", along(sh, up));
    put(capsule("upperarm", up, lerp(up, el, 0.85), c(0.038), c(0.028), [1, 0, 0], [0.8, 1]), 0.03, [`Front_Leg_Upper_${side}`, `Front_Leg_Shoulder_${side}`], "leg", along(up, el));
    put(ellipsoid("triceps", add(lerp(up, el, 0.55), m([0.004, 0, -0.016])), frameFrom(sub(el, up), [1, 0, 0]), [c(0.027), c(0.031), c(0.054)]), 0.03, [`Front_Leg_Upper_${side}`, `Front_Leg_Shoulder_${side}`], "leg", along(up, el));
    put(capsule("forearm", lerp(el, wr, 0.1), wr, c(0.024, legFur), c(0.0175, legFur), [1, 0, 0], [0.9, 1]), 0.025, [`Front_Leg_Lower_${side}`, `Front_Leg_Upper_${side}`], "leg", along(el, wr), legFur);
    put(capsule("pastern", add(wr, [0, 0.006, -0.002]), ft, c(0.0165, legFur), c(0.0165, legFur)), 0.012, [`Front_Leg_Ankle_${side}`, `Front_Leg_Lower_${side}`], "leg", along(wr, ft), legFur);
    paws(lerp(ft, tip, 0.3), 1, [`Front_Leg_Foot_${side}`, `Front_Leg_Ankle_${side}`]);
  }

  // --- Hind legs: haunch with the "britches" (long fur behind the thigh), shank, hock, paw ---
  for (const side of ["L", "R"] as const) {
    const s = side === "L" ? 1 : -1;
    const m = (p: Vec3): Vec3 => (s > 0 ? p : mirror(p));
    const hip = H(`Back_Leg_Upper_${side}`), knee = H(`Back_Leg_Lower_${side}`), hock = H(`Back_Leg_Ankle_${side}`);
    const ft = H(`Back_Leg_Foot_${side}`), ft1 = H(`Back_Leg_Foot_1_${side}`), tip = T(`Back_Leg_Tip_${side}`);
    const bones = [`Back_Leg_Upper_${side}`, `Back_Leg_Pelvis_${side}`, "Hips"];
    put(ellipsoid("thigh", add(lerp(hip, knee, 0.45), m([-0.004, -0.004, -0.008])), frameFrom(sub(knee, hip), [1, 0, 0]), [c(0.04), c(0.06), c(0.066)]), 0.03, bones, "leg", along(hip, knee));
    put(ellipsoid("britches", add(lerp(hip, knee, 0.55), m([-0.004, -0.008, -0.034])), frameFrom([0, -1, -0.2], [1, 0, 0]), [c(0.03, 1.4), c(0.05, 1.4), c(0.04, 1.4)]), 0.03, bones, "leg", () => [0, -1, -0.3], 1.4);
    put(capsule("shank", add(knee, [0, 0.003, -0.004]), hock, c(0.03), c(0.02, 0.8), [1, 0, 0], [0.75, 1]), 0.025, [`Back_Leg_Lower_${side}`, `Back_Leg_Upper_${side}`], "leg", along(knee, hock), 0.9);
    put(capsule("hock", hock, ft, c(0.019, 0.6), c(0.018, 0.6)), 0.012, [`Back_Leg_Ankle_${side}`, `Back_Leg_Lower_${side}`], "leg", along(hock, ft), 0.6);
    put(capsule("rearpastern", ft, ft1, c(0.018, 0.5), c(0.018, 0.5)), 0.01, [`Back_Leg_Foot_${side}`, `Back_Leg_Ankle_${side}`], "leg", along(ft, ft1), 0.5);
    paws(lerp(ft1, tip, 0.25), 0.95, [`Back_Leg_Foot_1_${side}`, `Back_Leg_Foot_${side}`]);
  }

  // --- Tail: long and bushy, the plume thickest past the middle ---
  const tail = ["Tail_Base", "Tail_Mid", "Tail_Mid.001", "Tail_End", "Tail_Tip"];
  const tailFur = 1.6;
  const radii = [0.046, 0.05, 0.056, 0.058, 0.05, 0.026];
  tail.forEach((n, i) => {
    const a = H(n), b = T(n);
    put(capsule("tail", a, b, c(radii[i], 0.8), c(radii[i + 1], 0.8)), i === 0 ? 0.045 : 0.006, i === 0 ? [n, "Hips"] : [n, tail[i - 1]], "tail", along(a, b), tailFur);
  });

  // Whiskers: four rows of three on each whisker pad, fanning out and back; three above each eye.
  const whiskers: NonNullable<DogBody["whiskers"]> = [];
  const onSurface = (from: Vec3, out: Vec3): Vec3 => {
    let t = 0;
    while (t < 0.03 && bodyDistance(parts, add(from, scale(out, t))) < 0) t += 0.0002;
    return add(from, scale(out, t - 0.0012));
  };
  for (const s of [1, -1]) {
    const pad = ph(714.5, 247, 0.0115 * s);
    for (let row = 0; row < 4; row++)
      for (let col = 0; col < 3; col++) {
        const root = onSurface(add(pad, [0, 0.0036 - row * 0.0025, 0.0035 - col * 0.0035]), normalize([s, 0.05, 0.3]));
        const dir = normalize([s, 0.16 - row * 0.11, 0.45 - col * 0.3]);
        whiskers.push({ root, dir, length: 0.072 - row * 0.008 - col * 0.006, radius: 0.0004, bone: "Nose" });
      }
    const e = eyes.find((q) => q.side === s)!;
    for (let i = 0; i < 3; i++) {
      const root = onSurface(add(e.center, [0.003 * s, 0.006, 0.002 - i * 0.003]), normalize([0.4 * s, 1, 0.2]));
      whiskers.push({ root, dir: normalize([0.7 * s, 0.9, 0.35 - i * 0.2]), length: 0.04 - i * 0.005, radius: 0.0003, bone: "Head" });
    }
  }

  return {
    rig,
    parts,
    whiskers,
    eyes: eyes.map(({ center, radius, look }) => ({ center, radius, look })),
    unit: CAT_SIZE,
    marks: {
      brows: [1, -1].map((s) => ph(704, 207, 0.012 * s)),
      nose: ph(728, 240),
      mouth: { y0: mouthBack[1], y1: mouthFront[1], z0: mouthBack[2], z1: mouthFront[2], halfWidth: 0.02 },
    },
  };
}

/** Size of the cat relative to the dog, for the coat-region distances in bodymesh.ts. */
export const CAT_SIZE = 0.5;

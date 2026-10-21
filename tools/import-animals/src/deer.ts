/**
 * The base deer: a sika hind (about 0.82 m at the withers), modelled on a side
 * photo of a spotted hind, on the skeleton of Quaternius' CC0 low-poly Deer
 * (its rig, clips and proportions are the blueprint; its mesh is not used).
 * Like the dog, the body is a smooth implicit surface around the rig: lofts for
 * trunk, neck and skull drawn from the photo's side profile, round cones and
 * ellipsoids for muscles, joints and hooves. Every part names the bones that
 * carry it, the way its hair lies and its coat region.
 */
import { type Vec3, normalize } from "@actors/core";
import type { BodyPart, DogBody, Region } from "./dog";
import { type Rig, type RigBone, turnChain } from "./rig";
import { type LoftKey, type Primitive, bodyDistance, box, capsule, ellipsoid, frameFrom, loft } from "./sdf";

/** Uniform scale from the source rig (Blender units) to the base deer (meters). */
export const DEER_SCALE = 0.265;

/** Hair length the body surface leaves room for (meters): a short summer coat. */
export const DEER_FUR = 0.004;

/** Source bones that are not part of the deer: the unweighted root and the IK pole targets. */
export const DEER_SKIP = ["Body", "PoleTarget.L", "PoleTarget.R", "PoleTargetBack.L", "PoleTargetBack.R"];

/**
 * The pastern and hoof bones of the source rig are IK targets parented to the
 * armature; ours hang below the cannon bones (the IK chain ends at their head),
 * so they follow the legs in every clip.
 */
export const DEER_FEET: [string, string][] = [
  ["IKFrontLeg.L", "FrontLowerLeg.L"],
  ["IKFrontLeg.R", "FrontLowerLeg.R"],
  ["IKBackLeg.L", "BackLowerLeg.L"],
  ["IKBackLeg.R", "BackLowerLeg.R"],
];

/** Ears raised (degrees, outward-up) from the low-poly rig's sideways carriage to the photo's alert V. */
export const EAR_RAISE = 22;

/** Extra data the deer coat needs (see deercoat.ts). */
export interface DeerBody extends DogBody {
  deer: {
    /** Centre of the white rump patch (around the tail root). */
    rump: Vec3;
    /** Spine line for the dorsal stripe and spot rows: points from the poll to the tail root. */
    spine: Vec3[];
    /** Front of the muzzle (rhinarium) and the chin. */
    chin: Vec3;
    /** Preorbital glands (in front of the eyes). */
    glands: Vec3[];
    /** Metatarsal glands (outside of the hind cannons). */
    metatarsal: Vec3[];
    /** Heights of the joints the leg colouring follows. */
    carpusY: number;
    hockY: number;
  };
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const mirror = (p: Vec3): Vec3 => [-p[0], p[1], p[2]];
const along = (a: Vec3, b: Vec3) => () => normalize(sub(b, a));
/** Body hair lies backwards and a little down. */
const BACKWARD = () => [0, -0.3, -1] as Vec3;

const inChain = (rig: Rig, root: number, i: number): boolean => i === root || (rig.bones[i].parent >= 0 && inChain(rig, root, rig.bones[i].parent));

/**
 * Turns bone `name` (and everything below it) to point along `dir`, then sets
 * its length; its children move with its tail.
 */
export function aimBone(rig: Rig, name: string, dir: Vec3, length?: number): void {
  const i = rig.index.get(name);
  if (i === undefined) throw new Error(`No bone ${name}`);
  const b = rig.bones[i];
  const from = normalize(sub(b.tail, b.head)), to = normalize(dir);
  const axis = cross(from, to);
  const angle = Math.atan2(len(axis), dot(from, to));
  if (angle > 1e-6) turnChain(rig, name, axis, angle);
  if (length === undefined) return;
  const d = normalize(sub(b.tail, b.head));
  const shift = scale(d, length - len(sub(b.tail, b.head)));
  rig.bones.forEach((c, k) => {
    if (k === i || !inChain(rig, i, k)) return;
    c.head = add(c.head, shift);
    c.tail = add(c.tail, shift);
  });
  b.tail = add(b.head, scale(d, length));
}

/**
 * The deer skeleton: the source rig in meters, without the root and pole
 * targets, the feet re-parented, leaf bones given proper tails (cannon to
 * fetlock, head to the nose), and the photo's stance: ears up, tail hanging.
 */
export function deerRig(source: Rig): Rig {
  // Copy without the skipped bones (readRig already dropped what it was told to).
  const keep = source.bones.map((b, i) => ({ b, i })).filter(({ b }) => !DEER_SKIP.includes(b.name));
  const newIndex = new Map(keep.map(({ i }, k) => [i, k]));
  const bones: RigBone[] = keep.map(({ b }) => ({ ...b, head: scale(b.head, DEER_SCALE), tail: scale(b.tail, DEER_SCALE), parent: b.parent >= 0 ? (newIndex.get(b.parent) ?? -1) : -1 }));
  const index = new Map(bones.map((b, k) => [b.name, k]));
  const rig: Rig = { bones, index };
  const bone = (n: string) => {
    const b = bones[index.get(n)!];
    if (!b) throw new Error(`No bone ${n}`);
    return b;
  };
  for (const [foot, leg] of DEER_FEET) {
    const f = index.get(foot)!, l = index.get(leg)!;
    if (f < l) throw new Error(`${foot} comes before ${leg}`);
    bones[f].parent = l;
    // The cannon ends where the pastern starts.
    bones[l].tail = [...bones[f].head];
  }
  // The head bone runs from the poll towards the nose tip.
  const head = bone("Head");
  head.tail = add(head.head, scale(normalize(sub(head.tail, head.head)), 0.2));

  const deg = Math.PI / 180;
  for (const [side, s] of [["L", 1], ["R", -1]] as const) turnChain(rig, `Ear1.${side}`, [0, 0, 1], s * EAR_RAISE * deg);
  // Tail: set on at the top of the rump and hanging close to the buttocks (the low-poly tail sticks out).
  aimBone(rig, "Tail1", [0, 0.95, -1], 0.11);
  aimBone(rig, "Tail2", [0, -1, -0.32], 0.085);
  aimBone(rig, "Tail3", [0, -1, -0.08], 0.11);
  return rig;
}

/** The base deer: skeleton and body parts. */
export function deerBody(source: Rig): DeerBody {
  const rig = deerRig(source);
  const bone = (n: string) => rig.bones[rig.index.get(n)!];
  const H = (n: string) => bone(n).head;
  const T = (n: string) => bone(n).tail;

  const parts: BodyPart[] = [];
  const put = (prim: Primitive, k: number, bones: string[], region: Region, flow: (p: Vec3) => Vec3, fur = 1, carve = false) =>
    parts.push({ prim, k, carve, bones, region, flow, fur });
  const F = DEER_FUR;

  // --- Trunk: one loft from the forechest to the buttocks (photo side profile; widths from the low-poly deer) ---
  // The path is straight (a wavy path makes the nearest-section search jump: seams); top and under line are distances from it.
  const pathY = (z: number) => 0.65 - 0.14 * z;
  const sec = (z: number, top: number, bottom: number, w: number, n = 2.2): LoftKey => ({ at: [0, pathY(z), z], w: w - F, up: top - pathY(z) - F, down: pathY(z) - bottom - F, n });
  put(loft("trunk", [
    sec(0.43, 0.66, 0.54, 0.04),
    sec(0.39, 0.76, 0.5, 0.08),
    sec(0.33, 0.815, 0.472, 0.1, 2.3),
    sec(0.24, 0.818, 0.452, 0.112, 2.4),
    sec(0.13, 0.812, 0.438, 0.122, 2.4),
    sec(0.03, 0.81, 0.432, 0.126, 2.4),
    sec(-0.06, 0.82, 0.448, 0.123, 2.3),
    sec(-0.14, 0.834, 0.5, 0.114),
    sec(-0.22, 0.846, 0.54, 0.112),
    sec(-0.3, 0.84, 0.58, 0.104),
    sec(-0.37, 0.806, 0.62, 0.086),
    // Small end, buried under the tail root (lofts end in a flat cap).
    sec(-0.4, 0.76, 0.67, 0.035),
  ]), 0, ["Back", "Torso", "Torso2", "Torso3"], "torso", BACKWARD);

  // --- Neck: straight crest and throat lines (photo), sections along the neck bones ---
  const poll = H("Head");
  const crestA: Vec3 = [0, 0.83, 0.31], crestB: Vec3 = [0, 1.07, 0.445];
  const throatA: Vec3 = [0, 0.905, 0.535], throatB: Vec3 = [0, 0.55, 0.405];
  const toLine = (p: Vec3, a: Vec3, b: Vec3) => {
    const dy = b[1] - a[1], dz = b[2] - a[2];
    return Math.abs((p[1] - a[1]) * dz - (p[2] - a[2]) * dy) / Math.hypot(dy, dz);
  };
  const nk = (at: Vec3, w: number): LoftKey => ({ at, w: w - F, up: toLine(at, crestA, crestB) - F, down: toLine(at, throatA, throatB) - F, n: 2.15 });
  put(loft("neck", [
    nk([0, 0.68, 0.33], 0.082),
    nk(lerp(H("Neck1"), H("Neck2"), 0.5), 0.07),
    nk(H("Neck2"), 0.06),
    nk(lerp(H("Neck2"), H("Neck3"), 0.5), 0.052),
    nk(H("Neck3"), 0.05),
    nk(lerp(H("Neck3"), poll, 0.55), 0.046),
    { at: add(poll, [0, -0.03, 0.035]), w: 0.03, up: 0.03, down: 0.03, n: 2 },
  ]), 0.04, ["Torso3", "Neck1", "Neck2", "Neck3", "Head"], "neck", () => [0, -1, -0.35], 1.1);

  // --- Head: a long, tapering wedge from the poll to the muzzle, straight nasal bridge ---
  const tip: Vec3 = [0, 0.962, 0.733];
  const headY = (z: number) => 1.012 + ((z - 0.445) * (0.965 - 1.012)) / (0.728 - 0.445);
  const hd = (z: number, top: number, bottom: number, w: number, n = 2.3): LoftKey => ({ at: [0, headY(z), z], w, up: top - headY(z), down: headY(z) - bottom, n });
  put(loft("skull", [
    hd(0.445, 1.07, 0.955, 0.046),
    hd(0.48, 1.088, 0.93, 0.06),
    hd(0.53, 1.085, 0.915, 0.066, 2.4),
    hd(0.575, 1.062, 0.922, 0.054, 2.5),
    hd(0.625, 1.03, 0.928, 0.042, 2.6),
    hd(0.67, 1.008, 0.932, 0.034, 2.6),
    hd(0.705, 0.996, 0.936, 0.031, 2.5),
    hd(0.728, 0.988, 0.942, 0.026, 2.2),
  ]), 0.045, ["Head", "Neck3"], "head", BACKWARD, 0.6);
  // Cheeks (masseter) and the angle of the jaw behind them.
  for (const s of [1, -1]) {
    put(ellipsoid("cheek", [0.04 * s, 0.955, 0.54], frameFrom([0, -0.3, 1]), [0.018, 0.026, 0.042]), 0.035, ["Head"], "head", BACKWARD, 0.6);
  }
  // Lower jaw and chin: a slim round cone under the muzzle.
  put(capsule("jaw", [0, 0.935, 0.52], [0, 0.937, 0.712], 0.03, 0.016, [1, 0, 0], [1, 0.7]), 0.025, ["Head"], "jaw", BACKWARD, 0.5);
  put(ellipsoid("chin", [0, 0.935, 0.705], frameFrom([0, 0, 1]), [0.017, 0.012, 0.022]), 0.012, ["Head"], "jaw", BACKWARD, 0.4);
  // Muzzle (marks the region) and the rhinarium: the bare, moist nose pad at the front.
  put(capsule("muzzle", [0, 0.97, 0.63], [0, 0.966, 0.712], 0.029, 0.025, [1, 0, 0], [0.95, 1]), 0.02, ["Head"], "muzzle", BACKWARD, 0.5);
  put(ellipsoid("nose", add(tip, [0, 0.0, -0.006]), frameFrom([0, 0.25, 1]), [0.021, 0.019, 0.013]), 0.012, ["Head"], "nose", BACKWARD, 0);
  for (const s of [1, -1]) {
    // Nostrils: comma-shaped slits at the sides of the nose pad.
    put(ellipsoid("nostril", [0.014 * s, 0.97, tip[2] + 0.002], frameFrom([0.6 * s, 0.6, 1], [0, 1, 0]), [0.004, 0.01, 0.007]), 0.003, ["Head"], "nose", BACKWARD, 0, true);
  }

  // --- Eyes: large, set on the sides of the skull, sunk into almond lids ---
  const eyeR = 0.0145;
  const eyes = [1, -1].map((s) => {
    const from: Vec3 = [0, 1.035, 0.552];
    const out = normalize([1 * s, 0.12, 0.28]) as Vec3;
    let t = 0;
    while (t < 0.15 && bodyDistance(parts, add(from, scale(out, t))) < 0) t += 0.0005;
    const center = add(from, scale(out, t - eyeR * 0.72));
    return { center, radius: eyeR, look: normalize([0.85 * s, 0.05, 0.55]) as Vec3, out, side: s };
  });
  const glands: Vec3[] = [];
  for (const e of eyes) {
    // Upper lid and brow ridge, then the almond opening, slanting up towards the back.
    put(ellipsoid("brow", add(e.center, [0.004 * e.side, 0.012, -0.004]), frameFrom([0, 0.15, 1]), [0.012, 0.007, 0.02]), 0.01, ["Head"], "head", BACKWARD, 0.5);
    put(ellipsoid("socket", add(e.center, scale(e.out, 0.003)), frameFrom(e.out, normalize([0, -0.22, 1])), [eyeR * 1.42, eyeR * 0.64, eyeR * 0.95]), 0.0025, ["Head"], "head", BACKWARD, 0.3, true);
    // Preorbital gland: a dark slit in front of the eye, running down towards the mouth.
    const g = add(e.center, [-0.002 * e.side, -0.011, 0.024]);
    glands.push(g);
    put(ellipsoid("gland", g, frameFrom([0, -0.55, 1], [e.side, 0, 0]), [0.002, 0.0035, 0.011]), 0.003, ["Head"], "head", BACKWARD, 0.2, true);
  }

  // --- Ears: large ovals, cupped, on short stalks behind the eyes ---
  for (const side of ["L", "R"] as const) {
    const s = side === "L" ? 1 : -1;
    const base = H(`Ear2.${side}`), mid = H(`Ear3.${side}`), tipE = T(`Ear4.${side}`);
    const axis = normalize(sub(tipE, base));
    // The opening faces forward and out.
    const facing = normalize(sub([0.45 * s, 0.1, 1], scale(axis, dot([0.45 * s, 0.1, 1], axis))));
    const ears = [`Ear1.${side}`, `Ear2.${side}`, `Ear3.${side}`, `Ear4.${side}`];
    const stalk = lerp(H(`Ear1.${side}`), base, 0.5);
    put(capsule("earbase", stalk, lerp(base, mid, 0.5), 0.018, 0.02, facing, [0.8, 1]), 0.02, ears, "ear", along(base, tipE), 0.6);
    // The flap: widest a little above its middle, rounded at the tip; thin from front to back.
    const c = lerp(base, tipE, 0.52);
    const width = facing; // across the flap's thin direction is `facing`
    const side2 = normalize(cross(axis, width));
    put(ellipsoid("ear", add(c, scale(axis, 0.006)), { u: side2, v: width, w: axis }, [0.036, 0.012, 0.071]), 0.012, ears, "ear", along(base, tipE), 0.4);
    // Cup: hollow the front of the flap.
    put(ellipsoid("ear", add(c, add(scale(width, 0.0105), scale(axis, 0.014))), { u: side2, v: width, w: axis }, [0.03, 0.009, 0.062]), 0.004, ears, "ear", along(base, tipE), 0.3, true);
  }

  // --- Front legs: scapula on the chest wall, upper arm and elbow, forearm, carpus, cannon, fetlock, pastern, hoof ---
  let carpusY = 0;
  for (const side of ["L", "R"] as const) {
    const s = side === "L" ? 1 : -1;
    const m = (p: Vec3): Vec3 => (s > 0 ? p : mirror(p));
    const shoulder = H(`FrontUpperLeg.${side}`), carpus = H(`FrontLowerLeg.${side}`), fet = H(`IKFrontLeg.${side}`), coronet = H(`FF.${side}`);
    carpusY = carpus[1];
    const up = [`FrontUpperLeg.${side}`, `FrontShoulder.${side}`];
    // Scapula: a flat blade from the withers down to the point of the shoulder.
    put(capsule("scapula", m([0.07, 0.75, 0.2]), m([0.098, 0.565, 0.345]), 0.03, 0.04, m([1, 0, 0]), [0.55, 1]), 0.06, [`FrontShoulder.${side}`, "Torso2", "Torso3"], "torso", BACKWARD);
    // Upper arm: from the point of the shoulder back and down to the elbow, with the triceps behind it.
    const elbow: Vec3 = m([0.092, 0.445, 0.22]);
    put(capsule("upperarm", m([0.088, 0.565, 0.345]), add(elbow, [0, 0.03, 0.04]), 0.031, 0.027, [1, 0, 0], [0.7, 1]), 0.07, up, "leg", along(shoulder, carpus));
    put(ellipsoid("triceps", m([0.088, 0.51, 0.26]), frameFrom([0, -1, -0.3], [1, 0, 0]), [0.028, 0.042, 0.065]), 0.06, up, "leg", along(shoulder, carpus));
    put(ellipsoid("elbow", elbow, frameFrom([0, 1, 0]), [0.014, 0.014, 0.018]), 0.045, up, "leg", along(shoulder, carpus));
    // Forearm: muscled at the top, tapering to the knee.
    const fa0: Vec3 = [carpus[0], 0.445, carpus[2] - 0.022];
    put(capsule("forearm", fa0, add(carpus, [0, 0.025, 0]), 0.032, 0.0155, [1, 0, 0], [0.75, 1]), 0.05, up, "leg", along(fa0, carpus), 0.7);
    // Carpus ("knee"): a knobbly joint, flat in front.
    put(ellipsoid("carpus", add(carpus, [0, 0.002, 0.001]), frameFrom([0, 1, 0], [1, 0, 0]), [0.0145, 0.0175, 0.02]), 0.012, [`FrontLowerLeg.${side}`, `FrontUpperLeg.${side}`], "leg", along(carpus, fet), 0.5);
    // Cannon: slim, deeper than wide (the flexor tendons behind the bone).
    put(capsule("cannon", add(carpus, [0, -0.012, -0.002]), add(fet, [0, 0.014, -0.002]), 0.0125, 0.0112, [1, 0, 0], [0.78, 1]), 0.012, [`FrontLowerLeg.${side}`], "leg", along(carpus, fet), 0.4);
    // Fetlock, pastern, dewclaws.
    put(ellipsoid("fetlock", add(fet, [0, 0.003, -0.004]), frameFrom([0, 1, 0], [1, 0, 0]), [0.0125, 0.0145, 0.017]), 0.01, [`IKFrontLeg.${side}`, `FrontLowerLeg.${side}`], "leg", along(fet, coronet), 0.35);
    put(capsule("pastern", fet, add(coronet, [0, 0.004, -0.002]), 0.012, 0.0125, [1, 0, 0], [0.9, 1]), 0.008, [`IKFrontLeg.${side}`], "leg", along(fet, coronet), 0.3);
    for (const d of [1, -1]) put(ellipsoid("dewclaw", add(fet, [0.0068 * d, -0.013, -0.0135]), frameFrom([0, -0.7, -1]), [0.0035, 0.0035, 0.0062]), 0.005, [`IKFrontLeg.${side}`], "hoof", () => [0, -1, 0], 0);
    hooves(put, coronet, [`FF.${side}`, `IKFrontLeg.${side}`]);
  }

  // --- Hind legs: thigh and hams, stifle, gaskin, hock with its point, cannon, fetlock, pastern, hoof ---
  let hockY = 0;
  const metatarsal: Vec3[] = [];
  for (const side of ["L", "R"] as const) {
    const s = side === "L" ? 1 : -1;
    const m = (p: Vec3): Vec3 => (s > 0 ? p : mirror(p));
    const hip = H(`BackLeg.${side}`), stifle = H(`BackUpperLeg.${side}`), hock = H(`BackLowerLeg.${side}`), fet = H(`IKBackLeg.${side}`), coronet = H(`FFB.${side}`);
    hockY = hock[1];
    const thighBones = [`BackLeg.${side}`, `BackShoulder.${side}`, "Back"];
    // Thigh: the big quadriceps mass from the hip down to the stifle, kept below the croup's top line.
    put(ellipsoid("thigh", m([0.098, 0.6, -0.235]), frameFrom([0, -1, 0.35], [1, 0, 0]), [0.045, 0.085, 0.12]), 0.06, thighBones, "leg", along(hip, stifle));
    // Hams: the muscles behind the thigh that make the rounded buttock, running down to the gaskin.
    put(ellipsoid("hams", m([0.074, 0.6, -0.365]), frameFrom([0, -1, 0.05], [1, 0, 0]), [0.046, 0.058, 0.15]), 0.07, thighBones, "leg", along(hip, stifle));
    put(ellipsoid("stifle", add(stifle, m([0, 0.015, 0.012])), frameFrom([0, -1, 0.3], [1, 0, 0]), [0.026, 0.026, 0.045]), 0.06, [`BackLeg.${side}`, `BackUpperLeg.${side}`], "leg", along(hip, stifle));
    // Gaskin: muscled at the top, narrowing to the Achilles tendon above the hock.
    const g0 = add(stifle, m([0, 0.01, -0.03]));
    put(capsule("gaskin", g0, add(hock, [0, 0.02, 0.008]), 0.04, 0.0145, [1, 0, 0], [0.7, 1]), 0.05, [`BackUpperLeg.${side}`, `BackLeg.${side}`], "leg", along(stifle, hock), 0.7);
    // Calf (gastrocnemius) behind the tibia: the back of the leg runs almost straight down from the hams to the hock.
    put(capsule("calf", m([0.084, 0.53, -0.325]), add(hock, [0, 0.03, -0.012]), 0.05, 0.013, [1, 0, 0], [0.62, 1]), 0.05, [`BackUpperLeg.${side}`, `BackLeg.${side}`], "leg", along(stifle, hock), 0.7);
    put(capsule("tendon", add(g0, [0, -0.06, -0.035]), add(hock, [0, 0.012, -0.012]), 0.012, 0.008, [1, 0, 0], [0.7, 1]), 0.03, [`BackUpperLeg.${side}`], "leg", along(stifle, hock), 0.6);
    // Hock: the joint and the point of the hock (calcaneus) behind it.
    put(ellipsoid("hock", hock, frameFrom([0, 1, 0], [1, 0, 0]), [0.015, 0.021, 0.024]), 0.012, [`BackLowerLeg.${side}`, `BackUpperLeg.${side}`], "leg", along(hock, fet), 0.5);
    put(ellipsoid("hockpoint", add(hock, [0, 0.012, -0.018]), frameFrom([0, 1, -0.5]), [0.0085, 0.0085, 0.013]), 0.01, [`BackLowerLeg.${side}`, `BackUpperLeg.${side}`], "leg", along(hock, fet), 0.4);
    // Cannon (metatarsus): long and slim; the metatarsal gland sits on its outside.
    put(capsule("cannon", add(hock, [0, -0.016, 0.004]), add(fet, [0, 0.014, -0.002]), 0.0132, 0.0115, [1, 0, 0], [0.75, 1]), 0.012, [`BackLowerLeg.${side}`], "leg", along(hock, fet), 0.4);
    metatarsal.push(add(lerp(hock, fet, 0.42), m([0.011, 0, -0.004])));
    put(ellipsoid("fetlock", add(fet, [0, 0.003, -0.004]), frameFrom([0, 1, 0], [1, 0, 0]), [0.0125, 0.0145, 0.017]), 0.01, [`IKBackLeg.${side}`, `BackLowerLeg.${side}`], "leg", along(fet, coronet), 0.35);
    put(capsule("pastern", fet, add(coronet, [0, 0.004, -0.002]), 0.012, 0.0125, [1, 0, 0], [0.9, 1]), 0.008, [`IKBackLeg.${side}`], "leg", along(fet, coronet), 0.3);
    for (const d of [1, -1]) put(ellipsoid("dewclaw", add(fet, [0.0068 * d, -0.013, -0.0135]), frameFrom([0, -0.7, -1]), [0.0035, 0.0035, 0.0062]), 0.005, [`IKBackLeg.${side}`], "hoof", () => [0, -1, 0], 0);
    hooves(put, coronet, [`FFB.${side}`, `IKBackLeg.${side}`]);
  }

  // --- Tail: short and flat, hanging over the rump patch ---
  const tail = ["Tail1", "Tail2", "Tail3"];
  const radii = [0.022, 0.024, 0.021, 0.011];
  tail.forEach((n, i) => {
    const a = H(n), b = T(n);
    put(capsule("tail", a, b, radii[i], radii[i + 1], [1, 0, 0], [1.3, 0.62]), i === 0 ? 0.03 : 0.012, i === 0 ? [n, "Back"] : [n, tail[i - 1]], "tail", along(a, b), 1.6);
  });

  // Spine line for the dorsal stripe and the rows of spots: along the top of the neck and back.
  const spine: Vec3[] = [crestB, crestA, [0, 0.82, 0.24], [0, 0.812, 0.06], [0, 0.835, -0.14], [0, 0.846, -0.24], [0, 0.82, -0.33], H("Tail2")];
  return {
    rig,
    parts,
    eyes,
    marks: {
      brows: eyes.map((e) => add(e.center, [0, 0.018, -0.006])),
      nose: tip,
      // No jaw bone: the mouth stays closed (z0 beyond the head, so nothing is split).
      mouth: { y0: 0.94, y1: 0.944, z0: 10, z1: 11, halfWidth: 0.03 },
    },
    deer: { rump: [0, 0.72, -0.4], spine, chin: [0, 0.928, 0.7], glands, metatarsal, carpusY, hockY },
  };
}

/** A cloven hoof: two toes (claws) with a cleft between them, pointed at the front. */
function hooves(put: (prim: Primitive, k: number, bones: string[], region: Region, flow: (p: Vec3) => Vec3, fur?: number, carve?: boolean) => void, coronet: Vec3, bones: string[]): void {
  const x = coronet[0], z = coronet[2];
  for (const d of [1, -1]) {
    const heel: Vec3 = [x + 0.0072 * d, 0.02, z - 0.008];
    const toe: Vec3 = [x + 0.0058 * d, 0.0055, z + 0.02];
    put(capsule("hoof", heel, toe, 0.0115, 0.0055, [1, 0, 0], [0.62, 1]), 0.004, bones, "hoof", () => [0, -1, 0.3], 0);
  }
  // Flat soles on the ground.
  put(box("sole", [x, -0.02, z], frameFrom([0, 0, 1]), [0.04, 0.02, 0.05]), 0.002, bones, "hoof", () => [0, -1, 0.3], 0, true);
}

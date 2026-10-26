/**
 * The base chicken: a brown laying hen (an ISA Brown type, about 0.42 m to
 * the top of the comb), modelled on a side photo supplied by Arnd
 * (/mnt/project-files/research/animal-previews/brown-hen-reference.png), on
 * the skeleton of Mesh2Motion's CC0 bird rig (wings with feather bones, an
 * upper and lower beak, a tail chain and bird legs). Only its bones are used:
 * they are placed onto the hen's joints, wings folded, and the body is drawn
 * around them as a smooth implicit surface.
 *
 * Positions are photo pixels (`P(px, py, x)`, x in metres to the hen's left).
 * The photo is a slight front-quarter view, so lengths along the body are
 * stretched by `ZS` to undo the foreshortening.
 *
 * The folded wings are separate surfaces (BodyPart.layer): two plates per
 * side, the coverts and secondaries over the primaries, sunk a little into
 * the body. They don't merge with it, so a wing can open in the flap clip.
 */
import { type Vec3, normalize } from "@actors/core";
import type { BodyPart, DogBody, Region } from "./dog";
import { type Rig, placeBones } from "./rig";
import { type Frame, type LoftKey, type Primitive, bodyDistance, box, capsule, ellipsoid, frameFrom, loft } from "./sdf";

/** Metres per photo pixel (comb top 0.42 m above the ground). */
const S = 0.00095;
/** Stretch along the body (the photo's front-quarter view foreshortens it). */
const ZS = 1.1;
const GROUND = 563;
/** Photo pixel (x right = backward, y down) to pack space; `x` is the lateral offset in metres (+: left). */
export const P = (px: number, py: number, x = 0): Vec3 => [x, (GROUND - py) * S, (330 - px) * S * ZS];
/** A length along the body in photo pixels, in metres. */
const PZ = (px: number) => px * S * ZS;
const PY = (py: number) => py * S;

/** Feather length the body surface leaves room for (metres). */
export const CHICKEN_FEATHER = 0.003;

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const along = (a: Vec3, b: Vec3) => () => normalize(sub(b, a));
const BACKWARD = () => [0, -0.3, -1] as Vec3;

export const SIDES = ["L", "R"] as const;
export const WING_INNER = ["wing_1", "wing_2", "wing_feather_1_1", "wing_feather_1_2", "wing_feather_2_1", "wing_feather_2_2"];
export const WING_OUTER = ["wing_3", "wing_4", "wing_5", "wing_tip", "wing_feather_3_1", "wing_feather_3_2", "wing_feather_4_1", "wing_feather_4_2"];
export const LEG = ["UpperLeg", "LowerLeg", "AnkleLeg", "Foot", "Toes", "Toes_tip"];
export const TAIL = ["tail_1", "tail_2", "tail_3", "tail_tip"];

/** Where the photo puts the head: back of the skull, base and tip of the beak, the gape. */
const OCCIPUT = P(205, 153);
const BEAK_BASE = P(154, 162);
const BEAK_TIP = P(131, 175.5);
const GAPE = P(160, 172);

/** The chicken's skeleton: every bone of Mesh2Motion's bird rig placed on the photo, wings folded. */
export function chickenRig(source: Rig): Rig {
  const rig: Rig = { bones: source.bones.map((b) => ({ ...b, head: [...b.head] as Vec3, tail: [...b.tail] as Vec3 })), index: source.index };
  const place: Record<string, [Vec3, Vec3]> = {};
  const chain = (names: string[], points: Vec3[]) => names.forEach((n, i) => (place[n] = [points[i], points[i + 1]]));
  chain(["hips", "spine_0", "spine_1", "spine_2", "spine_3"], [P(395, 330), P(335, 328), P(275, 320), P(236, 290), P(218, 228), P(205, 160)]);
  chain(["head", "mouth_upper", "mouth_upper_tip"], [P(205, 160), BEAK_BASE, P(140, 167), BEAK_TIP]);
  chain(["mouth_lower", "mouth_lower_tip"], [GAPE, P(146, 172.5), P(138, 173.5)]);
  chain(TAIL, [P(438, 300), P(462, 292), P(470, 262), P(476, 232), P(483, 204)]);
  for (const [side, s] of [["L", 1], ["R", -1]] as const) {
    const W = (px: number, py: number, x: number) => P(px, py, x * s);
    // Folded wing: the upper arm runs back from the shoulder, the forearm forward to the wrist
    // (the bend of the wing), the hand back again to the tips of the primaries.
    chain([`wing_1_${side}`, `wing_2_${side}`], [W(262, 294, 0.05), W(330, 318, 0.074), W(250, 310, 0.082)]);
    chain([`wing_3_${side}`, `wing_4_${side}`, `wing_5_${side}`, `wing_tip_${side}`], [W(250, 310, 0.082), W(305, 322, 0.087), W(365, 330, 0.088), W(412, 336, 0.086), W(436, 340, 0.083)]);
    // Feather bones: along the trailing edge, backwards.
    chain([`wing_feather_1_1_${side}`, `wing_feather_1_2_${side}`], [W(295, 322, 0.08), W(345, 340, 0.08), W(392, 350, 0.08)]);
    chain([`wing_feather_2_1_${side}`, `wing_feather_2_2_${side}`], [W(285, 326, 0.084), W(335, 346, 0.084), W(385, 354, 0.084)]);
    chain([`wing_feather_3_1_${side}`, `wing_feather_3_2_${side}`], [W(340, 333, 0.087), W(385, 349, 0.087), W(420, 350, 0.087)]);
    chain([`wing_feather_4_1_${side}`, `wing_feather_4_2_${side}`], [W(392, 338, 0.086), W(424, 345, 0.086), W(440, 344, 0.086)]);
    // Leg: hip, knee (hidden in the body feathers), hock, the bare shank down to the foot, the middle toe.
    chain(LEG.map((b) => `${b}_${side}`), [W(362, 385, 0.035), W(310, 428, 0.055), W(345, 497, 0.046), W(343, 551, 0.043), W(322, 557, 0.043), W(300, 559, 0.043), W(283, 560, 0.043)]);
  }
  placeBones(rig, place);
  return rig;
}

/** A loft section from photo outline values: column `px` (z), top and bottom y, half width (m). */
const section = (px: number, top: number, bottom: number, w: number, n = 2.2): LoftKey => {
  const a = P(px, top), b = P(px, bottom);
  const F = CHICKEN_FEATHER;
  return { at: [0, (a[1] + b[1]) / 2, a[2]], w: w - F, up: (a[1] - b[1]) / 2 - F, down: (a[1] - b[1]) / 2 - F, n };
};

export interface ChickenBody extends DogBody {
  /** Comb parts (for the comb morphs) and wattle parts. */
  comb: Primitive[];
  wattles: Primitive[];
  /** Centre of the bare red face skin and its radii (z, y; metres). */
  face: { center: Vec3; radii: [number, number] };
}

/** The base hen: placed rig and body parts (see dog.ts for how parts make the surface, weights and coat regions). */
export function chickenBody(source: Rig): ChickenBody {
  const rig = chickenRig(source);
  const bone = (n: string) => rig.bones[rig.index.get(n)!];
  const H = (n: string) => bone(n).head;
  const parts: BodyPart[] = [];
  const put = (prim: Primitive, k: number, bones: string[], region: Region, flow: (p: Vec3) => Vec3, fur = 1, carve = false, layer = 0) =>
    parts.push({ prim, k, carve, bones, region, flow, fur, layer });
  const F = CHICKEN_FEATHER;

  // --- Trunk: an egg from the vent to the breast (photo top and under lines; half widths from a hen's build) ---
  put(loft("trunk", [
    section(482, 300, 392, 0.028),
    section(458, 262, 438, 0.058),
    section(422, 252, 458, 0.078),
    section(382, 261, 465, 0.088),
    section(336, 262, 466, 0.092),
    section(290, 256, 456, 0.09),
    section(250, 262, 434, 0.084),
    section(214, 272, 410, 0.074),
    section(186, 286, 390, 0.058),
    section(168, 304, 362, 0.032),
  ]), 0, ["hips", "spine_0", "spine_1"], "torso", BACKWARD);
  // Full breast: rounds the front off (the loft's end cap would be flat).
  put(ellipsoid("breast", P(210, 332), frameFrom([0, 0, 1]), [0.068 - F, 0.06 - F, 0.047 - F]), 0.03, ["spine_1", "spine_0"], "torso", () => [0, -1, -0.5]);
  // Rear fluff: the soft feathers under the tail and around the vent.
  put(ellipsoid("fluff", P(400, 414), frameFrom([0, 0.3, -1]), [0.07 - F, 0.048 - F, 0.064 - F]), 0.03, ["hips", "spine_0", "tail_1"], "fluff", () => [0, -0.8, -0.6], 2.2);

  // --- Neck: hackle feathers make it thick; a loft up the neck (its "up" side is the back of the neck) ---
  const nk = (py: number, front: number, back: number, w: number): LoftKey => {
    const c = P((front + back) / 2, py);
    const half = PZ((back - front) / 2) - F;
    return { at: c, w: w - F, up: half, down: half, n: 2.1 };
  };
  put(loft("neck", [
    nk(272, 162, 292, 0.062),
    nk(246, 161, 270, 0.056),
    nk(220, 163, 255, 0.047),
    nk(196, 172, 238, 0.038),
    nk(172, 186, 222, 0.029),
    nk(156, 194, 212, 0.022),
  ], [0, 0, -1]), 0.02, ["spine_2", "spine_3", "spine_1", "head"], "neck", () => [0, -1, -0.35], 1.15);

  // --- Head: a small round skull tapering to the beak (a loft from the back of the skull to the beak's base) ---
  const axis = (t: number, dy = 0): Vec3 => add(lerp(OCCIPUT, BEAK_BASE, t), [0, dy, 0]);
  const hd = (t: number, dy: number, w: number, up: number, down: number, n = 2.1): LoftKey => ({ at: axis(t, dy), w, up, down, n });
  put(loft("skull", [
    hd(-0.1, 0.0, 0.014, 0.012, 0.014),
    hd(0.12, 0.001, 0.021, 0.018, 0.02),
    hd(0.42, 0.0, 0.021, 0.0175, 0.02),
    hd(0.72, -0.001, 0.0165, 0.013, 0.0155),
    hd(0.95, -0.001, 0.0095, 0.0085, 0.0095),
  ]), 0.008, ["head", "spine_3"], "head", () => [0, -0.1, -1], 0.35);
  // Cheeks under the eyes, full down to the jaw (the face skin is bare and red).
  for (const s of [1, -1]) put(ellipsoid("cheek", add(axis(0.55, -0.011), [0.009 * s, 0, 0]), frameFrom(sub(BEAK_BASE, OCCIPUT)), [0.011, 0.012, 0.018]), 0.008, ["head"], "head", () => [0, -0.2, -1], 0.25);

  // --- Beak: a curved horn cone over a shorter lower beak, with the gape between them ---
  put(loft("beak", [
    { at: add(BEAK_BASE, [0, 0.0003, 0.002]), w: 0.0085, up: 0.0068, down: 0.0062, n: 2.2 },
    { at: P(145, 165), w: 0.006, up: 0.0052, down: 0.0042, n: 2.2 },
    { at: P(137, 169.5), w: 0.0036, up: 0.0034, down: 0.0024, n: 2.1 },
    { at: P(132, 174.5), w: 0.0013, up: 0.0013, down: 0.001, n: 2 },
  ]), 0.004, ["mouth_upper", "mouth_upper_tip", "head"], "nose", () => [0, -0.2, 1], 0);
  put(loft("lowerbeak", [
    { at: add(GAPE, [0, 0, -0.001]), w: 0.0072, up: 0.0026, down: 0.0042, n: 2.2 },
    { at: P(148, 171.5), w: 0.0048, up: 0.0022, down: 0.003, n: 2.2 },
    { at: P(139, 173), w: 0.0016, up: 0.001, down: 0.0012, n: 2 },
  ]), 0.004, ["mouth_lower", "mouth_lower_tip"], "jaw", () => [0, 0, 1], 0);
  // The gape: a thin slit between the beaks, so the beak can open.
  const mouthBack = P(164, 171.5), mouthFront = P(138, 172);
  const slit: Frame = frameFrom(sub(mouthFront, mouthBack));
  put(box("mouth", lerp(mouthBack, mouthFront, 0.5), slit, [0.012, 0.0006, Math.hypot(...sub(mouthFront, mouthBack)) / 2]), 0.0008, ["mouth_lower"], "jaw", BACKWARD, 0, true);

  // --- Comb: a single comb, a thin blade over the crown with five rounded points ---
  const comb: Primitive[] = [];
  const combDir = normalize(sub(P(202, 141), P(150, 151)));
  comb.push(ellipsoid("comb", P(174, 145), frameFrom(combDir, [1, 0, 0]), [0.0028, 0.0095, 0.029]));
  for (const [px, top] of [[148, 130], [159, 124], [171, 122], [183, 124], [195, 130]] as [number, number][]) {
    comb.push(capsule("comb", P(px + 2, 145), P(px - 1, top), 0.0058, 0.0016, [1, 0, 0], [0.55, 1]));
  }
  for (const c of comb) put(c, 0.0025, ["head"], "comb", () => [0, 1, 0], 0);

  // --- Wattles: two rounded lobes hanging under the beak ---
  const wattles: Primitive[] = [];
  for (const s of [1, -1]) wattles.push(ellipsoid("wattle", P(163, 189, 0.0038 * s), frameFrom([0, 1, -0.15], [1, 0, 0]), [0.003, 0.0105, 0.012]));
  for (const w of wattles) put(w, 0.004, ["head", "mouth_lower"], "comb", () => [0, -1, 0], 0);

  // Eyes: on the sides of the skull, looking out and a little forward.
  const eyeR = 0.0052;
  const eyes = [1, -1].map((s) => {
    const from = P(175, 156);
    const out = normalize([0.96 * s, 0.1, 0.25]) as Vec3;
    let t = 0;
    while (t < 0.05 && bodyDistance(parts, add(from, scale(out, t))) < 0) t += 0.0002;
    const center = add(from, scale(out, t - eyeR * 0.55));
    return { center, radius: eyeR, look: normalize([0.9 * s, 0.05, 0.42]) as Vec3, out, side: s };
  });
  for (const e of eyes) put(ellipsoid("socket", add(e.center, scale(e.out, 0.0004)), frameFrom(e.out, [0, 1, 0]), [eyeR * 1.05, eyeR * 1.0, eyeR * 1.0]), 0.001, ["head"], "head", BACKWARD, 0.2, true);
  // Earlobes: small flat ovals behind the face, below the eyes.
  for (const s of [1, -1]) {
    const from = P(191, 173);
    const out: Vec3 = [s, 0, 0];
    let t = 0;
    while (t < 0.05 && bodyDistance(parts, add(from, scale(out, t))) < 0) t += 0.0002;
    put(ellipsoid("earlobe", add(from, scale(out, t - 0.001)), frameFrom([0, 1, 0.2], [1, 0, 0]), [0.002, 0.0055, 0.0045]), 0.002, ["head"], "comb", () => [0, -1, 0], 0);
  }

  // --- Tail: a short fan of feathers raised behind the back, flat from side to side ---
  const TAILPATH = [P(455, 322), P(466, 284), P(473, 250), P(478, 223), P(483, 204)];
  const fan = [[0.033, 0.034], [0.036, 0.03], [0.034, 0.024], [0.027, 0.017], [0.014, 0.01]];
  put(loft("tail", TAILPATH.map((at, i) => ({ at, w: fan[i][0] - F, up: fan[i][1] - F, down: fan[i][1] - F, n: 2.3 })), [1, 0, 0]), 0.018,
    ["tail_1", "tail_2", "tail_3", "tail_tip", "hips"], "tail", () => normalize(sub(TAILPATH[4], TAILPATH[0])), 0.9);
  const tipDir = normalize(sub(TAILPATH[4], TAILPATH[3]));
  put(ellipsoid("tailtip", add(TAILPATH[4], scale(tipDir, -0.005)), frameFrom(tipDir, [1, 0, 0]), [0.008, 0.018, 0.016]), 0.01, ["tail_tip", "tail_3"], "tail", () => tipDir, 0.9);

  // --- Legs: feathered thighs ("drumsticks"), bare scaly shanks and four toes with claws ---
  for (const side of SIDES) {
    const s = side === "L" ? 1 : -1;
    const hip = H(`UpperLeg_${side}`), knee = H(`LowerLeg_${side}`), hock = H(`AnkleLeg_${side}`), foot = H(`Foot_${side}`);
    put(ellipsoid("thigh", lerp(knee, hip, 0.25), frameFrom(sub(hock, knee), [1, 0, 0]), [0.03, 0.034, 0.045]), 0.025, [`UpperLeg_${side}`, `LowerLeg_${side}`, "hips"], "leg", () => [0, -1, -0.3], 1.5);
    put(capsule("drumstick", lerp(knee, hock, 0.1), lerp(knee, hock, 0.93), 0.026, 0.0105, [1, 0, 0], [0.85, 1]), 0.014, [`LowerLeg_${side}`, `UpperLeg_${side}`], "leg", () => [0, -1, -0.25], 1.4);
    // Bare shank: a little flattened, the hock joint a knob at the top.
    put(capsule("hock", add(hock, [0, 0.002, 0.001]), add(hock, [0, -0.008, 0.001]), 0.0085, 0.0072), 0.004, [`AnkleLeg_${side}`, `LowerLeg_${side}`], "paw", () => [0, -1, 0], 0);
    put(capsule("shank", add(hock, [0, -0.004, 0]), add(foot, [0, 0.002, 0]), 0.0072, 0.0062, [1, 0, 0], [0.85, 1]), 0.003, [`AnkleLeg_${side}`], "paw", () => [0, -1, 0], 0);
    put(ellipsoid("ball", [foot[0], 0.0068, foot[2] - 0.001], frameFrom([0, 0, 1]), [0.0082, 0.0068, 0.0095]), 0.004, [`Foot_${side}`, `AnkleLeg_${side}`], "paw", () => [0, 0, 1], 0);
    // Toes: middle, inner and outer forwards, the hind toe back; two segments and a claw each.
    const toes: [number, number, string[]][] = [
      [0, 0.058, [`Foot_${side}`, `Toes_${side}`, `Toes_tip_${side}`]],
      [0.42 * s, 0.045, [`Foot_${side}`, `Toes_${side}`]],
      [-0.42 * s, 0.043, [`Foot_${side}`, `Toes_${side}`]],
      [Math.PI, 0.022, [`Foot_${side}`, `AnkleLeg_${side}`]],
    ];
    for (const [yaw, length, bones] of toes) {
      // Outer toe spreads outwards (away from the midline), inner inwards.
      const dir: Vec3 = [Math.sin(yaw), 0, Math.cos(yaw)];
      const base: Vec3 = [foot[0] + dir[0] * 0.004, 0.0052, foot[2] + dir[2] * 0.004];
      const knuckle: Vec3 = [base[0] + dir[0] * length * 0.55, 0.0042, base[2] + dir[2] * length * 0.55];
      const end: Vec3 = [base[0] + dir[0] * length * 0.9, 0.0034, base[2] + dir[2] * length * 0.9];
      const claw: Vec3 = [base[0] + dir[0] * length * 1.06, 0.0012, base[2] + dir[2] * length * 1.06];
      put(capsule("toe", base, knuckle, 0.0048, 0.0038), 0.003, bones, "paw", () => dir, 0);
      put(capsule("toe", knuckle, end, 0.0038, 0.003), 0.0025, bones, "paw", () => dir, 0);
      put(capsule("claw", end, claw, 0.0024, 0.0007), 0.0015, bones, "paw", () => dir, 0);
    }
  }

  // --- Folded wings: separate surfaces lying on the sides (layer 1: coverts and secondaries; layer 2: primaries) ---
  // Where the body's side is at height y, depth z (searching inward from outside).
  const body0 = parts.slice();
  const sideX = (y: number, z: number): number => {
    let x = 0.2;
    while (x > 0 && bodyDistance(body0, [x, y, z]) > 0) x -= 0.0005;
    return x;
  };
  for (const side of SIDES) {
    const s = side === "L" ? 1 : -1;
    // Sections: column, centre height, half height (pixels); outward and inward half thickness (m); sunk depth (m).
    const plate = (name: string, keys: [number, number, number][], out: number, inn: number, lift: number, layer: number, bones: string[]) => {
      const lk: LoftKey[] = keys.map(([px, py, h]) => {
        const c = P(px, py);
        const x = sideX(c[1], c[2]) + lift;
        // With up hint +X and a backward path, a section's "up" is +X: outward on the left, inward on the right.
        return { at: [x * s, c[1], c[2]], w: Math.max(0.002, PY(h)), up: s > 0 ? out : inn, down: s > 0 ? inn : out, n: 2.4 };
      });
      // Tilted so the plate's top edge tucks in under the back feathers.
      put(loft(name, lk, [1, 0.35 * s, 0]), 0, bones.map((b) => `${b}_${side}`), "wing", () => [0, -0.18, -1], 0.6, false, layer);
    };
    plate("coverts", [[246, 309, 6], [262, 307, 17], [298, 314, 30], [340, 320, 37], [380, 323, 35], [410, 326, 27], [428, 331, 15], [438, 337, 5]], 0.0055, 0.011, 0.004, 1, WING_INNER);
    plate("primaries", [[258, 314, 6], [300, 324, 18], [350, 334, 24], [392, 338, 20], [424, 340, 12], [442, 341, 4]], 0.004, 0.009, 0.0015, 2, WING_OUTER);
  }

  const brows = eyes.map((e) => add(e.center, [0.001 * e.side, 0.006, -0.002]));
  return {
    rig,
    unit: 0.35,
    band: 4,
    parts,
    eyes: eyes.map(({ center, radius, look }) => ({ center, radius, look })),
    marks: {
      brows,
      nose: BEAK_TIP,
      mouth: { y0: mouthBack[1], y1: mouthFront[1], z0: mouthBack[2], z1: mouthFront[2], halfWidth: 0.008 },
    },
    comb,
    wattles,
    face: { center: P(171, 166), radii: [0.017, 0.013] },
  };
}

/** Bones of a side (for the clips and the viewer). */
export const sideBones = (names: string[], side: "L" | "R") => names.map((n) => `${n}_${side}`);

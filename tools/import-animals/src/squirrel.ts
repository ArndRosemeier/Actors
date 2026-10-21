/**
 * The base squirrel: an eastern grey squirrel (Sciurus carolinensis, about
 * 25 cm head and body, 22 cm tail) in its typical alert crouch, built on the
 * same quadruped rig as the dog. The rig is re-posed bone by bone from a side
 * view photo (/mnt/project-files/research/animal-previews/grey-squirrel-reference.png):
 * positions below are that photo's pixels, converted by `P`.
 *
 * Squirrel anatomy the dog doesn't have: folded hind legs with long, flat
 * feet (heel on the ground), a big haunch, short front legs with long
 * fingers, a round head with large side-set eyes and small upright ears, and
 * the plume tail carried up in an S over the back.
 */
import { type Vec3, normalize } from "@actors/core";
import type { BodyPart, DogBody, Region } from "./dog";
import { type Rig, placeBones, resizeRig } from "./rig";
import { type Frame, type LoftKey, type Primitive, bodyDistance, box, capsule, ellipsoid, frameFrom, loft } from "./sdf";

/** Meters per photo pixel. */
const S = 0.00032;
/** Photo pixel (x right = backward, y down) to pack space; `x` is the lateral offset in meters (+: left). */
const P = (px: number, py: number, x = 0): Vec3 => [x, (1040 - py) * S, (800 - px) * S];

/** Shell fur the body surface leaves room for (meters). */
export const SQUIRREL_FUR = 0.003;

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const along = (a: Vec3, b: Vec3) => () => normalize(sub(b, a));
const BACKWARD = () => [0, -0.25, -1] as Vec3;

/** Where the photo puts the head: occiput and nose tip. */
const OCCIPUT = P(378, 556);
const NOSE_TIP = P(236, 668);
/** Tail centre line (base to tip), carried up in an S. */
const TAIL = [P(885, 780), P(960, 745), P(1012, 600), P(992, 420), P(912, 272), P(815, 222)];

/** The squirrel's skeleton: every bone of the quadruped rig placed on the photo. */
export function squirrelRig(source: Rig): Rig {
  const rig = resizeRig(source, 0.15);
  const place: Record<string, [Vec3, Vec3]> = {};
  const chain = (names: string[], points: Vec3[]) => names.forEach((n, i) => (place[n] = [points[i], points[i + 1]]));
  chain(["Hips", "Spine_1", "Spine_2", "Spine_2.001", "Spine_3", "Spine_4"], [P(845, 765), P(720, 690), P(600, 650), P(490, 628), P(435, 618), P(402, 588), OCCIPUT]);
  const stop = lerp(OCCIPUT, NOSE_TIP, 0.55), noseBase = lerp(OCCIPUT, NOSE_TIP, 0.86);
  chain(["Head", "Nose", "Head.tip"], [OCCIPUT, stop, noseBase, NOSE_TIP]);
  chain(["Chin", "Chin_Tip"], [P(326, 664), P(268, 698), P(250, 701)]);
  chain(["Stomach", "Stomach_tip"], [P(600, 720), P(610, 800), P(615, 850)]);
  chain(["Tail_Base", "Tail_Mid", "Tail_Mid.001", "Tail_End", "Tail_Tip"], TAIL);
  for (const [side, s] of [["L", 1], ["R", -1]] as const) {
    chain([`Ear_${side}`, `Ear_Tip_${side}`], [P(378, 484, 0.0135 * s), P(381, 452, 0.0158 * s), P(384, 426, 0.0175 * s)]);
    chain(
      ["Shoulder", "Upper", "Lower", "Ankle", "Foot", "Tip"].map((b) => `Front_Leg_${b}_${side}`),
      [P(485, 615, 0.017 * s), P(445, 735, 0.022 * s), P(462, 852, 0.022 * s), P(440, 990, 0.02 * s), P(426, 1024, 0.02 * s), P(400, 1033, 0.02 * s), P(382, 1036, 0.02 * s)],
    );
    chain(
      ["Pelvis", "Upper", "Lower", "Ankle", "Foot", "Foot_1", "Tip"].map((b) => `Back_Leg_${b}_${side}`),
      [P(822, 722, 0.012 * s), P(815, 802, 0.025 * s), P(705, 905, 0.029 * s), P(880, 1010, 0.029 * s), P(760, 1029, 0.029 * s), P(706, 1034, 0.029 * s), P(673, 1036, 0.029 * s), P(650, 1038, 0.029 * s)],
    );
  }
  placeBones(rig, place);
  return rig;
}

/** The base squirrel: re-posed rig and body parts (see dog.ts for how parts make the surface, weights and coat regions). */
export function squirrelBody(source: Rig): DogBody {
  const rig = squirrelRig(source);
  const bone = (n: string) => rig.bones[rig.index.get(n)!];
  const H = (n: string) => bone(n).head;
  const T = (n: string) => bone(n).tail;

  const parts: BodyPart[] = [];
  const put = (prim: Primitive, k: number, bones: string[], region: Region, flow: (p: Vec3) => Vec3, fur = 1, carve = false) =>
    parts.push({ prim, k, carve, bones, region, flow, fur });
  const F = SQUIRREL_FUR;

  // --- Trunk: a hunched loft from the rump to the chest (photo outline: top line, under line, half width) ---
  const sec = (px: number, top: number, bottom: number, w: number, n = 2.1): LoftKey => {
    const a = P(px, top), b = P(px, bottom);
    return { at: [0, (a[1] + b[1]) / 2, a[2]], w: w - F, up: (a[1] - b[1]) / 2 - F, down: (a[1] - b[1]) / 2 - F, n };
  };
  put(loft("trunk", [
    sec(905, 790, 905, 0.017),
    sec(860, 735, 925, 0.027),
    sec(780, 688, 915, 0.032),
    sec(690, 645, 893, 0.034),
    sec(600, 606, 880, 0.034),
    sec(515, 586, 868, 0.033),
    sec(445, 578, 848, 0.031),
    sec(385, 598, 818, 0.026),
    sec(338, 650, 790, 0.016),
  ]), 0, ["Hips", "Spine_1", "Spine_2", "Spine_2.001", "Stomach"], "torso", BACKWARD);

  // --- Neck: short and thick; the head sits almost on the shoulders ---
  const nk = (at: Vec3, w: number, up: number, down: number): LoftKey => ({ at, w: w - F, up: up - F, down: down - F, n: 2.1 });
  put(loft("neck", [
    nk(P(460, 680), 0.028, 0.042, 0.048),
    nk(P(420, 632), 0.024, 0.035, 0.04),
    nk(add(OCCIPUT, [0, -0.006, 0.006]), 0.021, 0.027, 0.03),
  ]), 0.012, ["Spine_2.001", "Spine_3", "Spine_4", "Head"], "neck", () => [0, -0.6, -1], 1.1);

  // --- Head: a round skull and a short, blunt muzzle, as one loft from the occiput to the nose ---
  const axis = (t: number, dy = 0): Vec3 => add(lerp(OCCIPUT, NOSE_TIP, t), [0, dy, 0]);
  const hd = (t: number, dy: number, w: number, up: number, down: number, n = 2.1): LoftKey => ({ at: axis(t, dy), w, up, down, n });
  put(loft("skull", [
    hd(-0.06, 0.002, 0.013, 0.014, 0.015),
    hd(0.12, 0.004, 0.02, 0.023, 0.019),
    hd(0.32, 0.003, 0.021, 0.0235, 0.0198),
    hd(0.52, 0.0, 0.0175, 0.0195, 0.0165),
    hd(0.72, -0.001, 0.0135, 0.0132, 0.0138),
    hd(0.9, -0.001, 0.0102, 0.0102, 0.011),
    hd(0.99, -0.001, 0.0062, 0.0065, 0.0072),
  ]), 0.008, ["Head", "Nose", "Spine_4"], "head", BACKWARD, 0.55);
  // Full cheeks (the pale cheek fur behind the whisker pads).
  for (const s of [1, -1]) put(ellipsoid("cheek", add(axis(0.42), [0.011 * s, -0.01, 0]), frameFrom(sub(NOSE_TIP, OCCIPUT)), [0.011, 0.0125, 0.019]), 0.007, ["Head"], "head", BACKWARD, 0.6);
  // Whisker pads and the nose.
  for (const s of [1, -1]) put(ellipsoid("whiskerpad", add(axis(0.84), [0.0052 * s, -0.0052, -0.001]), frameFrom(sub(NOSE_TIP, OCCIPUT)), [0.0064, 0.0064, 0.008]), 0.004, ["Nose", "Head"], "muzzle", BACKWARD, 0.35);
  put(capsule("muzzle", axis(0.62, -0.002), axis(0.95, -0.0015), 0.0098, 0.0063), 0.006, ["Nose", "Head"], "muzzle", BACKWARD, 0.35);
  put(ellipsoid("nose", add(NOSE_TIP, [0, 0.0005, -0.0012]), frameFrom([0, 0.2, 1]), [0.0048, 0.0038, 0.0032]), 0.002, ["Head.tip", "Nose"], "nose", BACKWARD, 0);
  // Lower jaw: short, under the muzzle.
  const jawA = P(326, 676), jawB = P(266, 697);
  put(capsule("jaw", jawA, jawB, 0.0075, 0.0042, [1, 0, 0], [0.85, 0.7]), 0.006, ["Chin", "Chin_Tip"], "jaw", BACKWARD, 0.35);
  // Mouth: a short slit under the nose, so the jaw can chew.
  const mouthBack = P(274, 689), mouthFront = P(250, 693);
  const slitFrame: Frame = frameFrom(sub(mouthFront, mouthBack));
  put(box("mouth", lerp(mouthBack, mouthFront, 0.5), slitFrame, [0.012, 0.0006, Math.hypot(...sub(mouthFront, mouthBack)) / 2]), 0.001, ["Chin"], "jaw", BACKWARD, 0, true);

  // Eyes: large, dark and set high on the sides of the head, bulging a little.
  const eyeR = 0.0062;
  const eyes = [1, -1].map((s) => {
    const from = axis(0.38, 0.006);
    const out = normalize([0.93 * s, 0.22, 0.3]) as Vec3;
    let t = 0;
    while (t < 0.05 && bodyDistance(parts, add(from, scale(out, t))) < 0) t += 0.0002;
    const center = add(from, scale(out, t - eyeR * 0.5));
    return { center, radius: eyeR, look: normalize([0.86 * s, 0.12, 0.48]) as Vec3, out, side: s };
  });
  for (const e of eyes) {
    put(ellipsoid("socket", add(e.center, scale(e.out, 0.0004)), frameFrom(e.out, [0, 1, 0]), [eyeR * 1.06, eyeR * 1.0, eyeR * 1.0]), 0.0012, ["Head"], "head", BACKWARD, 0.3, true);
  }

  // Ears: small, upright, rounded flaps cupped forward.
  for (const side of ["L", "R"] as const) {
    const s = side === "L" ? 1 : -1;
    const a = H(`Ear_${side}`), b = T(`Ear_Tip_${side}`);
    const facing = normalize([0.45 * s, 0, 1]);
    put(capsule("ear", lerp(a, b, 0.05), lerp(a, b, 0.97), 0.011, 0.005, facing, [0.4, 1]), 0.005, [`Ear_${side}`, `Ear_Tip_${side}`], "ear", along(a, b), 0.45);
    const fwd = (p: Vec3, d: number): Vec3 => add(p, scale(facing, d));
    put(capsule("ear", fwd(lerp(a, b, 0.3), 0.0034), fwd(lerp(a, b, 0.88), 0.0018), 0.0072, 0.0032, facing, [0.3, 1]), 0.001, [`Ear_${side}`, `Ear_Tip_${side}`], "ear", along(a, b), 0.3, true);
  }

  // --- Front legs: short arms, slim forearms and hands with four long fingers ---
  for (const side of ["L", "R"] as const) {
    const s = side === "L" ? 1 : -1;
    const sh = H(`Front_Leg_Shoulder_${side}`), up = H(`Front_Leg_Upper_${side}`), el = H(`Front_Leg_Lower_${side}`);
    const wr = H(`Front_Leg_Ankle_${side}`), ft = H(`Front_Leg_Foot_${side}`), tip = T(`Front_Leg_Tip_${side}`);
    put(capsule("scapula", add(sh, [0.004 * s, -0.01, 0.002]), up, 0.011, 0.0105, [1, 0, 0], [0.6, 1]), 0.014, [`Front_Leg_Shoulder_${side}`, "Spine_2.001"], "torso", along(sh, up));
    put(capsule("upperarm", up, lerp(up, el, 0.85), 0.0135, 0.0105, [1, 0, 0], [0.85, 1]), 0.012, [`Front_Leg_Upper_${side}`, `Front_Leg_Shoulder_${side}`], "leg", along(up, el));
    put(capsule("forearm", lerp(el, wr, 0.08), wr, 0.0098, 0.0062, [1, 0, 0], [0.85, 1]), 0.008, [`Front_Leg_Lower_${side}`, `Front_Leg_Upper_${side}`], "leg", along(el, wr), 1);
    put(capsule("wrist", wr, ft, 0.0058, 0.0048), 0.003, [`Front_Leg_Ankle_${side}`, `Front_Leg_Lower_${side}`], "leg", along(wr, ft), 0.6);
    // Palm and fingers, spread a little, resting on the ground.
    const palm: Vec3 = [ft[0], 0.0036, ft[2] + 0.001];
    put(ellipsoid("palm", palm, frameFrom([0, 0, 1]), [0.0056, 0.0034, 0.0062]), 0.003, [`Front_Leg_Foot_${side}`, `Front_Leg_Ankle_${side}`], "paw", () => [0, -0.3, 1], 0.25);
    const reach = Math.hypot(tip[2] - ft[2], tip[0] - ft[0]) + 0.002;
    for (const [i, spread] of [-0.3, -0.1, 0.1, 0.3].entries()) {
      const dir = normalize([Math.sin(spread) + 0.1 * s, 0, Math.cos(spread)]);
      const len = reach * (i === 0 || i === 3 ? 0.6 : 0.75);
      const base: Vec3 = [palm[0] + dir[0] * 0.003, 0.0028, palm[2] + dir[2] * 0.003];
      put(capsule("finger", base, [base[0] + dir[0] * len, 0.0016, base[2] + dir[2] * len], 0.0022, 0.0014), 0.0015, [`Front_Leg_Tip_${side}`, `Front_Leg_Foot_${side}`], "paw", () => [0, -0.2, 1], 0.2);
    }
  }

  // --- Hind legs: the big haunch, a folded shank and the long, flat foot ---
  for (const side of ["L", "R"] as const) {
    const s = side === "L" ? 1 : -1;
    const hip = H(`Back_Leg_Upper_${side}`), knee = H(`Back_Leg_Lower_${side}`), heel = H(`Back_Leg_Ankle_${side}`);
    const ft = H(`Back_Leg_Foot_${side}`), tip = T(`Back_Leg_Tip_${side}`);
    put(ellipsoid("haunch", P(795, 842, 0.022 * s), frameFrom([0, -0.25, 1], [1, 0, 0]), [0.019, 0.037, 0.045]), 0.016, [`Back_Leg_Upper_${side}`, `Back_Leg_Pelvis_${side}`, "Hips"], "leg", along(hip, knee));
    put(capsule("thigh", hip, knee, 0.012, 0.009), 0.012, [`Back_Leg_Upper_${side}`, `Back_Leg_Pelvis_${side}`], "leg", along(hip, knee));
    put(capsule("shank", knee, add(heel, [0, 0.002, 0]), 0.0105, 0.0068, [1, 0, 0], [0.8, 1]), 0.009, [`Back_Leg_Lower_${side}`, `Back_Leg_Upper_${side}`], "leg", along(knee, heel), 1);
    put(capsule("foot", add(heel, [0, -0.002, -0.001]), [ft[0], 0.0045, ft[2]], 0.0062, 0.0052, [1, 0, 0], [1, 0.75]), 0.005, [`Back_Leg_Ankle_${side}`, `Back_Leg_Lower_${side}`], "paw", () => [0, -0.2, 1], 0.55);
    const reach = Math.hypot(tip[2] - ft[2], tip[0] - ft[0]) + 0.003;
    for (const [i, spread] of [-0.38, -0.16, 0, 0.16, 0.38].entries()) {
      const dir = normalize([Math.sin(spread) + 0.05 * s, 0, Math.cos(spread)]);
      const len = reach * (i === 0 ? 0.45 : i === 4 ? 0.6 : 0.8);
      const base: Vec3 = [ft[0] + dir[0] * 0.002, 0.0032, ft[2] - 0.003];
      put(capsule("toe", base, [base[0] + dir[0] * len, 0.0016, base[2] + dir[2] * len], 0.0023, 0.0014), 0.0015, [`Back_Leg_Foot_1_${side}`, `Back_Leg_Foot_${side}`, `Back_Leg_Tip_${side}`], "paw", () => [0, -0.2, 1], 0.2);
    }
  }

  // --- Tail: a plume swept along the S of the tail bones, flat from side to side ---
  // Loft sections: w is the half width in the plane of the S, up/down the half thickness to the sides.
  const plume = [[0.0065, 0.0065], [0.018, 0.013], [0.028, 0.016], [0.031, 0.017], [0.027, 0.016], [0.014, 0.01]];
  // The loft's end is flat: round the tip off with an ellipsoid.
  const tipDir = normalize(sub(TAIL[5], TAIL[4]));
  put(ellipsoid("tailtip", add(TAIL[5], scale(tipDir, -0.004)), frameFrom(tipDir, [1, 0, 0]), [0.011, 0.014, 0.016]), 0.012, ["Tail_Tip", "Tail_End"], "tail", () => tipDir, 2.6);
  put(loft("tail", TAIL.map((at, i) => ({ at, w: plume[i][0], up: plume[i][1], down: plume[i][1], n: 2 })), [1, 0, 0]), 0.008,
    ["Tail_Base", "Tail_Mid", "Tail_Mid.001", "Tail_End", "Tail_Tip"], "tail", (p) => {
      // Along the tail, away from the body.
      let best = Infinity, dir: Vec3 = [0, 1, 0];
      for (let i = 0; i < TAIL.length - 1; i++) {
        const c = lerp(TAIL[i], TAIL[i + 1], 0.5);
        const d = Math.hypot(...sub(p, c));
        if (d < best) {
          best = d;
          dir = normalize(sub(TAIL[i + 1], TAIL[i]));
        }
      }
      return dir;
    }, 2.6);

  const brows = eyes.map((e) => add(e.center, [0.002 * e.side, 0.006, -0.002]));
  return {
    rig,
    unit: 0.3,
    parts,
    eyes: eyes.map(({ center, radius, look }) => ({ center, radius, look })),
    marks: {
      brows,
      nose: NOSE_TIP,
      mouth: { y0: mouthBack[1], y1: mouthFront[1], z0: mouthBack[2], z1: mouthFront[2], halfWidth: 0.008 },
    },
  };
}

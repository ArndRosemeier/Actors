/**
 * The base cow: a Braunvieh (Swiss Brown) cow of about 1.40 m at the withers,
 * modelled on a front-quarter photo of a light brown alpine cow and on cattle
 * conformation, on the skeleton of Mesh2Motion's CC0 low-poly horse (its rig
 * and clips; no mesh is used). Quaternius' low-poly Cow was the first choice,
 * but its Google Drive download was over quota; the horse rig has the same
 * bones a cow needs and more clips (trot, eat, sleep, lying down).
 *
 * Positions are written in centimetres in a side view (`cm(z, y, x)`): z runs
 * forward from the middle of the barrel, y up from the ground. The rig is
 * placed onto the cow's joints first, then the body is drawn around it as a
 * smooth implicit surface (lofts for trunk, neck and head; slices for the
 * upper limbs; round cones and ellipsoids for joints, udder and claws).
 */
import { type Vec3, normalize } from "@actors/core";
import type { BodyPart, DogBody, Region } from "./dog";
import { type Rig, placeBones } from "./rig";
import { type Frame, type LoftKey, type Primitive, bodyDistance, box, capsule, ellipsoid, frameFrom, loft } from "./sdf";

/** A point in the cow's side view (centimetres: z forward, y up, x to the cow's left) in pack space (metres). */
export const cm = (z: number, y: number, x = 0): Vec3 => [x / 100, y / 100, z / 100];

/** Hair length the body surface leaves room for (metres): a short summer coat. */
export const COW_FUR = 0.004;

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const along = (a: Vec3, b: Vec3) => () => normalize(sub(b, a));
/** Body hair lies backwards and a little down. */
const BACKWARD = () => [0, -0.25, -1] as Vec3;

/** Bones of one side's legs, front then hind (Mesh2Motion horse names). */
export const FRONT_LEG = ["front_scapula", "front_humerus", "front_leg_upper", "front_leg_lower", "front_leg_ankle", "front_leg_foot", "front_leg_leaf"];
export const BACK_LEG = ["back_leg_pelvis", "back_leg_upper", "back_leg_lower", "back_leg_ankle", "back_leg_foot", "back_leg_toe", "back_leg_leaf"];
export const TAIL = ["tail_1", "tail_2", "tail_3", "tail_4", "tail_leaf"];

/** Leg joints (z, y in cm; distance from the midline in m), top to bottom. */
const FORE: [number, number, number][] = [
  [48, 130, 0.09], // top of the shoulder blade
  [76, 98, 0.18], // point of the shoulder
  [54, 70, 0.18], // elbow
  [58, 38, 0.15], // knee (carpus)
  [58, 13, 0.145], // fetlock
  [61, 6, 0.145], // coronet
  [68, 0, 0.145], // toe
  [73, 0, 0.145],
];
const HIND: [number, number, number][] = [
  [-52, 128, 0.07], // sacrum, by the hook bone
  [-64, 110, 0.17], // hip joint
  [-44, 76, 0.18], // stifle
  [-71, 45, 0.15], // hock
  [-64, 13, 0.145], // fetlock
  [-61, 6, 0.145], // coronet
  [-54, 0, 0.145], // toe
  [-49, 0, 0.145],
];

/** Top of the poll and tip of the muzzle (the head axis). */
const POLL = cm(120, 137);
const MUZZLE = cm(146, 95);

/** The cow skeleton: Mesh2Motion's horse rig with every joint moved onto the cow (bone names and order kept, so all its clips play). */
export function cowRig(source: Rig): Rig {
  const rig: Rig = { bones: source.bones.map((b) => ({ ...b, head: [...b.head] as Vec3, tail: [...b.tail] as Vec3 })), index: new Map(source.index) };
  const place: Record<string, [Vec3, Vec3]> = {};
  const chain = (names: string[], pts: Vec3[]) => names.forEach((n, i) => (place[n] = [pts[i], pts[i + 1]]));
  const hp = headPoint();
  // Spine: the pelvis to the withers, low in the body.
  chain(["hips", "spine_1", "spine_2", "spine_3"], [cm(-64, 124), cm(-30, 122), cm(5, 122), cm(40, 122), cm(60, 120)]);
  // Neck along its middle to the poll, then the head down to the muzzle.
  chain(["spine_4", "spine_5", "spine_6", "head", "nose", "head_leaf"], [cm(60, 120), cm(78, 119), cm(96, 120), cm(114, 125), hp(0.45, -0.04), hp(0.78, -0.02), hp(0.95, -0.01)]);
  // Breast bone and the brisket (they only carry skin).
  chain(["ribcage_middle", "ribcage_leaf"], [cm(10, 72), cm(10, 62), cm(10, 58)]);
  chain(["ribcage_front", "ribcage_front_leaf"], [cm(72, 90), cm(80, 82), cm(83, 80)]);
  // Lower jaw: hinge behind the cheek, out to the chin.
  chain(["mouth", "mouth_tip"], [hp(0.24, -0.13), hp(0.9, -0.09), hp(0.96, -0.09)]);
  // Ears: out to the sides behind the eyes, nearly level, a little back and down.
  for (const [side, s] of [["l", 1], ["r", -1]] as const) {
    const base = hp(0.1, -0.03, 0.085 * s);
    const dir = normalize([s, -0.18, -0.2]);
    const pts = [0, 0.08, 0.16, 0.23].map((d) => add(base, scale(dir, d)));
    chain([`ear_1_${side}`, `ear_2_${side}`, `ear_leaf_${side}`], pts);
  }
  // Tail: from the raised tail head down the buttocks towards the hocks.
  chain(TAIL, [cm(-78, 137), cm(-86, 124), cm(-88, 106), cm(-88, 89), cm(-87, 72), cm(-86, 58)]);
  for (const [side, s] of [["l", 1], ["r", -1]] as const) {
    chain(FRONT_LEG.map((n) => `${n}_${side}`), FORE.map(([z, y, x]) => cm(z, y, x * 100 * s)));
    chain(BACK_LEG.map((n) => `${n}_${side}`), HIND.map(([z, y, x]) => cm(z, y, x * 100 * s)));
  }
  placeBones(rig, place);
  return rig;
}

const HEAD_UP: Vec3 = normalize([0, 0.5, 1]);

/** A point on the head: `t` along the axis poll -> muzzle, `fwd` metres towards the forehead side (negative: towards the jaw), `x` to the side. */
function headPoint() {
  const axis = normalize(sub(MUZZLE, POLL));
  const L = len(sub(MUZZLE, POLL));
  const u = normalize(cross(HEAD_UP, axis));
  const v = cross(axis, u);
  return (t: number, fwd: number, x = 0): Vec3 => add(add(POLL, scale(axis, t * L)), add(scale(v, fwd), [x, 0, 0]));
}

/** A lens (almond) shape: two intersected spheres offset along v; half width `a` along u, half height `b` along v. */
function lens(name: string, center: Vec3, frame: Frame, a: number, b: number): Primitive {
  const r = (a * a + b * b) / (2 * b), o = r - b;
  const c1 = add(center, scale(frame.v, -o)), c2 = add(center, scale(frame.v, o));
  return { name, min: center.map((x) => x - a) as Vec3, max: center.map((x) => x + a) as Vec3, distance: (p) => Math.max(len(sub(p, c1)) - r, len(sub(p, c2)) - r) };
}

/** Distance from p to a polyline in the side (z, y) plane. */
function lineDistance(p: Vec3, pts: Vec3[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const ab: [number, number] = [b[2] - a[2], b[1] - a[1]];
    const t = Math.max(0, Math.min(1, ((p[2] - a[2]) * ab[0] + (p[1] - a[1]) * ab[1]) / (ab[0] ** 2 + ab[1] ** 2)));
    best = Math.min(best, Math.hypot(p[2] - a[2] - ab[0] * t, p[1] - a[1] - ab[1] * t));
  }
  return best;
}

/** Signed distance (metres) to a polygon in the side (z, y) plane given in cm. */
export function sidePolygon(pts: [number, number][]): (p: Vec3) => number {
  const q = pts.map(([z, y]) => [z / 100, y / 100] as [number, number]);
  return (p) => {
    const z = p[2], y = p[1];
    let d = Infinity, inside = false;
    for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
      const [ax, ay] = q[j], [bx, by] = q[i];
      const ex = bx - ax, ey = by - ay;
      const t = Math.max(0, Math.min(1, ((z - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey)));
      d = Math.min(d, Math.hypot(z - ax - ex * t, y - ay - ey * t));
      if (ay > y !== by > y && z < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    }
    return inside ? -d : d;
  };
}

/**
 * A limb mass drawn as horizontal slices: each row is
 * [y (cm), front z (cm), back z (cm), distance of the slice's centre from the midline (m), half width (m)].
 */
function slices(name: string, rows: [number, number, number, number, number][], s: number, n = 2.2): Primitive {
  const keys: LoftKey[] = rows.map(([y, front, back, x, w]) => ({ at: cm((front + back) / 2, y, x * 100 * s), w, up: ((front - back) / 2) / 100, down: ((front - back) / 2) / 100, n }));
  return loft(name, keys, [0, 0, 1]);
}

/** Extra data the cow's coat, morphs and accessories need. */
export interface CowBody extends DogBody {
  cow: {
    /** Heights of the knee and the hock. */
    kneeY: number;
    hockY: number;
    /** Muzzle tip and poll. */
    muzzle: Vec3;
    poll: Vec3;
    /** Horn centre lines (left, right), root to tip, for the horn meshes and morphs. */
    horns: Vec3[][];
    /** Centre of the udder (for the udder morph). */
    udder: Vec3;
    /** The neck and chest without hair: what the collar lies on. */
    skin: BodyPart[];
    /** Neck line where the collar sits (top, bottom) and the bell's top. */
    collar: { top: Vec3; bottom: Vec3 };
    headPt(t: number, fwd: number, x?: number): Vec3;
  };
}

/** The base cow (Braunvieh): skeleton and body parts. */
export function cowBody(source: Rig): CowBody {
  const rig = cowRig(source);
  const bone = (n: string) => rig.bones[rig.index.get(n)!];
  const H = (n: string) => bone(n).head;
  const T = (n: string) => bone(n).tail;
  const F = COW_FUR;
  const c = (coat: number, fur = 1) => Math.max(0.004, coat - F * fur);
  const headPt = headPoint();

  const parts: BodyPart[] = [];
  const put = (prim: Primitive, k: number, bones: string[], region: Region, flow: (p: Vec3) => Vec3, fur = 1, carve = false) =>
    parts.push({ prim, k, carve, bones, region, flow, fur });

  // --- Trunk: one loft from the brisket to the pin bones. [z, top, bottom, half width] in cm. ---
  const TRUNK: [number, number, number, number][] = [
    [86, 106, 90, 14],
    [79, 121, 80, 21],
    [68, 132, 72, 25],
    [55, 138.5, 69, 27],
    [40, 140, 65.5, 29],
    [22, 139.5, 62.5, 32],
    [5, 139, 60.5, 34],
    [-12, 139, 60.5, 34],
    [-28, 139.5, 62.5, 32],
    [-42, 140, 68.5, 29],
    [-55, 141, 80, 26],
    [-65, 141, 95, 23],
    [-74, 139, 106, 18],
    [-82, 133, 113, 11],
    [-87, 126, 117, 5],
  ];
  const pathY = (z: number) => 108 - 0.1 * z;
  const sec = ([z, top, bottom, w]: [number, number, number, number]): LoftKey => {
    const y = pathY(z);
    return { at: cm(z, y), w: c(w / 100), up: c((top - y) / 100), down: c(Math.max(0.6, y - bottom) / 100), n: 2.25 };
  };
  put(loft("trunk", TRUNK.map(sec)), 0, ["hips", "spine_1", "spine_2", "spine_3", "ribcage_middle"], "torso", BACKWARD);
  // Barrel: the deep, round belly is widest low down (a pear seen from the front).
  put(ellipsoid("barrel", cm(-6, 83), frameFrom([0, 0, 1]), [c(0.34), c(0.2), 0.48]), 0.16, ["spine_1", "spine_2", "ribcage_middle"], "torso", BACKWARD);
  // Hook bones (points of the hip) at each side, pin bones either side of the tail, the raised tail head.
  for (const s of [1, -1]) {
    put(ellipsoid("hook", cm(-55, 129, 23 * s), frameFrom([0, -0.3, 1]), [0.045, 0.035, 0.06]), 0.12, ["hips", "spine_1"], "torso", BACKWARD);
    put(ellipsoid("pin", cm(-82, 124, 8 * s), frameFrom([0, 0, 1]), [0.04, 0.04, 0.045]), 0.06, ["hips"], "torso", BACKWARD);
  }
  put(ellipsoid("tailhead", cm(-74, 134), frameFrom([0, 0.2, 1]), [0.055, 0.04, 0.08]), 0.12, ["hips"], "torso", BACKWARD);
  // Withers: a low ridge over the shoulder blades.
  put(capsule("withers", cm(36, 134), cm(58, 132), 0.06, 0.05, [1, 0, 0], [0.8, 1]), 0.08, ["spine_3", "spine_2"], "torso", BACKWARD);

  // --- Neck: crest and throat lines, sections along the neck's middle ---
  const crest = [cm(50, 140), cm(68, 137.5), cm(86, 135), cm(100, 133.5), cm(112, 133.5), cm(120, 135)];
  const throat = [cm(78, 84), cm(90, 89), cm(100, 95), cm(108, 101), cm(116, 107)];
  const nk = (at: Vec3, w: number): LoftKey => ({ at, w: c(w), up: c(lineDistance(at, crest)), down: c(lineDistance(at, throat)), n: 2.15 });
  const neckPath = [cm(56, 116), cm(70, 116), cm(84, 116), cm(97, 118), cm(108, 121), cm(117, 125)];
  const neckW = [0.25, 0.235, 0.205, 0.175, 0.15, 0.13];
  put(loft("neck", neckPath.map((p, i) => nk(p, neckW[i]))), 0.07, ["spine_3", "spine_4", "spine_5", "spine_6", "head"], "neck", () => [0, -1, -0.6]);
  // Dewlap: the fold of skin hanging below the throat and the brisket (a thin loft along the throat line).
  const dew: [number, number, number, number][] = [
    // z, y of the fold's root (cm), half thickness (m), hang below the root (m)
    [114, 106, 0.02, 0.01],
    [104, 99, 0.028, 0.03],
    [94, 92, 0.034, 0.045],
    [84, 85, 0.04, 0.05],
    [76, 80, 0.045, 0.04],
    [70, 79, 0.04, 0.015],
  ];
  put(loft("dewlap", dew.map(([z, y, w, hang]) => ({ at: cm(z, y), w, up: 0.03, down: c(hang + 0.03), n: 2 }))), 0.06, ["spine_4", "spine_5", "ribcage_front"], "neck", () => [0, -1, 0]);

  // --- Head: a loft from the poll to the muzzle. [t along the axis, forehead side (cm), jaw side (cm), half width (cm)] ---
  const axis = normalize(sub(MUZZLE, POLL));
  const headLen = len(sub(MUZZLE, POLL));
  const HEAD: [number, number, number, number][] = [
    [-0.03, 3, 8.5, 9.5],
    [0.06, 6, 16, 12.8],
    [0.18, 7.5, 20.5, 13.4],
    [0.3, 7.5, 19.5, 12.4],
    [0.44, 7, 16.2, 10.8],
    [0.58, 6.5, 14, 10.2],
    [0.72, 6.5, 13, 10.2],
    [0.85, 7, 12.4, 10.8],
    [0.94, 6.5, 10.8, 10.8],
    [1.0, 3.2, 7.5, 8],
  ];
  const hd = ([t, up, down, w]: [number, number, number, number]): LoftKey => ({ at: add(POLL, scale(axis, t * headLen)), w: c(w / 100, 0.6), up: c(up / 100, 0.6), down: c(down / 100, 0.6), n: 2.35 });
  put(loft("skull", HEAD.map(hd), HEAD_UP), 0.05, ["head", "nose", "spine_6"], "head", BACKWARD, 0.6);
  // The poll: a broad transverse ridge between the horn bases; a tuft of curly hair on it.
  put(capsule("poll", headPt(0.0, 0.0, 0.075), headPt(0.0, 0.0, -0.075), 0.04, 0.04, [0, 0, 1]), 0.04, ["head"], "head", BACKWARD, 0.6);
  put(ellipsoid("tuft", headPt(0.04, 0.03), frameFrom(axis, [1, 0, 0]), [0.07, 0.025, 0.06]), 0.03, ["head"], "head", () => normalize(add(axis, [0, 0.5, 0])), 4);
  // Cheeks: the big masseters over the back of the lower jaw.
  for (const s of [1, -1]) put(ellipsoid("cheek", headPt(0.3, -0.105, 0.08 * s), frameFrom(axis, [1, 0, 0]), [0.05, 0.09, 0.115]), 0.08, ["head", "mouth"], "head", BACKWARD, 0.6);
  // Lower jaw and chin.
  put(capsule("jaw", headPt(0.38, -0.12), headPt(0.88, -0.085), 0.05, 0.045, [1, 0, 0], [1.3, 0.9]), 0.05, ["mouth", "head"], "jaw", BACKWARD, 0.6);
  put(ellipsoid("chin", headPt(0.93, -0.085), frameFrom(axis, [1, 0, 0]), [0.05, 0.03, 0.04]), 0.025, ["mouth_tip", "mouth"], "jaw", BACKWARD, 0.5);
  // Muzzle: broad, with the bare, moist nose plate in front; nostrils at its sides.
  put(ellipsoid("muzzle", headPt(0.92, -0.005), frameFrom(axis, [1, 0, 0]), [0.1, 0.078, 0.068]), 0.035, ["head_leaf", "nose"], "muzzle", BACKWARD, 0.4);
  put(ellipsoid("noseplate", headPt(0.99, 0.003), frameFrom(axis, [1, 0, 0]), [0.08, 0.062, 0.035]), 0.02, ["head_leaf", "nose"], "nose", BACKWARD, 0);
  const nostrils: Vec3[] = [];
  for (const s of [1, -1]) {
    const n = headPt(1.01, 0.008, 0.045 * s);
    nostrils.push(n);
    // A comma-shaped opening at the front corner of the plate, curving out and back.
    put(ellipsoid("nostril", n, frameFrom(normalize(add(axis, [0, 0.5, 0])), [s, 0, 0]), [0.013, 0.006, 0.022]), 0.005, ["nose", "head_leaf"], "nose", BACKWARD, 0, true);
  }
  // Mouth slit between the upper and the lower lip, so the jaw can open.
  const mouthBack = headPt(0.8, -0.08), mouthFront = headPt(1.04, -0.07);
  put(box("mouth", lerp(mouthBack, mouthFront, 0.5), frameFrom(sub(mouthFront, mouthBack)), [0.085, 0.003, len(sub(mouthFront, mouthBack)) / 2]), 0.004, ["mouth"], "jaw", BACKWARD, 0, true);

  // Eyes: large and prominent on the sides of the head; sunk into almond lids under a brow.
  const eyeR = 0.024;
  const eyes = [1, -1].map((s) => {
    const from = headPt(0.27, 0.01, 0);
    const out = normalize([s, 0.08, 0.32]);
    let t = 0;
    while (t < 0.3 && bodyDistance(parts, add(from, scale(out, t))) < 0) t += 0.0005;
    const center = add(from, scale(out, t - eyeR * 0.72));
    return { center, radius: eyeR, look: normalize([0.85 * s, 0.0, 0.5]) as Vec3, out, side: s };
  });
  for (const e of eyes) {
    put(ellipsoid("brow", add(e.center, [-0.004 * e.side, 0.022, -0.004]), frameFrom([0, 0.2, 1]), [0.02, 0.012, 0.032]), 0.022, ["head"], "head", BACKWARD, 0.5);
    put(lens("socket", add(e.center, scale(e.out, eyeR * 0.6)), frameFrom(e.out, normalize([0, 0.1, -1])), eyeR * 1.3, eyeR * 0.6), 0.004, ["head"], "head", BACKWARD, 0.3, true);
  }

  // Ears: broad, rounded, cupped forward; held out to the sides.
  for (const side of ["l", "r"] as const) {
    const s = side === "l" ? 1 : -1;
    const a = H(`ear_1_${side}`), b = T(`ear_leaf_${side}`);
    const ax = normalize(sub(b, a));
    // The ear's hollow faces forward and a little down.
    const facing = normalize(sub([0, -0.35, 1], scale(ax, dot([0, -0.35, 1], ax))));
    const bones = [`ear_1_${side}`, `ear_2_${side}`, `ear_leaf_${side}`, "head"];
    put(capsule("ear", lerp(a, b, 0.02), lerp(a, b, 0.86), 0.028, 0.045, facing, [0.45, 1]), 0.03, bones, "ear", along(a, b), 0.6);
    put(ellipsoid("earflap", lerp(a, b, 0.6), frameFrom(ax, facing), [0.02, 0.068, 0.11]), 0.03, bones.slice(0, 3), "ear", along(a, b), 0.6);
    const fwd = (p: Vec3, d: number) => add(p, scale(facing, d));
    put(ellipsoid("earcup", fwd(lerp(a, b, 0.6), 0.015), frameFrom(ax, facing), [0.015, 0.056, 0.092]), 0.006, bones.slice(0, 3), "ear", along(a, b), 0.3, true);
  }

  // --- Shoulder, arm and brisket ---
  for (const side of ["l", "r"] as const) {
    const s = side === "l" ? 1 : -1;
    const scap = `front_scapula_${side}`, hum = `front_humerus_${side}`, up = `front_leg_upper_${side}`;
    put(capsule("scapula", cm(48, 128, 13 * s), cm(72, 100, 18 * s), 0.06, 0.07, [1, 0, 0], [0.55, 1]), 0.12, [scap, "spine_3"], "torso", BACKWARD);
    put(
      slices("arm", [
        [100, 81, 60, 0.15, 0.08],
        [90, 81, 52, 0.17, 0.085],
        [80, 76, 47, 0.175, 0.08],
        [72, 70, 46, 0.175, 0.07],
        [64, 66, 49, 0.17, 0.058],
      ], s),
      0.12, [hum, scap], "leg", along(H(hum), T(hum)),
    );
    put(ellipsoid("elbow", cm(50, 70, 17 * s), frameFrom([0, 1, 0]), [0.035, 0.04, 0.045]), 0.05, [up, hum], "leg", BACKWARD);
    // Brisket: the chest floor between the front legs.
    put(ellipsoid("brisket", cm(74, 84, 7 * s), frameFrom([0, -0.6, 1], [1, 0, 0]), [0.08, 0.08, 0.1]), 0.12, ["ribcage_front", hum], "torso", () => [0, -1, -0.2]);
  }

  // --- Front legs: forearm, knee, cannon, fetlock with dewclaws, pastern, two claws ---
  let kneeY = 0;
  for (const side of ["l", "r"] as const) {
    const s = side === "l" ? 1 : -1;
    const up = `front_leg_upper_${side}`, low = `front_leg_lower_${side}`, ank = `front_leg_ankle_${side}`, foot = `front_leg_foot_${side}`, leaf = `front_leg_leaf_${side}`;
    const elbow = H(up), knee = H(low), fet = H(ank), coronet = H(foot);
    kneeY = knee[1];
    put(
      slices("forearm", [
        [68, 67, 49, 0.172, 0.06],
        [60, 65, 51, 0.165, 0.052],
        [52, 63.5, 52.5, 0.158, 0.044],
        [45, 62.5, 53.5, 0.153, 0.04],
        [40, 62, 54, 0.15, 0.038],
      ], s, 2.3),
      0.08, [up, `front_humerus_${side}`], "leg", along(elbow, knee), 0.8,
    );
    put(ellipsoid("knee", add(knee, [0, 0, 0.004]), frameFrom([0, 1, 0], [1, 0, 0]), [0.04, 0.045, 0.042]), 0.025, [low, up], "leg", along(knee, fet), 0.6);
    lowerLeg(put, knee, fet, coronet, [low, up], [ank, low], [foot, ank, leaf], s);
  }

  // --- Hind legs: thigh, stifle, gaskin, hock, cannon, fetlock, claws ---
  let hockY = 0;
  for (const side of ["l", "r"] as const) {
    const s = side === "l" ? 1 : -1;
    const pel = `back_leg_pelvis_${side}`, fem = `back_leg_upper_${side}`, tib = `back_leg_lower_${side}`, ank = `back_leg_ankle_${side}`, foot = `back_leg_foot_${side}`, toeB = `back_leg_toe_${side}`, leaf = `back_leg_leaf_${side}`;
    const stifle = H(tib), hock = H(ank), fet = H(foot), coronet = H(toeB);
    hockY = hock[1];
    // Thigh: slices from under the hook bones down past the stifle; the back edge is the buttock and the lean thigh of a dairy cow.
    put(
      slices("thigh", [
        [134, -52, -80, 0.08, 0.15],
        [122, -49, -85, 0.11, 0.14],
        [110, -46, -86.5, 0.13, 0.13],
        [98, -44, -86, 0.143, 0.118],
        [86, -42, -84, 0.15, 0.105],
        [76, -43, -81, 0.152, 0.092],
        [68, -47, -79, 0.152, 0.078],
      ], s),
      0.1, [fem, pel, "hips"], "leg", along(H(fem), stifle),
    );
    put(
      slices("gaskin", [
        [76, -43, -81, 0.152, 0.092],
        [68, -47, -79, 0.152, 0.078],
        [60, -55, -78, 0.152, 0.058],
        [53, -61, -78, 0.152, 0.045],
        [47, -64, -78.5, 0.15, 0.038],
        [41, -64.5, -76, 0.148, 0.034],
        [35, -64, -73, 0.146, 0.031],
      ], s),
      0.05, [tib, fem, ank], "leg", along(stifle, hock), 0.8,
    );
    lowerLeg(put, add(hock, [0, -0.04, 0]), fet, coronet, [ank, tib], [foot, ank], [toeB, foot, leaf], s);
  }

  // --- Udder: four quarters between the hind legs, attached high behind; four teats ---
  const udderC = cm(-58, 68);
  put(ellipsoid("udder", udderC, frameFrom([0, 0, 1]), [0.12, 0.1, 0.17]), 0.06, ["hips", "spine_1"], "udder", () => [0, -1, 0], 0.4);
  put(capsule("udder", cm(-62, 74), cm(-74, 94), 0.085, 0.05, [1, 0, 0], [1.25, 1]), 0.08, ["hips"], "udder", () => [0, -1, 0], 0.4);
  for (const zt of [-49, -65])
    for (const s of [1, -1]) {
      const top = cm(zt, 62, 5.5 * s);
      put(capsule("teat", top, add(top, [0.004 * s, -0.065, zt > -55 ? 0.006 : -0.004]), 0.014, 0.011), 0.012, ["hips"], "udder", () => [0, -1, 0], 0.2);
    }

  // --- Tail: thin, from the tail head to the switch of long hair ---
  const tailR = [0.035, 0.026, 0.02, 0.016, 0.013, 0.011];
  TAIL.forEach((n, i) => {
    const a = H(n), b = T(n);
    put(capsule("tail", a, b, tailR[i], tailR[i + 1]), i === 0 ? 0.05 : 0.012, i === 0 ? [n, "hips"] : [n, TAIL[i - 1]], "tail", along(a, b), 1);
  });
  const switchKeys: LoftKey[] = [
    { at: cm(-87, 76), w: 0.014, up: 0.014, down: 0.014, n: 2 },
    { at: cm(-87, 66), w: 0.035, up: 0.035, down: 0.035, n: 2 },
    { at: cm(-86.5, 55), w: 0.048, up: 0.045, down: 0.045, n: 2 },
    { at: cm(-86, 45), w: 0.04, up: 0.038, down: 0.04, n: 2 },
    { at: cm(-85.5, 38), w: 0.02, up: 0.018, down: 0.02, n: 2 },
    { at: cm(-85.5, 35), w: 0.006, up: 0.006, down: 0.006, n: 2 },
  ];
  put(loft("switch", switchKeys, [0, 0, 1]), 0.02, ["tail_4", "tail_leaf"], "mane", () => [0, -1, 0], 4);

  const skin = parts.filter((p) => ["torso", "neck", "head"].includes(p.region));
  // Horn centre lines (short, curving out, up and forward; the morphs reshape them).
  const horns = [1, -1].map((s) => {
    const root = headPt(0.0, 0.005, 0.085 * s);
    return [root, add(root, [0.06 * s, 0.01, 0.0]), add(root, [0.11 * s, 0.05, 0.02]), add(root, [0.13 * s, 0.11, 0.045]), add(root, [0.125 * s, 0.16, 0.06])];
  });
  // The collar sits round the neck halfway along it; the bell hangs at its bottom.
  const collarZ = 86;
  const collarTop = cm(collarZ, 135.5), collarBottom = cm(collarZ - 5, 88);
  return {
    rig,
    parts,
    eyes: eyes.map(({ center, radius, look }) => ({ center, radius, look })),
    unit: 2,
    band: 4,
    marks: {
      brows: eyes.map((e) => add(e.center, [0, 0.03, -0.01])),
      nose: MUZZLE,
      mouth: { y0: mouthBack[1], y1: mouthFront[1], z0: mouthBack[2], z1: mouthFront[2], halfWidth: 0.08 },
    },
    cow: { kneeY, hockY, muzzle: MUZZLE, poll: POLL, horns, udder: udderC, skin, collar: { top: collarTop, bottom: collarBottom }, headPt },
  };
}

type Put = (prim: Primitive, k: number, bones: string[], region: Region, flow: (p: Vec3) => Vec3, fur?: number, carve?: boolean) => void;

/** Lower leg below the knee or hock: cannon and tendons, fetlock with two dewclaws behind, pastern, two claws. */
function lowerLeg(put: Put, top: Vec3, fet: Vec3, coronet: Vec3, cannonBones: string[], fetBones: string[], clawBones: string[], s: number): void {
  const down = along(top, fet);
  put(capsule("cannon", add(top, [0, -0.02, 0.004]), add(fet, [0, 0.03, 0.004]), 0.034, 0.03, [1, 0, 0], [0.95, 1]), 0.025, cannonBones, "leg", down, 0.5);
  put(capsule("tendon", add(top, [0, -0.04, -0.024]), add(fet, [0, 0.03, -0.022]), 0.018, 0.018, [1, 0, 0], [0.85, 1]), 0.02, cannonBones, "leg", down, 0.5);
  put(ellipsoid("fetlock", add(fet, [0, 0.0, -0.008]), frameFrom([0, 1, 0], [1, 0, 0]), [0.042, 0.04, 0.045]), 0.02, fetBones, "leg", down, 0.5);
  // Dewclaws: two small horny knobs behind the fetlock.
  for (const d of [1, -1]) {
    const a = add(fet, [0.02 * d, -0.03, -0.042]);
    put(capsule("dewclaw", a, add(a, [0.003 * d, -0.014, -0.012]), 0.009, 0.005), 0.008, fetBones, "hoof", down, 0);
  }
  put(capsule("pastern", add(fet, [0, -0.01, -0.002]), add(coronet, [0, 0.01, -0.004]), 0.036, 0.036, [1, 0, 0], [1.05, 1]), 0.02, fetBones, "leg", along(fet, coronet), 0.5);
  claws(put, coronet, clawBones, s);
}

/** Two claws (the cloven hoof): each a slice loft with a sloping toe wall, the cleft between them. */
function claws(put: Put, coronet: Vec3, bones: string[], s: number): void {
  const [x, cy, cz] = coronet;
  // [height, front, back (z from the coronet), half width]
  const rows: [number, number, number, number][] = [
    [cy + 0.006, 0.026, -0.034, 0.024],
    [cy - 0.008, 0.042, -0.04, 0.028],
    [cy * 0.45, 0.07, -0.042, 0.03],
    [0.004, 0.092, -0.044, 0.031],
    [-0.01, 0.096, -0.044, 0.031],
  ];
  for (const d of [1, -1]) {
    const cx = x + 0.026 * d;
    // The claws curve in towards each other at the toe.
    const keys: LoftKey[] = rows.map(([y, f, b, w], i) => ({ at: [cx - 0.004 * d * (i / rows.length), y, cz + (f + b) / 2], w, up: (f - b) / 2, down: (f - b) / 2, n: 2.4 }));
    put(loft("claw", keys, [0, 0, 1]), 0.006, bones, "hoof", () => [0, -1, 0.3], 0);
  }
  // The cleft between the claws, and a flat sole on the ground.
  put(box("cleft", [x, 0.02, cz + 0.035], frameFrom([0, 0, 1]), [0.0035, 0.032, 0.075]), 0.004, bones, "hoof", () => [0, -1, 0.3], 0, true);
  put(box("sole", [x, -0.05, cz], frameFrom([0, 0, 1]), [0.12, 0.05, 0.16]), 0.003, bones, "hoof", () => [0, -1, 0.3], 0, true);
  void s;
}

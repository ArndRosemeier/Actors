/**
 * The base horse: a bay Thoroughbred-type gelding (about 1.60 m at the
 * withers) modelled on one side-on reference photo, on the skeleton of
 * Mesh2Motion's CC0 low-poly horse (its rig and clips; its mesh is not used).
 *
 * Like the cat, positions are measured in the photo's pixels (`ph`): the rig is
 * placed onto the photo's joints first, then the body is drawn around it as a
 * smooth implicit surface (lofts for trunk, neck and head; round cones and
 * ellipsoids for muscles, joints and hooves). The mane and the tail hair are
 * parts of the same surface with long fur. A `saddle` bone (not in the source
 * rig, so no clip moves it on its own) marks where a rider sits.
 */
import { type Vec3, normalize } from "@actors/core";
import type { BodyPart, DogBody, Region } from "./dog";
import { type Rig, type RigBone, placeBones, rollFromFrame } from "./rig";
import { type Frame, type LoftKey, type Primitive, bodyDistance, box, capsule, ellipsoid, frameFrom, loft } from "./sdf";

/** Metres per photo pixel (the photo horse is about 1.60 m at the withers). */
export const PX = 0.002636;
const GROUND_PX = 752;
const ORIGIN_PX = 360;

/** A point measured on the photo (pixels, y down) in pack space; `x` is the offset from the midline in metres (+X: the horse's left). */
export const ph = (px: number, py: number, x = 0): Vec3 => [x, (GROUND_PX - py) * PX, (px - ORIGIN_PX) * PX];

/** Hair length the body surface leaves room for (metres): a short, sleek summer coat. */
export const HORSE_FUR = 0.003;

/** The rider's seat: the lowest point of the saddle's seat, on the midline (its height comes from the back, see SADDLE_RISE). */
export const SEAT_PX: [number, number] = [392, 128];
/** How far the saddle's seat lies above the back (pad and panels). */
export const SADDLE_RISE = 0.05;

/** Height of the top of `parts` on the midline at depth z. */
export function topLine(parts: BodyPart[], z: number, x = 0): number {
  let y = 2.4;
  while (y > 0 && bodyDistance(parts, [x, y, z]) > 0) y -= 0.002;
  return y;
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
const BACKWARD = () => [0, -0.25, -1] as Vec3;

/** Bones of one side's legs, front then hind (Mesh2Motion names). */
export const FRONT_LEG = ["front_scapula", "front_humerus", "front_leg_upper", "front_leg_lower", "front_leg_ankle", "front_leg_foot", "front_leg_leaf"];
export const BACK_LEG = ["back_leg_pelvis", "back_leg_upper", "back_leg_lower", "back_leg_ankle", "back_leg_foot", "back_leg_toe", "back_leg_leaf"];
export const TAIL = ["tail_1", "tail_2", "tail_3", "tail_4", "tail_leaf"];

/** Leg joints on the photo (near legs, pixels) and their distance from the midline (metres), top to bottom. */
const FORE: [number, number, number][] = [
  [505, 178, 0.085], // top of the shoulder blade
  [672, 322, 0.17], // point of the shoulder
  [574, 414, 0.165], // elbow
  [589, 556, 0.14], // knee (carpus)
  [584, 688, 0.138], // fetlock
  [601, 722, 0.138], // coronet
  [627, 750, 0.138], // toe
  [645, 750, 0.138],
];
const HIND: [number, number, number][] = [
  [212, 190, 0.07], // sacrum, by the point of the hip
  [160, 268, 0.19], // hip joint
  [203, 382, 0.2], // stifle
  [52, 512, 0.15], // hock
  [46, 692, 0.138], // fetlock
  [67, 726, 0.138], // coronet
  [94, 752, 0.138], // toe
  [110, 752, 0.138],
];

/** Builds a bone frame (columns x, y = along the bone, z) and the Blender roll it means. */
function rollFor(dir: Vec3, side: Vec3 = [1, 0, 0]): number {
  const y = normalize(dir);
  let x = sub(side, scale(y, dot(side, y)));
  if (len(x) < 1e-6) x = Math.abs(y[1]) < 0.9 ? cross([0, 1, 0], y) : cross([1, 0, 0], y);
  x = normalize(x);
  const z = cross(x, y);
  return rollFromFrame(new Float64Array([...x, ...y, ...z]));
}

/**
 * The horse skeleton: Mesh2Motion's horse rig with every joint moved onto the
 * photo (bone names and order kept, so all its clips play), plus the `saddle`
 * bone on the back.
 */
export function horseRig(source: Rig): Rig {
  const rig: Rig = { bones: source.bones.map((b) => ({ ...b, head: [...b.head] as Vec3, tail: [...b.tail] as Vec3 })), index: new Map(source.index) };
  const place: Record<string, [Vec3, Vec3]> = {};
  const chain = (names: string[], pts: Vec3[]) => names.forEach((n, i) => (place[n] = [pts[i], pts[i + 1]]));
  // Spine: the pelvis to the withers, low in the body (the vertebrae run well below the top line).
  chain(["hips", "spine_1", "spine_2", "spine_3"], [ph(176, 252), ph(266, 246), ph(356, 250), ph(468, 242), ph(556, 230)]);
  // Neck: along its middle from the withers to the poll, then the head down to the muzzle.
  chain(["spine_4", "spine_5", "spine_6", "head", "nose", "head_leaf"], [ph(556, 230), ph(650, 212), ph(745, 150), ph(842, 78), ph(912, 168), ph(952, 224), ph(972, 244)]);
  // Breast bone and girth (they only carry skin).
  chain(["ribcage_middle", "ribcage_leaf"], [ph(452, 330), ph(452, 410), ph(452, 428)]);
  chain(["ribcage_front", "ribcage_front_leaf"], [ph(652, 330), ph(686, 356), ph(696, 366)]);
  // Lower jaw: hinge behind the cheek, out to the chin.
  chain(["mouth", "mouth_tip"], [ph(872, 196), ph(928, 258), ph(946, 262)]);
  // Ears: on top of the head behind the poll, upright, a little forward and out.
  for (const [side, s] of [["l", 1], ["r", -1]] as const) {
    const base = ph(858, 48, 0.055 * s);
    const dir = normalize([0.22 * s, 1, 0.3]);
    const pts = [0, 0.055, 0.11, 0.165].map((d) => add(base, scale(dir, d)));
    chain([`ear_1_${side}`, `ear_2_${side}`, `ear_leaf_${side}`], pts);
  }
  // Tail: the dock hangs from the top of the croup close to the buttocks.
  chain(TAIL, [ph(76, 198), ph(56, 240), ph(46, 296), ph(44, 352), ph(47, 404), ph(52, 444)]);
  for (const [side, s] of [["l", 1], ["r", -1]] as const) {
    chain(FRONT_LEG.map((n) => `${n}_${side}`), FORE.map(([px, py, x]) => ph(px, py, x * s)));
    chain(BACK_LEG.map((n) => `${n}_${side}`), HIND.map(([px, py, x]) => ph(px, py, x * s)));
  }
  placeBones(rig, place);

  // The rider's seat: a leaf bone on the back, pointing forward.
  const seat = ph(...SEAT_PX);
  const spine2 = rig.index.get("spine_2")!;
  rig.index.set("saddle", rig.bones.length);
  rig.bones.push({ name: "saddle", parent: spine2, head: seat, tail: add(seat, [0, 0, 0.12]), roll: rollFor([0, 0, 1]), node: -1 });
  return rig;
}

/** The source rig's bones only (for reading its clips; the saddle bone has no glTF node). */
export function clipRig(rig: Rig): Rig {
  const bones: RigBone[] = rig.bones.filter((b) => b.node >= 0);
  return { bones, index: new Map(bones.map((b, i) => [b.name, i])) };
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

/**
 * A layer lying on other parts (hair, a strap): the band between `offset - half`
 * and `offset + half` above their surface, where `mask` (a signed distance,
 * negative inside) allows it. Bounds: `min`/`max`.
 */
export function layer(name: string, under: BodyPart[], offset: number, half: number, mask: (p: Vec3) => number, a: Vec3, b: Vec3): Primitive {
  const min = a.map((v, k) => Math.min(v, b[k])) as Vec3, max = a.map((v, k) => Math.max(v, b[k])) as Vec3;
  return { name, min, max, distance: (p) => Math.max(Math.abs(bodyDistance(under, p) - offset) - half, mask(p)) };
}

/**
 * A limb mass drawn as horizontal slices down the photo: each row is
 * [py, front px, back px, distance of the slice's centre from the midline (m), half width (m)].
 * The slices' front and back edges follow the photo's outline; widths come from anatomy.
 */
function slices(name: string, rows: [number, number, number, number, number][], s: number, n = 2.2): Primitive {
  const keys: LoftKey[] = rows.map(([py, front, back, x, w]) => {
    const half = ((front - back) / 2) * PX;
    return { at: ph((front + back) / 2, py, x * s), w, up: half, down: half, n };
  });
  // Path downwards; the sections' "up" points forward (+Z).
  return loft(name, keys, [0, 0, 1]);
}

/** Extra data the horse coat and tack need. */
export interface HorseBody extends DogBody {
  horse: {
    /** Crest line (poll to withers), where the mane grows. */
    crest: Vec3[];
    /** Heights of the knee and the hock (the bay's black points reach them). */
    kneeY: number;
    hockY: number;
    /** The seat (saddle bone head). */
    seat: Vec3;
    /** Muzzle tip and the stop between the eyes. */
    muzzle: Vec3;
    /** The trunk, neck and head without hair: what tack lies on. */
    skin: BodyPart[];
    /** A point on the head: `t` along the axis poll -> muzzle, `fwd` metres towards the forehead side (negative: towards the jaw), `x` to the side. */
    headPt(t: number, fwd: number, x?: number): Vec3;
  };
}

/** The base horse (bay gelding): skeleton and body parts. */
export function horseBody(source: Rig): HorseBody {
  const rig = horseRig(source);
  const bone = (n: string) => rig.bones[rig.index.get(n)!];
  const H = (n: string) => bone(n).head;
  const T = (n: string) => bone(n).tail;
  const F = HORSE_FUR;
  const c = (coat: number, fur = 1) => Math.max(0.004, coat - F * fur);

  const parts: BodyPart[] = [];
  const put = (prim: Primitive, k: number, bones: string[], region: Region, flow: (p: Vec3) => Vec3, fur = 1, carve = false) =>
    parts.push({ prim, k, carve, bones, region, flow, fur });

  // --- Trunk: one loft from the chest to the buttocks (photo side profile; widths from horse anatomy) ---
  // A gently inclined straight path; top and under line are distances from it.
  const TRUNK: [number, number, number, number][] = [
    [702, 272, 352, 0.09],
    [672, 222, 392, 0.15],
    [640, 188, 414, 0.18],
    [600, 164, 432, 0.195],
    [545, 152, 428, 0.21],
    [485, 150, 420, 0.235],
    [425, 160, 414, 0.258],
    [365, 158, 404, 0.268],
    [305, 150, 388, 0.262],
    [255, 145, 372, 0.245],
    [205, 141, 352, 0.228],
    [155, 150, 334, 0.2],
    [110, 168, 322, 0.165],
    [72, 196, 318, 0.12],
    [50, 232, 312, 0.06],
  ];
  const pathY = (px: number) => ph(px, 286 - (px - 360) * 0.02)[1];
  const sec = ([px, top, bottom, w]: [number, number, number, number]): LoftKey => {
    const y = pathY(px);
    return { at: [0, y, ph(px, 0)[2]], w: c(w), up: c(ph(px, top)[1] - y), down: c(y - ph(px, bottom)[1]), n: 2.25 };
  };
  put(loft("trunk", TRUNK.map(sec)), 0, ["hips", "spine_1", "spine_2", "spine_3", "ribcage_middle"], "torso", BACKWARD);
  // Withers: the ridge of the spines over the shoulder blades, between the back and the crest.
  put(capsule("withers", ph(452, 166), ph(560, 150), 0.07, 0.06, [1, 0, 0], [0.75, 1]), 0.08, ["spine_3", "spine_2"], "torso", BACKWARD);
  // Croup: the rounded top of the hindquarters; the point of the hip at each side.
  put(ellipsoid("croup", ph(170, 200), frameFrom([0, 0, 1]), [0.2, 0.09, 0.22]), 0.09, ["hips", "spine_1"], "torso", BACKWARD);
  for (const s of [1, -1]) put(ellipsoid("hip", ph(252, 192, 0.17 * s), frameFrom([0, -0.2, 1]), [0.045, 0.045, 0.07]), 0.12, ["hips", "spine_1"], "torso", BACKWARD);

  // --- Neck: crest and throat lines from the photo, sections along the neck's middle ---
  const crest = [ph(500, 141), ph(560, 128), ph(600, 114), ph(640, 97), ph(680, 79), ph(720, 65), ph(760, 55), ph(800, 45), ph(838, 40), ph(856, 44)];
  const throat = [ph(640, 412), ph(672, 360), ph(700, 294), ph(720, 268), ph(740, 247), ph(760, 224), ph(780, 202), ph(800, 186), ph(826, 178)];
  /** Mane and crest hair on top of the neck (the photo's crest line includes it). */
  const MANE = 0.022;
  const nk = (at: Vec3, w: number, n = 2.15): LoftKey => ({ at, w: c(w), up: c(lineDistance(at, crest) - MANE), down: c(lineDistance(at, throat)), n });
  const neckPath = [ph(560, 250), ph(610, 236), ph(660, 214), ph(705, 182), ph(750, 150), ph(795, 118), ph(832, 92)];
  const neckW = [0.18, 0.175, 0.16, 0.14, 0.12, 0.1, 0.085];
  put(loft("neck", neckPath.map((p, i) => nk(p, neckW[i]))), 0.06, ["spine_3", "spine_4", "spine_5", "spine_6", "head"], "neck", () => [0, -1, -0.5]);

  // --- Head: a loft from the poll to the muzzle (the photo head is turned a little towards the camera) ---
  const poll = ph(852, 50), tip = ph(976, 242);
  const headAxis = normalize(sub(tip, poll));
  const headLen = len(sub(tip, poll));
  const HEAD: [number, number, number, number][] = [
    // t along the axis, height in front of it (forehead side) and behind it (jaw side) in pixels, half width (m).
    [-0.02, 8, 26, 0.06],
    [0.08, 15, 50, 0.085],
    [0.2, 20, 62, 0.1],
    [0.32, 22, 58, 0.1],
    [0.45, 21, 44, 0.088],
    [0.58, 19, 33, 0.074],
    [0.7, 18, 27, 0.064],
    [0.8, 17, 25, 0.06],
    [0.89, 16, 26, 0.064],
    [0.96, 11, 24, 0.058],
    [1.0, 4, 16, 0.042],
  ];
  // Sections lie across the axis; "up" (the loft's v) points to the forehead.
  const hd = ([t, up, down, w]: [number, number, number, number]): LoftKey => ({ at: add(poll, scale(headAxis, t * headLen)), w: c(w, 0.6), up: c(up * PX, 0.6), down: c(down * PX, 0.6), n: 2.3 });
  // upHint: forward and up, so the sections' "up" faces the forehead whatever the head's slope.
  put(loft("skull", HEAD.map(hd), normalize([0, 1, 0.6])), 0.05, ["head", "nose", "spine_6"], "head", BACKWARD, 0.6);
  const headPt = (t: number, fwd: number, x = 0): Vec3 => {
    // A point at t along the axis, `fwd` metres towards the forehead side (negative: towards the jaw).
    const u = normalize(cross([0, 1, 0.6], headAxis));
    const v = cross(headAxis, u);
    return add(add(poll, scale(headAxis, t * headLen)), add(scale(v, fwd), [x, 0, 0]));
  };
  // Jowls: the big round cheeks (masseters) over the back of the lower jaw.
  for (const s of [1, -1]) put(ellipsoid("jowl", headPt(0.24, -0.105, 0.074 * s), frameFrom(headAxis, [1, 0, 0]), [0.05, 0.1, 0.1]), 0.08, ["head", "mouth"], "head", BACKWARD, 0.6);
  // Facial crest below the eye, running towards the nose.
  for (const s of [1, -1]) put(capsule("facialcrest", headPt(0.26, -0.035, 0.085 * s), headPt(0.5, -0.03, 0.068 * s), 0.012, 0.008), 0.03, ["head"], "head", BACKWARD, 0.6);
  // Lower jaw: the two mandibles meeting at the chin; the chin groove and lower lip.
  put(capsule("jaw", headPt(0.42, -0.1), headPt(0.88, -0.075), 0.045, 0.035, [1, 0, 0], [1.2, 0.9]), 0.05, ["mouth", "head"], "jaw", BACKWARD, 0.6);
  put(ellipsoid("chin", headPt(0.93, -0.085), frameFrom(headAxis, [1, 0, 0]), [0.036, 0.03, 0.036]), 0.025, ["mouth_tip", "mouth"], "jaw", BACKWARD, 0.5);
  // Muzzle: soft lips and the big nostrils.
  put(ellipsoid("muzzle", headPt(0.94, -0.01), frameFrom(headAxis, [1, 0, 0]), [0.06, 0.055, 0.05]), 0.03, ["head_leaf", "nose"], "muzzle", BACKWARD, 0.4);
  const nostrils: Vec3[] = [];
  for (const s of [1, -1]) {
    const n = headPt(0.92, 0.015, 0.045 * s);
    nostrils.push(n);
    // A comma-shaped opening: long, slanting up and back, carved into the side of the muzzle.
    put(ellipsoid("nostril", n, frameFrom(normalize(add(headAxis, [0, 0.9, 0])), [s, 0, 0]), [0.016, 0.007, 0.026]), 0.006, ["nose", "head_leaf"], "nose", BACKWARD, 0, true);
    // Its rim (the alar fold) above.
    put(capsule("nostrilrim", headPt(0.88, 0.035, 0.04 * s), headPt(0.95, 0.03, 0.048 * s), 0.008, 0.006), 0.012, ["nose", "head_leaf"], "muzzle", BACKWARD, 0.4);
  }
  // Mouth slit between the upper and lower lip, so the jaw can open.
  const mouthBack = headPt(0.86, -0.05), mouthFront = headPt(1.04, -0.06);
  put(box("mouth", lerp(mouthBack, mouthFront, 0.5), frameFrom(sub(mouthFront, mouthBack)), [0.07, 0.0025, len(sub(mouthFront, mouthBack)) / 2]), 0.004, ["mouth"], "jaw", BACKWARD, 0, true);

  // Eyes: large, on the sides of the head behind the facial crest; sunk into almond lids.
  const eyeR = 0.024;
  const eyes = [1, -1].map((s) => {
    const from = headPt(0.27, 0.0, 0);
    const out = normalize([s, 0.12, 0.28]);
    let t = 0;
    while (t < 0.3 && bodyDistance(parts, add(from, scale(out, t))) < 0) t += 0.0005;
    const center = add(from, scale(out, t - eyeR * 0.9));
    return { center, radius: eyeR, look: normalize([0.85 * s, -0.1, 0.55]) as Vec3, out, side: s };
  });
  for (const e of eyes) {
    put(ellipsoid("brow", add(e.center, [0.006 * e.side, 0.02, -0.006]), frameFrom([0, 0.2, 1]), [0.018, 0.012, 0.03]), 0.02, ["head"], "head", BACKWARD, 0.5);
    put(lens("socket", add(e.center, scale(e.out, eyeR * 0.55)), frameFrom(e.out, normalize([0, 0.15, -1])), eyeR * 1.35, eyeR * 0.62), 0.004, ["head"], "head", BACKWARD, 0.3, true);
  }

  // Ears: tall, pointed, cupped forward and out.
  for (const side of ["l", "r"] as const) {
    const s = side === "l" ? 1 : -1;
    const a = H(`ear_1_${side}`), b = T(`ear_leaf_${side}`);
    const axis = normalize(sub(b, a));
    const facing = normalize(sub([0.5 * s, 0.1, 1], scale(axis, dot([0.5 * s, 0.1, 1], axis))));
    const bones = [`ear_1_${side}`, `ear_2_${side}`, `ear_leaf_${side}`];
    put(capsule("ear", lerp(a, b, -0.05), lerp(a, b, 0.96), 0.05, 0.012, facing, [0.6, 1]), 0.025, [...bones, "head"], "ear", along(a, b), 0.5);
    const fwd = (p: Vec3, d: number) => add(p, scale(facing, d));
    put(capsule("ear", fwd(lerp(a, b, 0.12), 0.016), fwd(lerp(a, b, 0.88), 0.006), 0.038, 0.006, facing, [0.6, 0.8]), 0.006, bones, "ear", along(a, b), 0.3, true);
  }

  // --- Shoulder and chest ---
  for (const side of ["l", "r"] as const) {
    const s = side === "l" ? 1 : -1;
    const scap = `front_scapula_${side}`, hum = `front_humerus_${side}`, up = `front_leg_upper_${side}`;
    // Shoulder blade lying flat on the chest wall, from the withers down to the point of the shoulder.
    put(capsule("scapula", ph(520, 200, 0.13 * s), ph(650, 318, 0.165 * s), 0.06, 0.075, [1, 0, 0], [0.55, 1]), 0.12, [scap, "spine_3"], "torso", BACKWARD);
    // Arm: point of the shoulder in front, the triceps behind, down to the elbow (slices along the photo outline).
    put(
      slices("arm", [
        [282, 660, 606, 0.115, 0.07],
        [315, 674, 590, 0.13, 0.08],
        [350, 674, 572, 0.135, 0.08],
        [385, 662, 556, 0.14, 0.074],
        [410, 644, 548, 0.145, 0.064],
        [432, 624, 550, 0.148, 0.054],
      ], s),
      0.14, [hum, scap], "leg", along(H(hum), T(hum)),
    );
    put(ellipsoid("elbow", ph(556, 418, 0.155 * s), frameFrom([0, 1, 0]), [0.035, 0.04, 0.045]), 0.05, [up, hum], "leg", BACKWARD);
    // Breast: the pectoral muscles between the front legs.
    put(ellipsoid("pectoral", ph(664, 372, 0.065 * s), frameFrom([0, -0.6, 1], [1, 0, 0]), [0.065, 0.07, 0.085]), 0.12, ["ribcage_front", hum], "torso", () => [0, -1, -0.2]);
  }

  // --- Front legs: forearm, knee, cannon with its tendons, fetlock, pastern, hoof ---
  let kneeY = 0;
  for (const side of ["l", "r"] as const) {
    const s = side === "l" ? 1 : -1;
    const up = `front_leg_upper_${side}`, low = `front_leg_lower_${side}`, ank = `front_leg_ankle_${side}`, foot = `front_leg_foot_${side}`;
    const elbow = H(up), knee = H(low), fet = H(ank), coronet = H(foot);
    kneeY = knee[1];
    // Forearm: deep and muscled at the top (more in front), tapering to the knee.
    put(
      slices("forearm", [
        [425, 626, 550, 0.15, 0.058],
        [460, 620, 556, 0.148, 0.052],
        [500, 613, 562, 0.145, 0.044],
        [535, 608, 566, 0.142, 0.04],
        [552, 606, 568, 0.14, 0.04],
        [566, 604, 570, 0.14, 0.036],
      ], s, 2.3),
      0.08, [up, `front_humerus_${side}`], "leg", along(elbow, knee), 0.8,
    );
    // Knee: flat in front, the accessory carpal bone sticking out behind.
    put(ellipsoid("knee", add(knee, [0, 0, 0.004]), frameFrom([0, 1, 0], [1, 0, 0]), [0.04, 0.05, 0.042]), 0.025, [low, up], "leg", along(knee, fet), 0.6);
    put(ellipsoid("accessory", add(knee, [0, 0.012, -0.04]), frameFrom([0, 1, 0]), [0.022, 0.028, 0.02]), 0.02, [low, up], "leg", along(knee, fet), 0.6);
    cannon(put, knee, fet, coronet, [low, up], [ank, low], [foot, ank]);
  }

  // --- Hind legs: the quarters (thigh and hams), stifle, gaskin, hock, cannon, fetlock, pastern, hoof ---
  let hockY = 0;
  for (const side of ["l", "r"] as const) {
    const s = side === "l" ? 1 : -1;
    const pel = `back_leg_pelvis_${side}`, fem = `back_leg_upper_${side}`, tib = `back_leg_lower_${side}`, ank = `back_leg_ankle_${side}`, foot = `back_leg_foot_${side}`, toeB = `back_leg_toe_${side}`;
    const stifle = H(tib), hock = H(ank), fet = H(foot), coronet = H(toeB);
    hockY = hock[1];
    // Quarters: horizontal slices from under the croup down past the stifle; the front edge is the
    // stifle line, the back edge the buttock and hams (behind the tail in the photo).
    put(
      slices("quarter", [
        [205, 236, 72, 0.06, 0.16],
        [245, 248, 58, 0.1, 0.155],
        [290, 244, 58, 0.118, 0.145],
        [330, 236, 62, 0.126, 0.136],
        [370, 226, 68, 0.13, 0.125],
        [400, 214, 74, 0.134, 0.112],
        [425, 196, 78, 0.137, 0.09],
      ], s),
      0.1, [fem, pel, "hips"], "leg", along(H(fem), stifle),
    );
    // Lower thigh, gaskin and hock: the hams run down behind into the hamstring and the point of the hock.
    put(
      slices("gaskin", [
        [370, 226, 70, 0.13, 0.125],
        [400, 214, 74, 0.134, 0.112],
        [425, 196, 78, 0.137, 0.09],
        [455, 162, 74, 0.14, 0.068],
        [480, 128, 62, 0.143, 0.052],
        [500, 104, 48, 0.146, 0.044],
        [515, 86, 32, 0.148, 0.04],
        [535, 76, 40, 0.146, 0.034],
        [552, 72, 44, 0.143, 0.03],
      ], s),
      0.05, [tib, fem, ank], "leg", along(stifle, hock), 0.8,
    );
    cannon(put, hock, fet, coronet, [ank, tib], [foot, ank], [toeB, foot]);
  }

  // --- Tail: the dock, and the long hair falling from it to the hocks ---
  const dockR = [0.05, 0.042, 0.034, 0.028, 0.022, 0.018];
  TAIL.forEach((n, i) => {
    const a = H(n), b = T(n);
    put(capsule("dock", a, b, dockR[i], dockR[i + 1], [1, 0, 0], [0.9, 1]), i === 0 ? 0.06 : 0.015, i === 0 ? [n, "hips"] : [n, TAIL[i - 1]], "tail", along(a, b), 2);
  });
  const tailHair: LoftKey[] = [
    { at: ph(66, 224), w: 0.045, up: 0.035, down: 0.035, n: 2 },
    { at: ph(54, 300), w: 0.06, up: 0.045, down: 0.05, n: 2 },
    { at: ph(54, 400), w: 0.07, up: 0.05, down: 0.065, n: 2 },
    { at: ph(64, 490), w: 0.068, up: 0.045, down: 0.07, n: 2 },
    { at: ph(76, 570), w: 0.055, up: 0.035, down: 0.06, n: 2 },
    { at: ph(84, 630), w: 0.03, up: 0.02, down: 0.035, n: 2 },
    { at: ph(86, 648), w: 0.012, up: 0.008, down: 0.012, n: 2 },
  ];
  put(loft("tailhair", tailHair, [0, 0, 1]), 0.03, ["tail_3", "tail_4", "tail_leaf"], "tail", () => [0, -1, -0.1], 6);

  // --- Mane: a layer of long hair on the crest, falling to the left side; the forelock between the ears ---
  const skin = parts.filter((p) => !["tail", "ear", "leg", "hoof"].includes(p.region));
  const neckOnly = parts.filter((p) => p.prim.name === "neck");
  const maneLen = (z: number) => {
    // Longest along the middle of the neck, shorter towards the poll and the withers.
    const t = (z - crest[0][2]) / (crest[crest.length - 1][2] - crest[0][2]);
    return 0.06 + 0.17 * Math.sin(Math.PI * Math.max(0, Math.min(1, t)) ** 0.8);
  };
  const maneMask = (p: Vec3) => {
    const d = lineDistance(p, crest);
    // Down the left side; over the top a little onto the right side.
    return Math.max(d - (p[0] > 0 ? maneLen(p[2]) : 0.035), crest[0][2] - 0.02 - p[2], p[2] - crest[crest.length - 1][2] - 0.01);
  };
  put(layer("mane", neckOnly, 0.008, 0.012, maneMask, ph(490, 20, -0.25), ph(870, 330, 0.25)), 0.012, ["spine_4", "spine_5", "spine_6", "head", "spine_3"], "mane", () => [0.35, -1, -0.1], 9);
  // Forelock: a lock from the poll over the forehead between the eyes.
  put(capsule("forelock", headPt(0.0, 0.02), headPt(0.22, 0.03), 0.03, 0.014, [1, 0, 0], [1, 0.5]), 0.015, ["head"], "mane", () => normalize(headAxis), 5);

  // The seat: on top of the saddle (pad and panels, SADDLE_RISE) above the back at the seat's z.
  const seatZ = ph(...SEAT_PX)[2];
  const seat: Vec3 = [0, topLine(skin, seatZ) + SADDLE_RISE, seatZ];
  const saddle = bone("saddle");
  saddle.head = seat;
  saddle.tail = add(seat, [0, 0, 0.12]);
  return {
    rig,
    parts,
    eyes: eyes.map(({ center, radius, look }) => ({ center, radius, look })),
    unit: 2,
    band: 4,
    marks: {
      brows: eyes.map((e) => add(e.center, [0, 0.03, -0.01])),
      nose: tip,
      mouth: { y0: mouthBack[1], y1: mouthFront[1], z0: mouthBack[2], z1: mouthFront[2], halfWidth: 0.06 },
    },
    horse: { crest, kneeY, hockY, seat, muzzle: tip, skin, headPt },
  };
}

type Put = (prim: Primitive, k: number, bones: string[], region: Region, flow: (p: Vec3) => Vec3, fur?: number, carve?: boolean) => void;

/** Lower leg below the knee or hock: cannon and tendons, fetlock with its ergot, pastern, hoof. */
function cannon(put: Put, top: Vec3, fet: Vec3, coronet: Vec3, cannonBones: string[], fetBones: string[], hoofBones: string[]): void {
  const down = along(top, fet);
  // Cannon bone in front, flexor tendons behind: flat from the side, narrow from the front.
  put(capsule("cannon", add(top, [0, -0.03, 0.006]), add(fet, [0, 0.03, 0.004]), 0.03, 0.028, [1, 0, 0], [0.82, 1]), 0.025, cannonBones, "leg", down, 0.5);
  put(capsule("tendon", add(top, [0, -0.05, -0.026]), add(fet, [0, 0.03, -0.024]), 0.019, 0.02, [1, 0, 0], [0.8, 1]), 0.02, cannonBones, "leg", down, 0.5);
  // Fetlock: the round joint, deepest behind; the ergot under it.
  put(ellipsoid("fetlock", add(fet, [0, 0.0, -0.01]), frameFrom([0, 1, 0], [1, 0, 0]), [0.04, 0.046, 0.05]), 0.02, fetBones, "leg", down, 0.5);
  put(ellipsoid("ergot", add(fet, [0, -0.035, -0.046]), frameFrom([0, 1, 0]), [0.012, 0.012, 0.014]), 0.012, fetBones, "leg", down, 0.6);
  // Pastern: sloping forward down to the coronet.
  put(capsule("pastern", add(fet, [0, -0.01, -0.004]), add(coronet, [0, 0.01, -0.006]), 0.034, 0.036, [1, 0, 0], [0.92, 1]), 0.02, fetBones, "leg", along(fet, coronet), 0.5);
  hoof(put, coronet, hoofBones);
}

/** A hoof: horizontal slices from the coronet band to the ground, the toe wall sloping forward, the heels upright. */
function hoof(put: Put, coronet: Vec3, bones: string[]): void {
  const [x, cy, cz] = coronet;
  // [height, front, back (z from the coronet), half width]
  const rows: [number, number, number, number][] = [
    [cy + 0.004, 0.03, -0.034, 0.036],
    [cy - 0.006, 0.04, -0.04, 0.044],
    [cy * 0.5, 0.068, -0.046, 0.054],
    [0.004, 0.096, -0.048, 0.06],
    [-0.01, 0.1, -0.048, 0.061],
  ];
  const keys: LoftKey[] = rows.map(([y, f, b, w]) => ({ at: [x, y, cz + (f + b) / 2], w, up: (f - b) / 2, down: (f - b) / 2, n: 2.3 }));
  put(loft("hoof", keys, [0, 0, 1]), 0.006, bones, "hoof", () => [0, -1, 0.3], 0);
  // Heel bulbs.
  for (const d of [1, -1]) put(ellipsoid("heel", [x + 0.022 * d, 0.03, cz - 0.04], frameFrom([0, 1, 0]), [0.02, 0.026, 0.02]), 0.012, bones, "hoof", () => [0, -1, 0.3], 0);
  // Flat sole on the ground.
  put(box("sole", [x, -0.05, cz], frameFrom([0, 0, 1]), [0.12, 0.05, 0.16]), 0.003, bones, "hoof", () => [0, -1, 0.3], 0, true);
}

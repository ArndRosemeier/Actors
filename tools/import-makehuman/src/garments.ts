/**
 * Generates a small garment library from MakeHuman's "tights" helper: a
 * full-body suit that is part of the base mesh, so every garment cut from it
 * follows all morphs and the skeleton for free.
 *
 * Each garment is described by a signed "cut" function per vertex (meters,
 * positive = inside the garment) built from body landmarks (fitted joints).
 * The importer keeps every helper face that touches the inside and stores
 * the cut values per vertex; the renderer discards fragments where the
 * interpolated value is negative. That gives clean hems, sleeve ends and
 * necklines that don't follow the helper's quad rows.
 */
import type { ObjFace } from "./obj";
import type { GarmentInfo } from "@actors/human";

export interface GarmentContext {
  positions: number[]; // base positions (meters)
  dominantBone: (v: number) => string;
  joint: (bone: string, end?: "head" | "tail") => [number, number, number];
}

type Point = { x: number; y: number; z: number; bone: string };

export interface GarmentSpec {
  name: string;
  label: string;
  color: [number, number, number];
  roughness: number;
  /** Meters along the normal; larger values sit on top of smaller ones. */
  inflate: number;
  /** Pattern hint for the fabric shader. */
  fabric: "knit" | "denim" | "lace" | "smooth" | "screen";
  info?: GarmentInfo;
  /** Small intentional pieces (e.g. cuffs) need a smaller island threshold. */
  minIsland?: number;
  /** Signed distance-like value in meters: > 0 inside the garment. */
  cut: (c: Point, ctx: GarmentContext) => number;
}

const OUT = -0.05;
const IN = 0.05;
const dist = (c: Point, p: [number, number, number]) => Math.hypot(c.x - p[0], c.y - p[1], c.z - p[2]);
const has = (bone: string, ...names: string[]) => names.some((n) => bone === n || bone.startsWith(`${n}_`));
const min = Math.min;

/** Round neckline: below the neck joint and at least `r` away from it. */
const neckline = (c: Point, ctx: GarmentContext, r: number) => {
  const neck = ctx.joint("neck_01");
  return min(neck[1] + 0.01 - c.y, dist(c, neck) - r);
};

/** Meters along the arm from the shoulder joint (left/right by x sign), and the arm length. */
function armPos(c: Point, ctx: GarmentContext): [number, number] {
  const side = c.x >= 0 ? "l" : "r";
  const s = ctx.joint(`upperarm_${side}`);
  const w = ctx.joint(`hand_${side}`);
  const d = [w[0] - s[0], w[1] - s[1], w[2] - s[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  return [((c.x - s[0]) * d[0] + (c.y - s[1]) * d[1] + (c.z - s[2]) * d[2]) / len, len];
}

/** Meters down the leg from the hip joint, and the hip-to-ankle height. */
function legPos(c: Point, ctx: GarmentContext): [number, number] {
  const side = c.x >= 0 ? "l" : "r";
  const hip = ctx.joint(`thigh_${side}`)[1];
  const ankle = ctx.joint(`foot_${side}`)[1];
  return [hip - c.y, hip - ankle];
}

const isArm = (b: string) => has(b, "clavicle", "upperarm", "lowerarm", "hand");
const isLeg = (b: string) => has(b, "thigh", "calf", "foot", "ball");

/** Sleeve: inside until `t` (0 = shoulder, 1 = wrist) along the arm. Torso counts as inside. */
const sleeve = (c: Point, ctx: GarmentContext, t: number) => {
  if (has(c.bone, "hand")) return OUT;
  if (!isArm(c.bone)) return IN;
  const [s, len] = armPos(c, ctx);
  return t * len - s;
};

/** Leg opening at `t` (0 = hip joint, 1 = ankle). */
const legHole = (c: Point, ctx: GarmentContext, t: number) => {
  if (has(c.bone, "foot", "ball")) return OUT;
  if (!isLeg(c.bone)) return IN;
  const [s, len] = legPos(c, ctx);
  return t * len - s;
};

export const GARMENTS: GarmentSpec[] = [
  {
    name: "future-wrap", label: "3026 · Continuum wrap", color: [0.65, 0.77, 0.72],
    roughness: 0.75, inflate: 0.009, fabric: "knit",
    info: { category: "Future · clothing", occupies: ["top"] },
    cut: (c, ctx) => {
      if (isLeg(c.bone)) return OUT;
      // Diagonal hem and mismatched sleeves: familiar comfort, unfamiliar tailoring.
      const hem = ctx.joint("pelvis")[1] + 0.025 + c.x * 0.16;
      return min(c.y - hem, neckline(c, ctx, 0.075), sleeve(c, ctx, c.x >= 0 ? 0.78 : 0.35));
    },
  },
  {
    name: "future-trousers", label: "3026 · Transit trousers", color: [0.13, 0.19, 0.25],
    roughness: 0.72, inflate: 0.006, fabric: "smooth",
    info: { category: "Future · clothing", occupies: ["bottom"] },
    cut: (c, ctx) => isArm(c.bone) ? OUT : min(ctx.joint("pelvis")[1] + 0.07 - c.y, legHole(c, ctx, 0.94)),
  },
  {
    name: "future-mantle", label: "3026 · Aurora screen mantle", color: [0.25, 0.65, 0.8],
    roughness: 0.4, inflate: 0.019, fabric: "screen",
    info: { category: "Future · screens", occupies: ["mantle"] },
    cut: (c, ctx) => {
      if (isLeg(c.bone)) return OUT;
      const chest = ctx.joint("spine_03")[1];
      return min(c.y - (chest - 0.07 + c.x * 0.42), neckline(c, ctx, 0.095), sleeve(c, ctx, c.x >= 0 ? 0.12 : 0.47));
    },
  },
  {
    name: "future-screen", label: "3026 · Living canvas", color: [0.65, 0.3, 0.8],
    roughness: 0.38, inflate: 0.01, fabric: "screen",
    info: { category: "Future · screens", occupies: ["top"] },
    cut: (c, ctx) => {
      if (isLeg(c.bone)) return OUT;
      const hem = ctx.joint("pelvis")[1] + 0.015;
      return min(c.y - hem, neckline(c, ctx, 0.09), sleeve(c, ctx, 0.68));
    },
  },
  {
    name: "future-cuffs", label: "3026 · Conversation cuffs", color: [0.65, 0.8, 0.6],
    roughness: 0.35, inflate: 0.022, fabric: "screen", minIsland: 4,
    info: { category: "Future · accessories", occupies: ["wrists"] },
    cut: (c, ctx) => {
      if (!has(c.bone, "lowerarm")) return OUT;
      const [s, len] = armPos(c, ctx);
      return min(s - len * 0.76, len * 0.97 - s);
    },
  },
  {
    name: "future-belt", label: "3026 · Keepsake belt", color: [0.65, 0.4, 0.22],
    roughness: 0.5, inflate: 0.025, fabric: "smooth", minIsland: 4,
    info: { category: "Future · accessories", occupies: ["belt"] },
    cut: (c, ctx) => isArm(c.bone) || isLeg(c.bone) ? OUT : 0.045 - Math.abs(c.y - ctx.joint("pelvis")[1] - 0.065 - c.x * 0.12),
  },
  {
    name: "future-gaiters", label: "3026 · Habitat gaiters", color: [0.62, 0.69, 0.75],
    roughness: 0.65, inflate: 0.017, fabric: "smooth", minIsland: 4,
    info: { category: "Future · accessories", occupies: ["gaiters"] },
    cut: (c, ctx) => {
      if (!has(c.bone, "calf")) return OUT;
      const [s, len] = legPos(c, ctx);
      return min(s - len * 0.62, len * 0.99 - s);
    },
  },
  {
    name: "briefs",
    label: "Briefs",
    color: [0.12, 0.12, 0.14],
    roughness: 0.6,
    inflate: 0.0015,
    fabric: "knit",
    cut: (c, ctx) => {
      if (isArm(c.bone)) return OUT;
      const waist = ctx.joint("pelvis")[1] + 0.03;
      // Leg openings rise toward the hip at the sides.
      const side = Math.abs(c.x) / Math.max(0.05, Math.abs(ctx.joint("thigh_l")[0]) * 1.6);
      return min(waist - c.y, legHole(c, ctx, 0.06 - 0.1 * min(1, side)));
    },
  },
  {
    name: "bra",
    label: "Bra",
    color: [0.12, 0.12, 0.14],
    roughness: 0.55,
    inflate: 0.0015,
    fabric: "lace",
    cut: (c, ctx) => {
      if (isArm(c.bone) && !has(c.bone, "clavicle")) return OUT;
      const chest = ctx.joint("spine_03")[1];
      return min(chest + 0.12 - c.y, c.y - chest, 0.17 - Math.abs(c.x));
    },
  },
  {
    name: "tshirt",
    label: "T-shirt",
    color: [0.82, 0.8, 0.76],
    roughness: 0.85,
    inflate: 0.005,
    fabric: "knit",
    cut: (c, ctx) => {
      if (isLeg(c.bone)) return OUT;
      const hem = ctx.joint("pelvis")[1] + 0.02;
      return min(c.y - hem, neckline(c, ctx, 0.085), sleeve(c, ctx, 0.3));
    },
  },
  {
    name: "longsleeve",
    label: "Long-sleeve top",
    color: [0.2, 0.28, 0.4],
    roughness: 0.85,
    inflate: 0.006,
    fabric: "knit",
    cut: (c, ctx) => {
      if (isLeg(c.bone)) return OUT;
      const hem = ctx.joint("pelvis")[1];
      return min(c.y - hem, neckline(c, ctx, 0.075), sleeve(c, ctx, 0.95));
    },
  },
  {
    name: "shorts",
    label: "Shorts",
    color: [0.25, 0.3, 0.22],
    roughness: 0.8,
    inflate: 0.007,
    fabric: "smooth",
    cut: (c, ctx) => {
      if (isArm(c.bone)) return OUT;
      const waist = ctx.joint("pelvis")[1] + 0.06;
      return min(waist - c.y, legHole(c, ctx, 0.4));
    },
  },
  {
    name: "jeans",
    label: "Jeans",
    color: [0.16, 0.22, 0.36],
    roughness: 0.9,
    inflate: 0.008,
    fabric: "denim",
    cut: (c, ctx) => {
      if (isArm(c.bone)) return OUT;
      const waist = ctx.joint("pelvis")[1] + 0.06;
      return min(waist - c.y, legHole(c, ctx, 0.97));
    },
  },
];

/** Cut value per helper vertex for a garment. */
export function garmentCut(faces: ObjFace[], spec: GarmentSpec, ctx: GarmentContext): Map<number, number> {
  const values = new Map<number, number>();
  for (const f of faces)
    for (const v of f.v) {
      if (values.has(v)) continue;
      const p = ctx.positions;
      const raw = spec.cut({ x: p[v * 3], y: p[v * 3 + 1], z: p[v * 3 + 2], bone: ctx.dominantBone(v) }, ctx);
      values.set(v, Math.max(OUT, Math.min(IN, raw)));
    }
  return values;
}

/** Faces a garment needs: every face with at least one inside vertex, minus stray islands. */
export function selectGarmentFaces(faces: ObjFace[], cut: Map<number, number>, minIsland = 40): ObjFace[] {
  const selected = faces.map((f) => f.v.some((v) => cut.get(v)! > 0));
  const clean = removeIslands(faces, selected, minIsland);
  return faces.filter((_, i) => clean[i]);
}

/** Faces fully inside (for hiding skin underneath). */
export function insideFaces(faces: ObjFace[], cut: Map<number, number>): ObjFace[] {
  return faces.filter((f) => f.v.every((v) => cut.get(v)! > 0));
}

function removeIslands(faces: ObjFace[], selected: boolean[], minIsland = 40): boolean[] {
  const byEdge = new Map<string, number[]>();
  faces.forEach((f, i) =>
    f.v.forEach((a, k) => {
      const b = f.v[(k + 1) % f.v.length];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (!byEdge.has(key)) byEdge.set(key, []);
      byEdge.get(key)!.push(i);
    }),
  );
  const nbrs: number[][] = faces.map(() => []);
  for (const list of byEdge.values()) for (const i of list) for (const j of list) if (i !== j) nbrs[i].push(j);
  const sel = selected.slice();
  const seen = new Uint8Array(faces.length);
  for (let i = 0; i < faces.length; i++) {
    if (!sel[i] || seen[i]) continue;
    const island = [i];
    seen[i] = 1;
    for (let k = 0; k < island.length; k++)
      for (const j of nbrs[island[k]])
        if (sel[j] && !seen[j]) {
          seen[j] = 1;
          island.push(j);
        }
    if (island.length < minIsland) for (const j of island) sel[j] = false;
  }
  return sel;
}

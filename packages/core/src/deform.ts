/**
 * Shape passes that run after the morph targets and before anything is fitted
 * to the body (skeleton, proxies, subdivided meshes), so all of them follow:
 *
 * - tips: pulls a region out into a point (pointed ears),
 * - bone proportions: per-bone length and girth scale through the skin weights,
 * - a uniform scale of the whole actor.
 *
 * Used for non-human proportions (dwarves, giants, elves...). Renderer-free.
 */
import type { Vec3 } from "./math";
import type { FittedSkeleton } from "./skeleton";
import type { MorphTarget } from "./target";

/** Length (along the bone) and girth (across it) factors; 1 = unchanged. */
export interface BoneScale {
  len?: number;
  girth?: number;
}

/**
 * Pulls the far end of a region out along `direction` (model space), e.g. the
 * upper ear into an elf's tip. The region and its falloff come from a morph
 * target: the larger a vertex's delta in `mask`, the more it belongs to the region.
 */
export interface TipDeform {
  mask: string;
  /** Tip growth in meters at full strength. */
  amount: number;
  direction: Vec3;
}

export interface ShapeOptions {
  /** By bone name. */
  bones?: Record<string, BoneScale>;
  tips?: TipDeform[];
  /** Uniform scale about the origin (the ground offset is the caller's business). */
  scale?: number;
}

/** True if the options change anything. */
export function hasShapeOptions(o: ShapeOptions | undefined): o is ShapeOptions {
  if (!o) return false;
  if (o.scale !== undefined && Math.abs(o.scale - 1) > 1e-5) return true;
  if (o.tips?.some((t) => t.amount > 1e-5)) return true;
  return Object.values(o.bones ?? {}).some((b) => Math.abs((b.len ?? 1) - 1) > 1e-5 || Math.abs((b.girth ?? 1) - 1) > 1e-5);
}

/** Per vertex 0..1: delta length of `target`, normalized to its largest delta. */
export function targetMask(target: MorphTarget, vertexCount: number): Float32Array {
  const out = new Float32Array(vertexCount);
  let max = 0;
  for (let i = 0; i < target.count; i++) {
    const v = target.indices ? target.indices[i] : i;
    const m = Math.hypot(target.deltas[i * 3], target.deltas[i * 3 + 1], target.deltas[i * 3 + 2]);
    out[v] = m;
    max = Math.max(max, m);
  }
  if (max > 0) for (let i = 0; i < vertexCount; i++) out[i] /= max;
  return out;
}

/** Applies one tip deformation in place. */
export function applyTip(positions: Float32Array, mask: Float32Array, amount: number, direction: Vec3): void {
  if (amount <= 1e-5) return;
  const n = mask.length;
  let cx = 0, cy = 0, cz = 0, sw = 0, top = -Infinity, bottom = Infinity;
  for (let i = 0; i < n; i++) {
    const m = mask[i];
    if (m <= 0.15) continue;
    cx += positions[i * 3] * m;
    cy += positions[i * 3 + 1] * m;
    cz += positions[i * 3 + 2] * m;
    sw += m;
    top = Math.max(top, positions[i * 3 + 1]);
    bottom = Math.min(bottom, positions[i * 3 + 1]);
  }
  if (!sw) return;
  cx /= sw;
  cy /= sw;
  cz /= sw;
  const half = Math.max(0.01, (top - bottom) / 2);
  const l = Math.hypot(...direction) || 1;
  const [ux, uy, uz] = direction.map((c) => c / l);
  for (let i = 0; i < n; i++) {
    const m = mask[i];
    if (m <= 0) continue;
    // How far along the tip direction the vertex lies, relative to the region's size.
    const along = ((positions[i * 3] - cx) * ux + (positions[i * 3 + 1] - cy) * uy + (positions[i * 3 + 2] - cz) * uz) / half;
    const t = Math.min(1.4, along - 0.05);
    if (t <= 0) continue;
    const k = Math.pow(t, 2.2) * Math.min(1, m * 1.6) * amount;
    positions[i * 3] += ux * k;
    positions[i * 3 + 1] += uy * k;
    positions[i * 3 + 2] += uz * k;
  }
}

/**
 * Bone proportion pass, in place. Every bone gets the linear map
 * girth·I + (len − girth)·d·dᵀ (d = bone direction); joints are moved down the
 * hierarchy with their parent's map and every vertex follows its bones through
 * the skin weights (linear blend skinning in the rest pose).
 */
export function applyBoneScales(
  positions: Float32Array,
  skeleton: Pick<FittedSkeleton, "names" | "parents" | "heads" | "tails">,
  joints: Uint16Array,
  weights: Float32Array,
  scales: Record<string, BoneScale>,
): void {
  const B = skeleton.names.length;
  const M = new Float64Array(B * 9);
  for (let i = 0; i < B; i++) {
    const s = scales[skeleton.names[i]];
    const len = s?.len ?? 1, girth = s?.girth ?? 1;
    const h = skeleton.heads[i], t = skeleton.tails[i];
    let dx = t[0] - h[0], dy = t[1] - h[1], dz = t[2] - h[2];
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl;
    dy /= dl;
    dz /= dl;
    const k = len - girth, o = i * 9;
    M[o] = girth + k * dx * dx;
    M[o + 1] = k * dx * dy;
    M[o + 2] = k * dx * dz;
    M[o + 3] = k * dy * dx;
    M[o + 4] = girth + k * dy * dy;
    M[o + 5] = k * dy * dz;
    M[o + 6] = k * dz * dx;
    M[o + 7] = k * dz * dy;
    M[o + 8] = girth + k * dz * dz;
  }
  const mul = (b: number, x: number, y: number, z: number, out: number[]) => {
    const o = b * 9;
    out[0] = M[o] * x + M[o + 1] * y + M[o + 2] * z;
    out[1] = M[o + 3] * x + M[o + 4] * y + M[o + 5] * z;
    out[2] = M[o + 6] * x + M[o + 7] * y + M[o + 8] * z;
  };
  // New joint positions: children keep their offset from the parent, mapped by the parent.
  const moved = new Float64Array(B * 3);
  const done = new Uint8Array(B);
  const tmp = [0, 0, 0];
  const place = (i: number): void => {
    if (done[i]) return;
    const p = skeleton.parents[i];
    const h = skeleton.heads[i];
    if (p < 0) moved.set(h, i * 3);
    else {
      place(p);
      const ph = skeleton.heads[p];
      mul(p, h[0] - ph[0], h[1] - ph[1], h[2] - ph[2], tmp);
      moved[i * 3] = moved[p * 3] + tmp[0];
      moved[i * 3 + 1] = moved[p * 3 + 1] + tmp[1];
      moved[i * 3 + 2] = moved[p * 3 + 2] + tmp[2];
    }
    done[i] = 1;
  };
  for (let i = 0; i < B; i++) place(i);
  const n = positions.length / 3;
  for (let v = 0; v < n; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    let ox = 0, oy = 0, oz = 0, sw = 0;
    for (let k = 0; k < 4; k++) {
      const w = weights[v * 4 + k];
      if (!w) continue;
      const b = joints[v * 4 + k];
      const h = skeleton.heads[b];
      mul(b, x - h[0], y - h[1], z - h[2], tmp);
      ox += w * (moved[b * 3] + tmp[0]);
      oy += w * (moved[b * 3 + 1] + tmp[1]);
      oz += w * (moved[b * 3 + 2] + tmp[2]);
      sw += w;
    }
    if (sw < 1e-6) continue;
    positions[v * 3] = ox / sw;
    positions[v * 3 + 1] = oy / sw;
    positions[v * 3 + 2] = oz / sw;
  }
}

export function applyScale(positions: Float32Array, scale: number): void {
  if (Math.abs(scale - 1) < 1e-6) return;
  for (let i = 0; i < positions.length; i++) positions[i] *= scale;
}

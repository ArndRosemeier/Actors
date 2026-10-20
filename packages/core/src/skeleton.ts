import type { SkeletonDef } from "./format";
import {
  type Mat3,
  type Quat,
  type Vec3,
  length,
  mat3AxisAngle,
  mat3Mul,
  mat3Transpose,
  mat3Apply,
  normalize,
  quatFromMat3,
  sub,
} from "./math";

/** A skeleton fitted to the current body shape: bind pose in model space and parent-relative. */
export interface FittedSkeleton {
  names: string[];
  parents: Int32Array;
  heads: Vec3[];
  tails: Vec3[];
  /** Model-space bind rotation of each bone (local +Y points from head to tail). */
  worldRotations: Mat3[];
  /** Parent-relative bind transforms: translation and rotation. */
  localPositions: Vec3[];
  localRotations: Quat[];
}

// Bones carry Blender-convention rolls. Blender is Z-up/-Y-forward, the pack
// is Y-up/+Z-forward: blender (x, y, z) = pack (x, -z, y).
const PACK_FROM_BLENDER: Mat3 = new Float64Array([1, 0, 0, 0, 0, -1, 0, 1, 0]);
const toBlender = (v: Vec3): Vec3 => [v[0], -v[2], v[1]];

/**
 * Rotation taking +Y onto `dir` by the shortest arc, then rolled around `dir`.
 * Same result as Blender's vec_roll_to_mat3, so rolls exported from Blender rigs apply unchanged.
 */
export function boneRotationFromRoll(dir: Vec3, roll: number): Mat3 {
  const [x, y, z] = dir;
  let base: Mat3;
  const sinA = Math.hypot(x, z);
  if (1 + y < 1e-8) {
    base = new Float64Array([-1, 0, 0, 0, -1, 0, 0, 0, 1]);
  } else if (sinA < 1e-12) {
    base = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  } else {
    // Axis = Y x dir = (z, 0, -x), angle = acos(y).
    base = mat3AxisAngle([z / sinA, 0, -x / sinA], Math.atan2(sinA, y));
  }
  return mat3Mul(mat3AxisAngle(dir, roll), base);
}

function jointPosition(positions: Float32Array, vertices: number[]): Vec3 {
  let x = 0, y = 0, z = 0;
  for (const v of vertices) {
    x += positions[v * 3];
    y += positions[v * 3 + 1];
    z += positions[v * 3 + 2];
  }
  const n = vertices.length || 1;
  return [x / n, y / n, z / n];
}

/** Places every joint from the morphed vertex positions and derives the bind pose. */
export function fitSkeleton(def: SkeletonDef, positions: Float32Array): FittedSkeleton {
  const n = def.bones.length;
  const names: string[] = [];
  const parents = new Int32Array(n);
  const heads: Vec3[] = [];
  const tails: Vec3[] = [];
  const worldRotations: Mat3[] = [];
  const localPositions: Vec3[] = [];
  const localRotations: Quat[] = [];

  def.bones.forEach((bone, i) => {
    names.push(bone.name);
    parents[i] = bone.parent;
    const head = jointPosition(positions, bone.head.vertices);
    const tail = jointPosition(positions, bone.tail.vertices);
    heads.push(head);
    tails.push(tail);
    let dirPack = sub(tail, head);
    if (length(dirPack) < 1e-9) dirPack = [0, 1, 0];
    const dirBlender = normalize(toBlender(dirPack));
    // Bone axes in pack space: same local frame as in Blender, expressed in Y-up coordinates.
    const rot = mat3Mul(PACK_FROM_BLENDER, boneRotationFromRoll(dirBlender, bone.roll));
    worldRotations.push(rot);

    if (bone.parent < 0) {
      localPositions.push(head);
      localRotations.push(quatFromMat3(rot));
    } else {
      const parentRot = worldRotations[bone.parent];
      const parentInv = mat3Transpose(parentRot);
      localPositions.push(mat3Apply(parentInv, sub(head, heads[bone.parent])));
      localRotations.push(quatFromMat3(mat3Mul(parentInv, rot)));
    }
  });

  return { names, parents, heads, tails, worldRotations, localPositions, localRotations };
}

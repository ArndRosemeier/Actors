import * as THREE from "three";

const rootInverse = new THREE.Matrix4();
const offset = new THREE.Matrix4();

/**
 * A skeleton whose bone matrices are relative to the character's root object, not the world.
 *
 * three's own skeleton uploads `bone.matrixWorld × boneInverse`, so the bone matrices carry the
 * character's world position. The GPU does the skinning in 32-bit floats: tens of kilometres from
 * the origin a float only resolves millimetres (3.9 mm at 32 km), so every vertex lands a little off,
 * differently each frame, and the whole figure shimmers (clothes worst: body and garment disagree).
 * Here the root's transform is taken out on the CPU, in doubles, so the GPU only sees small numbers.
 *
 * Meshes bound to it must sit at the root (children of it with no transform of their own) and use
 * `bindRoot`, which turns off three's attached bind mode (its world inverse is already taken out).
 */
export class RootSkeleton extends THREE.Skeleton {
  constructor(bones: THREE.Bone[], readonly root: THREE.Object3D, boneInverses?: THREE.Matrix4[]) {
    super(bones, boneInverses);
  }

  override update(): void {
    rootInverse.copy(this.root.matrixWorld).invert();
    const m = this.boneMatrices!;
    for (let i = 0; i < this.bones.length; i++) {
      const bone = this.bones[i];
      offset.multiplyMatrices(rootInverse, bone ? bone.matrixWorld : offset.identity());
      offset.multiply(this.boneInverses[i]);
      offset.toArray(m, i * 16);
    }
    if (this.boneTexture !== null) this.boneTexture.needsUpdate = true;
  }
}

/** Binds a mesh at the root to a `RootSkeleton` (detached: its bind inverse stays identity). */
export function bindRoot(mesh: THREE.SkinnedMesh, skeleton: THREE.Skeleton): void {
  mesh.bindMode = THREE.DetachedBindMode;
  mesh.bind(skeleton, new THREE.Matrix4());
  mesh.applyBoneTransform = rootBoneTransform as THREE.SkinnedMesh["applyBoneTransform"];
}

const meshInverse = new THREE.Matrix4();

/**
 * three's CPU skinning (raycasts, bounds, `getVertexPosition`) reads the bones' world matrices, not the
 * uploaded ones: with the bind inverse left at identity that gives a world position, so take the mesh's
 * world transform back out to stay in the mesh's own space, as three's attached mode does.
 */
function rootBoneTransform(this: THREE.SkinnedMesh, index: number, target: THREE.Vector3): THREE.Vector3 {
  THREE.SkinnedMesh.prototype.applyBoneTransform.call(this, index, target);
  return target.applyMatrix4(meshInverse.copy(this.matrixWorld).invert());
}

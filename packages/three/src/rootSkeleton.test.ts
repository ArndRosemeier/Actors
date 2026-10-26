import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { RootSkeleton, bindRoot } from "./rootSkeleton";

/** A root with one bent bone chain far from the origin, and a mesh at the root bound to `skeleton`. */
function rig(far: number, make: (bones: THREE.Bone[], root: THREE.Object3D) => THREE.Skeleton, bind: (m: THREE.SkinnedMesh, s: THREE.Skeleton) => void) {
  const root = new THREE.Group();
  const a = new THREE.Bone(), b = new THREE.Bone();
  b.position.set(0, 0.5, 0);
  a.add(b);
  root.add(a);
  root.updateMatrixWorld(true);
  const skeleton = make([a, b], root);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([0.1, 0.7, 0], 3));
  g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute([1, 0, 0, 0], 4));
  g.setAttribute("skinWeight", new THREE.Float32BufferAttribute([1, 0, 0, 0], 4));
  const mesh = new THREE.SkinnedMesh(g, new THREE.MeshBasicMaterial());
  root.add(mesh);
  bind(mesh, skeleton);
  root.position.set(far, 12, -far);
  root.rotation.y = 0.7;
  a.rotation.z = 0.3;
  b.rotation.x = -0.4;
  root.updateMatrixWorld(true);
  skeleton.update();
  return { mesh, skeleton };
}

describe("RootSkeleton", () => {
  it("skins to the same place as three's world skeleton, with bone matrices free of the world position", () => {
    const ours = rig(32000, (b, r) => new RootSkeleton(b, r), bindRoot);
    const theirs = rig(32000, (b) => new THREE.Skeleton(b), (m, s) => m.bind(s, new THREE.Matrix4()));
    const p = ours.mesh.getVertexPosition(0, new THREE.Vector3());
    const q = theirs.mesh.getVertexPosition(0, new THREE.Vector3());
    expect(p.distanceTo(q)).toBeLessThan(1e-6);
    // What the GPU does with the uploaded matrices (bind matrices identity): the same point.
    const gpu = (s: THREE.Skeleton, mesh: THREE.SkinnedMesh) =>
      new THREE.Vector3(0.1, 0.7, 0).applyMatrix4(mesh.bindMatrix).applyMatrix4(new THREE.Matrix4().fromArray(s.boneMatrices!, 16)).applyMatrix4(mesh.bindMatrixInverse);
    expect(gpu(ours.skeleton, ours.mesh).distanceTo(q)).toBeLessThan(1e-6);
    // three's world matrices, rounded to 32 bits, miss by most of a millimetre already here.
    expect(gpu(theirs.skeleton, theirs.mesh).distanceTo(q)).toBeGreaterThan(1e-4);
    // The uploaded (32-bit) matrices hold the bone's offset from the root, not 32 km.
    const m = new THREE.Matrix4().fromArray(ours.skeleton.boneMatrices!, 16);
    expect(new THREE.Vector3().setFromMatrixPosition(m).length()).toBeLessThan(2);
    expect(Math.abs(theirs.skeleton.boneMatrices![16 + 12])).toBeGreaterThan(1000);
  });
});

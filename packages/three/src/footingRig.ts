import * as THREE from "three";
import { LibraryAnimal } from "./library";

/**
 * A skinned animal with legs, for checking feet against a ground (made here so a host's checks need no model files): a spine with a body box, and per leg a thigh, a calf and a foot with a flat sole box 0.05 m below
 * its joint. `legs` are the (x, z) of the hips; `leg` the length of each thigh and calf; `raised` (per leg, default 0) holds a hip that much
 * higher, so its sole is off the ground at rest. The model stands with its lowest soles on y = 0.
 */
export function syntheticWalker(legs: [number, number][], leg = 0.5, clips: THREE.AnimationClip[] = [], raised: number[] = []) {
  const model = new THREE.Group();
  const bones: THREE.Bone[] = [];
  const bone = (name: string, parent: THREE.Object3D, x: number, y: number, z: number) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    parent.add(b);
    bones.push(b);
    return b;
  };
  const root = bone("Root", model, 0, 0, 0);
  const spine = bone("Spine", root, 0, 2 * leg + 0.05 + 0.1, 0);
  const feetBones: THREE.Bone[] = [];
  legs.forEach(([x, z], n) => {
    const thigh = bone(`Thigh_${n}`, spine, x, -0.1 + (raised[n] ?? 0), z);
    const calf = bone(`Calf_${n}`, thigh, 0, -leg, 0);
    feetBones.push(bone(`Foot_${n}`, calf, 0, -leg, 0));
  });
  bone("Head", spine, 0, 0.2, 0.6);
  model.updateMatrixWorld(true);
  const pos: number[] = [], idx: number[] = [], w: number[] = [], index: number[] = [];
  const box = (b: THREE.Bone, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number) => {
    const at = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
    const base = pos.length / 3;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      pos.push(at.x + cx + sx * hx, at.y + cy + sy * hy, at.z + cz + sz * hz);
      idx.push(bones.indexOf(b), 0, 0, 0);
      w.push(1, 0, 0, 0);
    }
    for (const q of [[0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5], [0, 4, 5], [0, 5, 1], [2, 3, 7], [2, 7, 6], [0, 2, 6], [0, 6, 4], [1, 5, 7], [1, 7, 3]]) index.push(base + q[0], base + q[1], base + q[2]);
  };
  const lengthOf = Math.max(...legs.map((l) => Math.abs(l[1]))) + 0.2;
  const wideOf = Math.max(...legs.map((l) => Math.abs(l[0]))) + 0.1;
  box(spine, 0, 0.1, 0, wideOf, 0.15, lengthOf);
  for (const f of feetBones) box(f, 0, -0.025, 0.03, 0.06, 0.025, 0.12);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(idx, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(w, 4));
  geometry.setIndex(index);
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  model.add(mesh);
  mesh.bind(new THREE.Skeleton(bones));
  model.updateMatrixWorld(true);
  const object = new THREE.Group();
  const lib = new LibraryAnimal("walker", model, { clips: new Map(clips.map((c) => [c.name, c])), travel: new Map(), box: new THREE.Box3().setFromObject(model) }, "in-place");
  return { lib, model, mesh, bones, object: lib.object };
}

/**
 * How high each foot's lowest skin stands over the ground under it (a sole is a flat box: on a slope it touches along its uphill edge, so
 * the lowest point by height is not the one touching). Negative: in the ground.
 */
export function soleClearances(lib: LibraryAnimal, mesh: THREE.SkinnedMesh, ground: (x: number, z: number) => number): number[] {
  lib.object.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  const n = mesh.geometry.getAttribute("position").count;
  const least = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
    const bone = mesh.geometry.getAttribute("skinIndex").getComponent(i, 0);
    if (!mesh.skeleton.bones[bone].name.startsWith("Foot")) continue;
    least.set(bone, Math.min(least.get(bone) ?? Infinity, v.y - ground(v.x, v.z)));
  }
  return [...least.values()];
}

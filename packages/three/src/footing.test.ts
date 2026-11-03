import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { deform } from "@actors/core";
import { LibraryAnimal } from "./library";

/**
 * A skinned animal with legs: a spine with a body box, and per leg a thigh, a calf and a foot with a flat sole box 0.05 m below
 * its joint. `legs` are the (x, z) of the hips; `leg` the length of each thigh and calf. The model stands with its soles on y = 0.
 */
function walker(legs: [number, number][], leg = 0.5, clips: THREE.AnimationClip[] = []) {
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
    const thigh = bone(`Thigh_${n}`, spine, x, -0.1, z);
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

const quad = (leg = 0.5) => walker([[0.25, 0.5], [-0.25, 0.5], [0.25, -0.5], [-0.25, -0.5]], leg);
const biped = (leg = 0.5) => walker([[0.12, 0], [-0.12, 0]], leg);

/**
 * How high each foot's lowest skin stands over the ground under it (a sole is a flat box: on a slope it touches along its uphill edge, so
 * the lowest point by height is not the one touching). Negative: in the ground.
 */
function clearances(lib: LibraryAnimal, mesh: THREE.SkinnedMesh, ground: (x: number, z: number) => number): number[] {
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

const flat = () => 0;
const slope = (gx: number, gz = 0) => (x: number, z: number) => 3 + gx * x + gz * z;

describe("feet on the ground", () => {
  it("leaves a rested animal on flat ground where it stands", () => {
    const { lib, mesh } = quad();
    lib.setGround(flat);
    lib.update(0.1);
    for (const c of clearances(lib, mesh, flat)) expect(c).toBeCloseTo(0, 3);
  });

  it("keeps the soles on the ground with thick, long or short legs and a body grown tenfold, whatever the seed", () => {
    for (let seed = 0; seed < 8; seed++) {
      const a = quad();
      a.lib.object.scale.setScalar(1 + (seed % 4) * 4);
      a.lib.setDeform(deform({ recipe: "giant", seed, strength: 1, size: 1 + 2 * seed }));
      a.lib.setGround(flat);
      a.lib.update(1 / 30);
      const cs = clearances(a.lib, a.mesh, flat);
      const unit = a.lib.object.scale.x;
      for (const c of cs) expect(c, `seed ${seed}`).toBeGreaterThan(-0.02 * unit);
      expect(Math.min(...cs), `seed ${seed}`).toBeLessThan(0.02 * unit);
    }
  });

  it("stands a deformed animal on its soles even with no ground set (the rest lowering reads the skin)", () => {
    for (let seed = 0; seed < 6; seed++) {
      const { lib, mesh } = quad();
      lib.setDeform(deform({ recipe: "giant", seed, strength: 1, size: 1 + 3 * seed }));
      const c = clearances(lib, mesh, flat);
      expect(Math.min(...c), `seed ${seed}`).toBeCloseTo(0, 3);
    }
  });

  it("stands on a slope: leans with it, and every sole meets the ground", () => {
    for (const g of [slope(0.3), slope(0, 0.3), slope(-0.2, 0.25)]) {
      const { lib, mesh } = quad();
      lib.setGround(g);
      for (let i = 0; i < 30; i++) lib.update(1 / 30);
      for (const c of clearances(lib, mesh, g)) {
        expect(c).toBeGreaterThan(-0.01);
        expect(c).toBeLessThan(0.03);
      }
      // The body went up the slope with the ground, and is tilted with it.
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(lib.model.getWorldQuaternion(new THREE.Quaternion()));
      expect(up.angleTo(new THREE.Vector3(0, 1, 0))).toBeGreaterThan(0.05);
    }
  });

  it("puts a giant's feet on the slope too", () => {
    const { lib, mesh } = quad();
    lib.object.scale.setScalar(12);
    lib.setDeform(deform({ recipe: "giant", seed: 3, strength: 1, size: 12 }));
    const g = (x: number, z: number) => 5 + 0.25 * x - 0.1 * z;
    lib.setGround(g);
    for (let i = 0; i < 30; i++) lib.update(1 / 30);
    for (const c of clearances(lib, mesh, g)) {
      expect(c).toBeGreaterThan(-0.2);
      expect(c).toBeLessThan(0.6);
    }
  });

  it("lifts the body for a step under the front legs, and never sinks a sole", () => {
    const { lib, mesh } = quad();
    const step = (_x: number, z: number) => (z > 0.2 ? 0.3 : 0);
    lib.setGround(step);
    for (let i = 0; i < 30; i++) lib.update(1 / 30);
    for (const c of clearances(lib, mesh, step)) expect(c).toBeGreaterThan(-0.01);
    expect(lib.feet?.readings.every((r) => r.y >= r.ground - 0.01)).toBe(true);
  });

  it("works for two legs", () => {
    const { lib, mesh } = biped();
    const g = slope(0, 0.2);
    lib.setGround(g);
    for (let i = 0; i < 30; i++) lib.update(1 / 30);
    for (const c of clearances(lib, mesh, g)) {
      expect(c).toBeGreaterThan(-0.01);
      expect(c).toBeLessThan(0.03);
    }
  });

  it("does not pull a foot that is lifted in a step down to the ground", () => {
    const swing = new THREE.AnimationClip("Walk", 1, [
      // The front-left thigh swings forward and up: its foot is well above the ground.
      new THREE.QuaternionKeyframeTrack("Thigh_0.quaternion", [0, 1], [...new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.9).toArray(), ...new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.9).toArray()]),
    ]);
    const { lib, mesh } = walker([[0.25, 0.5], [-0.25, 0.5], [0.25, -0.5], [-0.25, -0.5]], 0.5, [swing]);
    lib.setGround(flat);
    lib.play("Walk");
    lib.update(0.1);
    const ys = clearances(lib, mesh, flat).sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(0, 2);
    expect(ys[3]).toBeGreaterThan(0.15);
  });

  it("never sinks a sole while the animal walks a gait over a slope, at any size", () => {
    // Diagonal pairs swing: a thigh forward lifts its foot, back plants it. Looped for a second.
    const q = (angle: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle).toArray();
    const times = [0, 0.25, 0.5, 0.75, 1];
    const swing = (n: number, phase: number) =>
      new THREE.QuaternionKeyframeTrack(`Thigh_${n}.quaternion`, times, times.flatMap((t) => q(0.5 * Math.sin(2 * Math.PI * (t + phase)))));
    const clip = new THREE.AnimationClip("Walk", 1, [swing(0, 0), swing(3, 0), swing(1, 0.5), swing(2, 0.5)]);
    for (const size of [1, 12]) {
      const { lib, mesh } = walker([[0.25, 0.5], [-0.25, 0.5], [0.25, -0.5], [-0.25, -0.5]], 0.5, [clip]);
      lib.object.scale.setScalar(size);
      if (size > 1) lib.setDeform(deform({ recipe: "giant", seed: 4, strength: 1, size }));
      const g = (x: number, z: number) => 0.2 * x + 0.15 * z;
      lib.setGround(g);
      lib.play("Walk");
      let worst = Infinity, jump = 0, last = NaN;
      for (let i = 0; i < 60; i++) {
        lib.update(1 / 30);
        worst = Math.min(worst, ...clearances(lib, mesh, g));
        const y = lib.model.getWorldPosition(new THREE.Vector3()).y;
        if (i > 3) jump = Math.max(jump, Math.abs(y - last));
        last = y;
      }
      expect(worst, `size ${size}`).toBeGreaterThan(-0.02 * size);
      // The body does not leap about: no more than a sixth of its height in a frame.
      expect(jump, `size ${size}`).toBeLessThan(size * 0.2);
    }
  });

  it("puts back the bones the animation left, and the body, when the ground is taken away", () => {
    const { lib, model, bones } = quad();
    const before = bones.map((b) => b.quaternion.toArray());
    const at = model.position.toArray();
    lib.setGround(slope(0.4, 0.1));
    for (let i = 0; i < 10; i++) lib.update(1 / 30);
    expect(model.position.toArray()).not.toEqual(at);
    lib.setGround(null);
    expect(model.position.toArray()).toEqual(at);
    expect(model.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    bones.forEach((b, i) => expect(b.quaternion.toArray()).toEqual(before[i]));
    expect(lib.feet).toBeUndefined();
  });

  it("does not add up from frame to frame: the same ground gives the same bones", () => {
    const { lib, bones } = quad();
    lib.setGround(slope(0.3));
    for (let i = 0; i < 20; i++) lib.update(1 / 30);
    const a = bones.map((b) => b.quaternion.toArray());
    for (let i = 0; i < 20; i++) lib.update(1 / 30);
    bones.forEach((b, i) => b.quaternion.toArray().forEach((c, k) => expect(c).toBeCloseTo(a[i][k], 3)));
  });

  it("keeps working after the deform changes, and costs nothing for an animal without a ground", () => {
    const { lib, mesh } = quad();
    lib.setGround(flat);
    lib.setDeform(deform({ recipe: "giant", seed: 5, strength: 1, size: 8 }));
    lib.object.scale.setScalar(8);
    lib.update(0.1);
    const ys = clearances(lib, mesh, flat);
    expect(Math.min(...ys)).toBeGreaterThan(-0.2);
    expect(Math.min(...ys)).toBeLessThan(0.2);
    lib.setGround(null);
    lib.setDeform(null);
    lib.update(0.1);
    expect(lib.model.position.y).toBe(0);
  });

  it("stays out of the way of an animal in the air", () => {
    const { lib, mesh } = quad();
    // The ground is far below: the body is not pulled down to it.
    lib.object.position.y = 4;
    lib.setGround(flat);
    lib.update(0.1);
    const ys = clearances(lib, mesh, flat);
    expect(Math.min(...ys)).toBeCloseTo(4, 1);
  });
});

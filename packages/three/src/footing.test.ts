import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { deform } from "@actors/core";
import { soleClearances as clearances, syntheticWalker as walker } from "./footingRig";

const quad = (leg = 0.5) => walker([[0.25, 0.5], [-0.25, 0.5], [0.25, -0.5], [-0.25, -0.5]], leg);
const biped = (leg = 0.5) => walker([[0.12, 0], [-0.12, 0]], leg);

const flat = () => 0;
/** Puts the animal's object where the ground is under it (the pass refuses a ground far from where the animal is placed), then sets the ground. */
const stand = (lib: { object: THREE.Object3D; setGround(g: (x: number, z: number) => number): void }, g: (x: number, z: number) => number) => {
  lib.object.position.y = g(lib.object.position.x, lib.object.position.z);
  lib.setGround(g);
};
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
      stand(lib, g);
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
    stand(lib, g);
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
    stand(lib, g);
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
      stand(lib, g);
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

  it("leans and stands a body that a clip lifts as a whole, as it does one that stays at its rest height", () => {
    // The spine is keyed 0.4 m above its rest place for the whole clip, every foot with it.
    const up = new THREE.VectorKeyframeTrack("Spine.position", [0, 1], [0, 1.15 + 0.4, 0, 0, 1.15 + 0.4, 0]);
    const { lib, mesh, model } = walker([[0.25, 0.5], [-0.25, 0.5], [0.25, -0.5], [-0.25, -0.5]], 0.5, [new THREE.AnimationClip("Idle", 1, [up])]);
    const g = slope(0.3);
    lib.object.position.y = g(0, 0);
    lib.setGround(g);
    lib.play("Idle");
    for (let i = 0; i < 30; i++) lib.update(1 / 30);
    for (const c of clearances(lib, mesh, g)) {
      expect(c).toBeGreaterThan(-0.01);
      expect(c).toBeLessThan(0.05);
    }
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(model.quaternion).angleTo(new THREE.Vector3(0, 1, 0))).toBeGreaterThan(0.1);
  });

  it("puts every foot on the ground of an animal that stands about, whatever its idle does with a leg", () => {
    // The idle holds the front-left thigh swung forward and up, the others as they rest.
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.6).toArray();
    const idle = new THREE.AnimationClip("Idle", 1, [new THREE.QuaternionKeyframeTrack("Thigh_0.quaternion", [0, 1], [...q, ...q])]);
    const lowest = (standing: boolean) => {
      const { lib, mesh } = walker([[0.25, 0.5], [-0.25, 0.5], [0.25, -0.5], [-0.25, -0.5]], 0.5, [idle]);
      lib.setGround(flat);
      lib.standing = standing;
      lib.play("Idle");
      for (let i = 0; i < 20; i++) lib.update(1 / 30);
      return Math.max(...clearances(lib, mesh, flat));
    };
    const hovering = lowest(false), standing = lowest(true);
    expect(hovering).toBeGreaterThan(0.1);
    // (The leg bends back to the ground within its limit; a share of a thigh's swing may be left.)
    expect(standing).toBeLessThan(0.06);
    expect(standing).toBeLessThan(0.5 * hovering);
  });

  it("lifts the body over a cliff edge that is higher than half its height under some feet only", () => {
    const { lib, mesh } = quad();
    const cliff = (_x: number, z: number) => (z > 0.2 ? 0.9 : 0);
    lib.setGround(cliff);
    for (let i = 0; i < 30; i++) lib.update(1 / 30);
    for (const c of clearances(lib, mesh, cliff)) expect(c).toBeGreaterThan(-0.01);
  });

  it("leaves an animal alone when the ground is nowhere near it (a wrong frame, a teleport)", () => {
    const { lib, model, mesh } = quad();
    lib.setGround(() => 500);
    for (let i = 0; i < 5; i++) lib.update(1 / 30);
    expect(model.position.toArray()).toEqual([0, 0, 0]);
    expect(model.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    expect(Math.min(...clearances(lib, mesh, flat))).toBeCloseTo(0, 3);
    lib.setGround(() => -3500);
    lib.update(1 / 30);
    expect(model.position.toArray()).toEqual([0, 0, 0]);
  });

  it("puts back the bones the animation left, and the body, when the ground is taken away", () => {
    const { lib, model, bones } = quad();
    const before = bones.map((b) => b.quaternion.toArray());
    const at = model.position.toArray();
    stand(lib, slope(0.4, 0.1));
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
    stand(lib, slope(0.3));
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

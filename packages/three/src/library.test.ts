import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { LibraryAnimal, estimateTravel, extractTravel, footBones, type RootMotion } from "./library";

/** A model whose root bone sits under a node turned -90° about X (as FBX conversions do), walking 2 m along +Z per second with a little sway. */
function walker() {
  const model = new THREE.Group();
  const armature = new THREE.Object3D();
  armature.name = "Armature";
  armature.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  const root = new THREE.Bone();
  root.name = "root";
  const pelvis = new THREE.Bone();
  pelvis.name = "pelvis";
  model.add(armature);
  armature.add(root);
  root.add(pelvis);
  model.updateMatrixWorld(true);
  // Armature space: model +Z is armature -Y, model +Y is armature +Z.
  const times: number[] = [], values: number[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    times.push(t);
    values.push(0.02 * Math.sin(t * Math.PI * 2), -2 * t, 0.5 + 0.01 * Math.sin(t * Math.PI * 4));
  }
  const walk = new THREE.AnimationClip("Walk", 1, [
    new THREE.VectorKeyframeTrack("root.position", times, values),
    new THREE.VectorKeyframeTrack("pelvis.position", [0, 1], [0, 0, 0, 0, 0.3, 0]),
  ]);
  const idle = new THREE.AnimationClip("Idle", 1, [new THREE.VectorKeyframeTrack("root.position", [0, 1], [0, 0, 0.5, 0.01, 0, 0.5])]);
  return { model, walk, idle };
}

function animal(mode: RootMotion) {
  const { model, walk, idle } = walker();
  const travel = new Map();
  if (mode !== "keep") for (const c of [walk, idle]) {
    const t = extractTravel(model, c);
    if (t) travel.set(c.name, t);
  }
  const clips = new Map([[walk.name, walk], [idle.name, idle]]);
  return new LibraryAnimal("walker", model, { clips, travel, box: new THREE.Box3().setFromObject(model) }, mode);
}

describe("library animals", () => {
  it("takes the ground travel out of the topmost moving bone, keeping height and sway", () => {
    const { model, walk, idle } = walker();
    const t = extractTravel(model, walk)!;
    expect(t.dx).toBeCloseTo(0, 5);
    expect(t.dz).toBeCloseTo(2, 5);
    const v = walk.tracks[0].values;
    // Armature y (model -z) now stays put; armature z (model height) keeps its bob.
    for (let i = 0; i < v.length / 3; i++) expect(v[i * 3 + 1]).toBeCloseTo(0, 5);
    expect(v[1 * 3 + 2]).not.toBeCloseTo(v[2], 4);
    // Idle only sways (1 cm): left alone.
    expect(extractTravel(model, idle)).toBeUndefined();
  });

  it("moves the object along the walk with rootMotion 'move', across loops", () => {
    const a = animal("move");
    a.object.rotation.y = Math.PI / 2; // facing +X
    a.object.updateMatrixWorld();
    a.play("Walk");
    a.update(0.25);
    expect(a.object.position.x).toBeCloseTo(0.5, 2);
    // The sideways sway (2 cm) travels with the object too: that is the root's exact path.
    expect(Math.abs(a.object.position.z)).toBeLessThan(0.03);
    a.update(1.5); // wraps once
    expect(a.object.position.x).toBeCloseTo(3.5, 2);
    expect(a.travelled.x).toBeCloseTo(3.5, 2);
    expect(a.speedOf("Walk")).toBeCloseTo(2, 5);
    expect(a.speedOf("Idle")).toBe(0);
  });

  it("reports but doesn't move with 'in-place', and leaves clips alone with 'keep'", () => {
    const a = animal("in-place");
    a.play("Walk");
    const step = a.update(0.5);
    expect(step.z).toBeCloseTo(1, 2);
    expect(a.object.position.length()).toBe(0);
    const k = animal("keep");
    k.play("Walk");
    expect(k.update(0.5).length()).toBe(0);
    expect(k.speedOf("Walk")).toBe(0);
  });

  it("cross-fades, picks clips by motion, and steps the animation less often far away", () => {
    const a = animal("move");
    a.play("Idle");
    a.play("Walk", { fade: 0.5 });
    for (let i = 0; i < 10; i++) a.update(0.05);
    // Walk's weight ramps from 0 to 1 over the fade, so it covers less than the full metre.
    expect(a.object.position.z).toBeGreaterThan(0.05);
    expect(a.object.position.z).toBeLessThan(1);
    expect(a.clipFor("walk")).toBe("Walk");
    expect(a.clipFor("idle")).toBe("Idle");
    expect(() => a.play("Gallop")).toThrow(/no clip/);
    a.setLod(2);
    const z = a.object.position.z;
    a.update(0.1);
    a.update(0.1);
    a.update(0.1);
    expect(a.object.position.z).toBe(z);
    a.update(0.1);
    expect(a.object.position.z).toBeCloseTo(z + 0.8, 2);
  });

  it("estimates the speed of a clip that walks on the spot from its planted feet", () => {
    const model = new THREE.Group();
    const hips = new THREE.Bone();
    hips.name = "hips";
    hips.position.y = 0.5;
    model.add(hips);
    const tail = new THREE.Bone();
    tail.name = "tail";
    hips.add(tail);
    for (const side of ["L", "R"]) {
      const foot = new THREE.Bone();
      foot.name = `foot${side}`;
      hips.add(foot);
    }
    // Each foot slides back 0.5 m on the ground in half a second, then swings forward lifted: 1 m/s.
    const times: number[] = [], l: number[] = [], r: number[] = [];
    const at = (t: number) => (t < 0.5 ? [0, -0.5, 0.25 - t] : [0, -0.4, -0.25 + (t - 0.5)]);
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      times.push(t);
      l.push(...at(t));
      r.push(...at((t + 0.5) % 1));
    }
    const clip = new THREE.AnimationClip("Walk", 1, [new THREE.VectorKeyframeTrack("footL.position", times, l), new THREE.VectorKeyframeTrack("footR.position", times, r)]);
    const tips = footBones(model);
    expect(tips.map((t) => t.name)).toEqual(["footL", "footR"]);
    const t = estimateTravel(model, clip, tips, 0.6)!;
    expect(t.dz).toBeCloseTo(1, 1);
    expect(Math.abs(t.dx)).toBeLessThan(0.01);
    // Standing still: no travel.
    const idle = new THREE.AnimationClip("Idle", 1, [new THREE.VectorKeyframeTrack("footL.position", [0, 1], [0, -0.5, 0.2, 0, -0.5, 0.2])]);
    expect(estimateTravel(model, idle, tips, 0.6)).toBeUndefined();
    // The model is back in its pose.
    expect(tips[0].position.length()).toBe(0);
  });
});

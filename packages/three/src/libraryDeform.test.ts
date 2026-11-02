import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { deform } from "@actors/core";
import { LibraryAnimal } from "./library";

/** A four-legged skinned model: a hip, a spine with a neck and head, and four legs of thigh, calf and foot hanging 1 m down. */
function quadruped() {
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
  const spine = bone("Spine", root, 0, 1, 0);
  const neck = bone("Neck", spine, 0, 0.2, 0.5);
  bone("Head", neck, 0, 0.1, 0.3);
  for (const [side, x] of [["L", 0.2], ["R", -0.2]] as const) for (const [end, z] of [["F", 0.4], ["B", -0.4]] as const) {
    const thigh = bone(`Thigh_${end}${side}`, spine, x, -0.1, z);
    const calf = bone(`Calf_${end}${side}`, thigh, 0, -0.45, 0);
    bone(`Foot_${end}${side}`, calf, 0, -0.4, 0);
  }
  // One triangle on each bone, so the mesh has a skeleton to bind.
  const geometry = new THREE.BufferGeometry();
  const pos: number[] = [], idx: number[] = [], w: number[] = [];
  model.updateMatrixWorld(true);
  bones.forEach((b, i) => {
    const p = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
    pos.push(p.x, p.y, p.z, p.x + 0.05, p.y, p.z, p.x, p.y, p.z + 0.05);
    for (let k = 0; k < 3; k++) { idx.push(i, 0, 0, 0); w.push(1, 0, 0, 0); }
  });
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(idx, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(w, 4));
  const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.5, 0.4, 0.3) });
  const mesh = new THREE.SkinnedMesh(geometry, material);
  model.add(mesh);
  mesh.bind(new THREE.Skeleton(bones));
  model.updateMatrixWorld(true);
  const walk = new THREE.AnimationClip("Walk", 1, [new THREE.VectorKeyframeTrack("Thigh_FL.quaternion", [0, 1], [0, 0, 0, 1, 0, 0, 0.1, 0.995])]);
  const lib = new LibraryAnimal("quad", model, { clips: new Map([["Walk", walk]]), travel: new Map(), box: new THREE.Box3().setFromObject(model) }, "in-place");
  return { lib, model, mesh, bones, material };
}

const lowestFoot = (bones: THREE.Bone[]) => Math.min(...bones.filter((b) => b.name.startsWith("Foot")).map((b) => new THREE.Vector3().setFromMatrixPosition(b.matrixWorld).y));
const scaleOf = (bones: THREE.Bone[], name: string) => bones.find((b) => b.name === name)!.scale;

describe("a deformed library animal", () => {
  it("is untouched by a plan of strength 0", () => {
    const { lib, bones, mesh, material } = quadruped();
    lib.setDeform(deform({ recipe: "giant", seed: 1, strength: 0 }));
    expect(lib.deform).toBeNull();
    for (const b of bones) expect(b.scale.toArray()).toEqual([1, 1, 1]);
    expect(mesh.material).toBe(material);
    expect(lib.gaitRate).toBe(1);
  });

  it("puts the plan's proportions on the bones after every animation step, and takes them off again", () => {
    const { lib, bones } = quadruped();
    const plan = deform({ recipe: "giant", seed: 6, strength: 1 });
    lib.setDeform(plan);
    // Thighs hang along y: girth across (x, z), length along y; the calf below carries the part, not the thigh's scale twice.
    // A bone's scale is relative to its parent's, so what a leg bone ends up with in the model is the product up the chain.
    const total = (name: string) => {
      const v = new THREE.Vector3(1, 1, 1);
      for (let b: THREE.Object3D | null = bones.find((x) => x.name === name)!; b && (b as THREE.Bone).isBone; b = b.parent) v.multiply(b.scale);
      return v;
    };
    expect(total("Thigh_FL").x).toBeCloseTo(plan.parts.leg.girth, 5);
    expect(total("Thigh_FL").y).toBeCloseTo(plan.parts.leg.len, 5);
    expect(total("Calf_FL").y).toBeCloseTo(plan.parts.leg.len, 5);
    expect(total("Foot_FL").y).toBeCloseTo(plan.parts.foot.len, 5);
    expect(total("Foot_FL").x).toBeCloseTo(plan.parts.foot.girth, 5);
    lib.play("Walk");
    // A clip with scale keys would set them back to 1: the plan goes on after the mixer.
    scaleOf(bones, "Thigh_FL").set(1, 1, 1);
    lib.update(0.1);
    expect(total("Thigh_FL").x).toBeCloseTo(plan.parts.leg.girth, 5);
    lib.setDeform(null);
    for (const b of bones) expect(b.scale.toArray()).toEqual([1, 1, 1]);
    expect(lib.gaitRate).toBe(1);
  });

  it("keeps the feet on the ground when the legs get shorter, whatever the seed", () => {
    for (let seed = 0; seed < 12; seed++) {
      const { lib, model, bones } = quadruped();
      const before = lowestFoot(bones);
      lib.setDeform(deform({ recipe: "giant", seed, strength: 1 }));
      model.updateMatrixWorld(true);
      expect(lowestFoot(bones), `seed ${seed}`).toBeCloseTo(before, 4);
    }
  });

  it("plays its clips slower by the plan's gait, however it is asked", () => {
    const { lib } = quadruped();
    const plan = deform({ recipe: "giant", seed: 1, strength: 1 });
    const a = lib.play("Walk", { speed: 2 })!;
    expect(a.timeScale).toBe(2);
    lib.setDeform(plan);
    expect(a.timeScale).toBeCloseTo(2 * plan.gait.rate, 6);
    expect(lib.play("Walk", { speed: 1 })!.timeScale).toBeCloseTo(plan.gait.rate, 6);
    lib.setDeform(null);
    expect(a.timeScale).toBe(1);
  });

  it("tints the skin with a material shared by animals of the same tint, and gives the first back", () => {
    const one = quadruped(), two = quadruped();
    const plan = deform({ recipe: "giant", seed: 9, strength: 1 });
    one.lib.setDeform(plan);
    two.lib.setDeform(plan);
    const m = one.mesh.material as THREE.MeshStandardMaterial;
    expect(m).not.toBe(one.material);
    expect(m.color.r).toBeCloseTo(0.5 * Math.round(plan.skin.tint[0] * 100) / 100, 4);
    expect(m.color.b).toBeLessThan(0.3);
    // Another animal of the same plan on the same source material shares the clone only if the source is shared; here each has its own.
    expect(two.mesh.material).not.toBe(one.mesh.material);
    expect(one.mesh.frustumCulled).toBe(false);
    one.lib.setDeform(null);
    expect(one.mesh.material).toBe(one.material);
    expect(one.mesh.frustumCulled).toBe(true);
  });

  it("shares the tinted clone between animals that share a source material", () => {
    const a = quadruped(), b = quadruped();
    b.mesh.material = a.material;
    const plan = deform({ recipe: "giant", seed: 2, strength: 0.8 });
    a.lib.setDeform(plan);
    b.lib.setDeform(plan);
    expect(b.mesh.material).toBe(a.mesh.material);
  });
});

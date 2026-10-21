import { describe, expect, it } from "vitest";
import type { ClipDef, SkeletonDef } from "./format";
import { Locomotion, measureGait } from "./locomotion";
import { quatAxisAngle } from "./math";
import { PoseMixer, bindPose, blendPoses, createPose, poseWorld } from "./pose";
import { type Clip, Retargeter } from "./retarget";
import { fitSkeleton } from "./skeleton";

// A hip, one leg: pelvis at 1 m pointing up, thigh hanging down, foot below it.
const skelDef: SkeletonDef = {
  name: "leg",
  bones: [
    { name: "pelvis", parent: -1, head: { vertices: [0] }, tail: { vertices: [1] }, roll: 0 },
    { name: "thigh_l", parent: 0, head: { vertices: [2] }, tail: { vertices: [3] }, roll: 0 },
    { name: "foot_l", parent: 1, head: { vertices: [3] }, tail: { vertices: [4] }, roll: 0 },
  ],
};
const positions = new Float32Array([0, 1, 0, 0, 1.2, 0, 0.1, 1, 0, 0.1, 0.5, 0, 0.1, 0.05, 0.1]);
const skeleton = fitSkeleton(skelDef, positions);

/** A loop: the thigh swings ±amp about X (sin over the loop), the hips travel `travel` hip heights along +Z. */
function swingClip(name: string, frames: number, amp: number, travel: number): Clip {
  const bones = ["pelvis", "thigh_l"];
  const stride = bones.length * 4 + 3;
  const data = new Float32Array(frames * stride);
  for (let f = 0; f < frames; f++) {
    const u = f / (frames - 1);
    const o = f * stride;
    data.set([0, 0, 0, 1], o);
    data.set(quatAxisAngle([1, 0, 0], amp * Math.sin(2 * Math.PI * u)), o + 4);
    data.set([0, 0.01 * Math.sin(4 * Math.PI * u), travel * u], o + 8);
  }
  const def: ClipDef = { name, file: "", fps: 30, frameCount: frames, loop: true, bones, refDirs: [0, 1, 0, 0, -1, 0], rootBone: "pelvis", source: "test" };
  return { def, data };
}

const close = (a: ArrayLike<number>, b: ArrayLike<number>, digits = 5) => {
  for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(b[i], digits);
};

describe("pose buffers", () => {
  const walk = swingClip("walk", 31, 0.5, 1);

  it("samples into a buffer exactly as sample() does", () => {
    const r = new Retargeter(skeleton, walk);
    const pose = createPose(3);
    for (const t of [0, 0.13, 0.5, 0.77, 1.2]) {
      const ref = r.sample(t);
      r.sampleInto(t, pose);
      ref.rotations.forEach((q, i) => close(pose.rotations.subarray(i * 4, i * 4 + 4), q));
      close(pose.root, ref.rootPosition);
      expect(pose.rootIndex).toBe(ref.rootIndex);
    }
  });

  it("drift mode removes the travel but keeps the sway", () => {
    const r = new Retargeter(skeleton, walk, { inPlace: "drift" });
    const pose = createPose(3);
    r.sampleInto(0.5, pose);
    expect(pose.root[2]).toBeCloseTo(0, 5);
    r.sampleInto(0.125, pose); // a quarter loop: the sway's peak
    expect(pose.root[1] - 1).toBeCloseTo(0.01, 3);
  });

  it("blends on the short arc, whatever sign the quaternions carry", () => {
    const a = createPose(3), b = createPose(3), out = createPose(3);
    const q = quatAxisAngle([1, 0, 0], 1);
    b.rotations.set(q.map((v) => -v), 4); // same rotation, other hemisphere
    blendPoses(a, b, 0.5, out);
    const half = quatAxisAngle([1, 0, 0], 0.5);
    const got = Array.from(out.rotations.subarray(4, 8));
    const sg = Math.sign(got[3]);
    close(got.map((v) => v * sg), half, 4);

    const mixer = new PoseMixer(3);
    mixer.begin().add(a, 1).add(b, 1).end(out);
    const m = Array.from(out.rotations.subarray(4, 8));
    close(m.map((v) => v * Math.sign(m[3])), half, 4);
  });

  it("mixes with per-bone masks and keeps untouched bones", () => {
    const a = bindPose(skeleton), b = bindPose(skeleton), out = bindPose(skeleton);
    b.rotations.set(quatAxisAngle([1, 0, 0], 1), 4);
    const mixer = new PoseMixer(3);
    mixer.begin().add(b, 1, [0, 1, 0]).end(out, a);
    close(out.rotations.subarray(4, 8), quatAxisAngle([1, 0, 0], 1));
    close(out.rotations.subarray(0, 4), a.rotations.subarray(0, 4));
    expect(mixer.weight(0)).toBe(0);
  });

  it("forward kinematics puts the bind pose back on the bind heads", () => {
    const rot = new Float64Array(12), heads = new Float64Array(9);
    poseWorld(skeleton, bindPose(skeleton), rot, heads);
    skeleton.heads.forEach((h, i) => close(heads.subarray(i * 3, i * 3 + 3), h));
  });
});

describe("locomotion", () => {
  const walk = swingClip("walk", 31, 0.5, 1);
  const run = swingClip("run", 21, 0.9, 2);

  it("measures stride, speed and the left foot's strike", () => {
    const m = measureGait(skeleton, walk);
    expect(m.duration).toBeCloseTo(1, 5);
    expect(m.stride).toBeCloseTo(1, 4); // one hip height (1 m) per loop
    expect(m.speed).toBeCloseTo(1, 4);
    // The foot is furthest forward (+Z) when the thigh is turned by -amp: three quarters in.
    expect(m.strike).toBeCloseTo(0.75, 1);
  });

  it("measures in-place loops by how fast the planted foot moves back", () => {
    const m = measureGait(skeleton, swingClip("treadmill", 31, 0.5, 0));
    // Foot 0.5 m below the hip swinging ±0.5 rad once a second: ~0.5 · 0.5 · 2π m/s while low.
    expect(m.speed).toBeGreaterThan(1.3);
    expect(m.speed).toBeLessThan(1.6);
    expect(m.stride).toBeCloseTo(m.speed * m.duration, 6);
  });

  it("weights gaits by speed with plateaus and smooth hand-overs", () => {
    const loco = new Locomotion(skeleton, [{ clip: run, from: 3, to: 6 }, { clip: walk, from: 0, to: 1.5 }]);
    expect(loco.gaits[0].measure.stride).toBeCloseTo(1, 4); // sorted: walk first
    const w = (s: number) => Array.from(loco.weights(s));
    expect(w(0)).toEqual([1, 0]);
    expect(w(1.5)).toEqual([1, 0]);
    expect(w(2.25)[0]).toBeCloseTo(0.5, 5);
    expect(w(10)).toEqual([0, 1]);
    expect(loco.stride([0.5, 0.5])).toBeCloseTo(1.5, 3);
  });

  it("plays every gait from its own strike, so blended feet land together", () => {
    const loco = new Locomotion(skeleton, [{ clip: walk }, { clip: run }]);
    const pose = createPose(3), rot = new Float64Array(12), heads = new Float64Array(9);
    for (const w of [[1, 0], [0, 1], [0.5, 0.5]]) {
      loco.sample(0, w, pose);
      poseWorld(skeleton, pose, rot, heads);
      // Left foot ahead of the hips at phase 0.
      expect(heads[2 * 3 + 2] - heads[2]).toBeGreaterThan(0.2);
    }
  });
});

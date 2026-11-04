import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ClothSway } from "./sway";

const run = (s: ClothSway, frames: number, at: (t: number) => [THREE.Vector3, number], t0 = 0) => {
  for (let i = 0; i <= frames; i++) s.step(...at(t0 + i / 60), 1 / 60);
};

describe("cloth sway", () => {
  it("hangs still at rest", () => {
    const s = new ClothSway();
    run(s, 120, () => [new THREE.Vector3(0, 1, 0), 0]);
    expect(s.tilt.length()).toBe(0);
    expect(s.twist).toBe(0);
  });

  it("trails a little at a steady walk, swings past on stopping and settles", () => {
    const s = new ClothSway();
    run(s, 300, (t) => [new THREE.Vector3(0, 1, 1.4 * t), 0]); // 5 s at 1.4 m/s along +Z
    expect(s.tilt.y).toBeLessThan(-0.02); // leaning back
    expect(s.tilt.y).toBeGreaterThan(-0.2);
    const stop = 1.4 * 5;
    let most = 0;
    for (let i = 0; i < 60; i++) {
      s.step(new THREE.Vector3(0, 1, stop), 0, 1 / 60);
      most = Math.max(most, s.tilt.y);
    }
    expect(most).toBeGreaterThan(0.02); // the hem swings forward
    run(s, 600, () => [new THREE.Vector3(0, 1, stop), 0]);
    expect(s.tilt.length()).toBeLessThan(0.002);
  });

  it("lags a turn, across the ±π wrap too, and starts over after a teleport", () => {
    const s = new ClothSway();
    run(s, 60, () => [new THREE.Vector3(), 3]);
    run(s, 10, (t) => [new THREE.Vector3(), Math.atan2(Math.sin(3 + 6 * t), Math.cos(3 + 6 * t))]); // turning fast through ±π
    expect(s.twist).toBeLessThan(-0.05);
    expect(s.twist).toBeGreaterThanOrEqual(-ClothSway.MAX_TWIST);
    s.step(new THREE.Vector3(10, 0, 0), 0, 1 / 60);
    expect(s.twist).toBe(0);
    expect(s.tilt.length()).toBe(0);
  });
});

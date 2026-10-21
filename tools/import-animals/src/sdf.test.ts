import { describe, expect, it } from "vitest";
import { loft } from "./sdf";
import { type Rig, turnChain } from "./rig";

describe("loft", () => {
  const body = loft("test", [
    { at: [0, 0, 0], w: 0.1, up: 0.05, down: 0.1 },
    { at: [0, 0, 0.5], w: 0.1, up: 0.05, down: 0.1 },
    { at: [0, 0, 1], w: 0.1, up: 0.05, down: 0.1 },
  ]);
  it("is negative inside and zero on the section outline", () => {
    expect(body.distance([0, 0, 0.5])).toBeLessThan(0);
    expect(Math.abs(body.distance([0.1, 0, 0.5]))).toBeLessThan(1e-3);
    expect(Math.abs(body.distance([0, 0.05, 0.5]))).toBeLessThan(1e-3);
    expect(Math.abs(body.distance([0, -0.1, 0.5]))).toBeLessThan(1e-3);
  });
  it("is closed at the ends", () => {
    expect(body.distance([0, 0, 1.2])).toBeCloseTo(0.2, 3);
    expect(body.distance([0, 0, -0.1])).toBeCloseTo(0.1, 3);
  });
});

describe("turnChain", () => {
  it("turns a bone and its children about the root's head", () => {
    const rig: Rig = {
      bones: [
        { name: "a", parent: -1, head: [0, 0, 0], tail: [0, 0, -1], roll: 0, node: 0 },
        { name: "b", parent: 0, head: [0, 0, -1], tail: [0, 0, -2], roll: 0, node: 1 },
      ],
      index: new Map([["a", 0], ["b", 1]]),
    };
    // A tail pointing back (-z) turned -90° about +x hangs straight down.
    turnChain(rig, "a", [1, 0, 0], -Math.PI / 2);
    expect(rig.bones[1].tail[1]).toBeCloseTo(-2, 6);
    expect(rig.bones[1].tail[2]).toBeCloseTo(0, 6);
  });
});

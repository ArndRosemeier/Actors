import { describe, expect, it } from "vitest";
import type { Vec3 } from "@actors/core";
import { ph, placeBone, reachChain, stretchBone } from "./cat";
import type { Rig } from "./rig";

/** A straight chain of three bones along +Z. */
function chain(): Rig {
  const bones = [0, 1, 2].map((i) => ({ name: `B${i}`, parent: i - 1, head: [0, 0.1, i * 0.1] as Vec3, tail: [0, 0.1, (i + 1) * 0.1] as Vec3, roll: 0, node: i }));
  return { bones, index: new Map(bones.map((b, i) => [b.name, i])) };
}

describe("fitting the rig to the photo", () => {
  it("stretches a bone and carries its children", () => {
    const rig = chain();
    stretchBone(rig, "B0", 2);
    expect(rig.bones[0].tail[2]).toBeCloseTo(0.2);
    expect(rig.bones[1].head[2]).toBeCloseTo(0.2);
    expect(rig.bones[2].tail[2]).toBeCloseTo(0.4);
  });

  it("turns and stretches a chain so its end reaches a target", () => {
    const rig = chain();
    reachChain(rig, ["B0", "B1"], [0, 0.3, 0.1]);
    const end = rig.bones[1].tail;
    expect(end[1]).toBeCloseTo(0.3);
    expect(end[2]).toBeCloseTo(0.1);
    // The child below the chain stays attached.
    expect(rig.bones[2].head).toEqual(end);
  });

  it("places a bone between two points", () => {
    const rig = chain();
    placeBone(rig, "B2", [0, 0, 0], [0, -0.05, 0.05]);
    expect(rig.bones[2].head).toEqual([0, 0, 0]);
    expect(rig.bones[2].tail[1]).toBeCloseTo(-0.05);
    expect(rig.bones[2].tail[2]).toBeCloseTo(0.05);
  });

  it("maps photo pixels to metres (y up from the ground line, z forward)", () => {
    const a = ph(470, 449), b = ph(570, 349);
    expect(a).toEqual([0, 0, 0]);
    expect(b[1]).toBeCloseTo(0.12);
    expect(b[2]).toBeCloseTo(0.12);
  });
});

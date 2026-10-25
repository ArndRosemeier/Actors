import { describe, expect, it } from "vitest";
import { fistCurls } from "./hands";
import { mat3Apply, quatAxisAngle, type Vec3 } from "./math";
import { boneRotationFromRoll, type FittedSkeleton } from "./skeleton";

/** A flat right hand along +x, palm down (the thumb hangs below the fingers), fingers 3 joints of 3 cm. */
function hand(): FittedSkeleton {
  const names: string[] = [], heads: Vec3[] = [], tails: Vec3[] = [], parents: number[] = [];
  const bone = (name: string, parent: number, head: Vec3, tail: Vec3) => { names.push(name); parents.push(parent); heads.push(head); tails.push(tail); return names.length - 1; };
  const h = bone("hand_r", -1, [0, 0, 0], [0.08, 0, 0]);
  for (const [f, z] of [["index", 0.03], ["middle", 0.01], ["ring", -0.01], ["pinky", -0.03]] as const) {
    let p = h;
    for (let j = 0; j < 3; j++) p = bone(`${f}_0${j + 1}_r`, p, [0.08 + j * 0.03, 0, z], [0.11 + j * 0.03, 0, z]);
  }
  let p = h;
  for (let j = 0; j < 3; j++) p = bone(`thumb_0${j + 1}_r`, p, [0.02 + j * 0.02, -0.02, 0.04 + j * 0.01], [0.04 + j * 0.02, -0.02, 0.05 + j * 0.01]);
  const worldRotations = heads.map((a, i) => boneRotationFromRoll([tails[i][0] - a[0], tails[i][1] - a[1], tails[i][2] - a[2]], 0));
  return { names, parents: Int32Array.from(parents), heads, tails, worldRotations, localPositions: [], localRotations: [] };
}

describe("a fist", () => {
  it("curls every finger joint toward the palm (the thumb's side)", () => {
    const s = hand();
    const curls = fistCurls(s, "r");
    expect(curls).toHaveLength(15);
    for (const c of curls) {
      const name = s.names[c.bone];
      if (name.startsWith("thumb")) continue;
      // The bone's direction (+y in its own frame) turned by the curl, back in model space: it dips toward -y.
      const q = quatAxisAngle(c.axis, Math.min(c.angle, 1));
      const [x, y, z, w] = q;
      const local: Vec3 = [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)];
      expect(mat3Apply(s.worldRotations[c.bone], local)[1]).toBeLessThan(-0.3);
    }
  });

  it("is nothing on a skeleton without fingers", () => {
    expect(fistCurls(hand(), "l")).toEqual([]);
  });
});

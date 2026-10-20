import { describe, expect, it } from "vitest";
import { decodeClip, encodeClipI16 } from "@actors/core";
import { parseBvh } from "./bvh";
import { convertBvh, parseCmuIndex } from "./cmu";

const BVH = `HIERARCHY
ROOT Hips
{
  OFFSET 0 0 0
  CHANNELS 6 Xposition Yposition Zposition Zrotation Yrotation Xrotation
  JOINT LowerBack
  {
    OFFSET 0 0 0
    CHANNELS 3 Zrotation Yrotation Xrotation
    JOINT Spine
    {
      OFFSET 0 2 0
      CHANNELS 3 Zrotation Yrotation Xrotation
      End Site
      {
        OFFSET 0 2 0
      }
    }
  }
  JOINT LeftUpLeg
  {
    OFFSET 1 -1 0
    CHANNELS 3 Zrotation Yrotation Xrotation
    JOINT LeftLeg
    {
      OFFSET 0 -4 0
      CHANNELS 3 Zrotation Yrotation Xrotation
      JOINT LeftFoot
      {
        OFFSET 0 -4 0
        CHANNELS 3 Zrotation Yrotation Xrotation
        End Site
        {
          OFFSET 0 0 1
        }
      }
    }
  }
}
MOTION
Frames: 3
Frame Time: .5
0 9 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
0 9 2 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
0 9 4 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
`;

describe("CMU import", () => {
  it("reads the index, including subjects the text leaves out", () => {
    const e = parseCmuIndex("Subject #2 (various expressions)\n\n02_01\twalk\n02_03\trun/jog\n\nSubject #63 (golf)\n\n63_01\tswing\n");
    expect(e.find((x) => x.id === "02_03")).toMatchObject({ subject: 2, description: "run/jog", subjectTitle: "various expressions" });
    expect(e.filter((x) => x.subject === 63)).toHaveLength(30);
  });

  it("uses the offsets as rest pose, skips zero-length joints and keeps feet on the floor", () => {
    const c = convertBvh(parseBvh(BVH));
    const k = c.bones.indexOf("spine_01");
    // LowerBack has no length; its direction comes from the next joint (Spine), straight up.
    expect(c.refDirs.slice(k * 3, k * 3 + 3)).toEqual([0, 1, 0]);
    const t = c.bones.indexOf("thigh_l");
    expect(c.refDirs.slice(t * 3, t * 3 + 3).map((v) => +v.toFixed(3))).toEqual([0, -1, 0]);
    // 1 s at 2 fps -> 31 frames at 30 fps; hips at rest height above the floor -> root y 0; moved 4 units in z / hip height 9.
    expect(c.frames).toBe(31);
    const stride = c.bones.length * 4 + 3;
    const last = (c.frames - 1) * stride + c.bones.length * 4;
    expect(c.data[last + 1]).toBeCloseTo(0, 5);
    expect(c.data[last + 2]).toBeCloseTo(4 / 9, 5);
    // Round trip through the compact encoding.
    const def = { bones: c.bones, frameCount: c.frames, encoding: "i16" } as Parameters<typeof decodeClip>[0];
    const back = decodeClip(def, encodeClipI16(c.bones.length, c.frames, c.data).buffer as ArrayBuffer);
    back.forEach((v, i) => expect(v).toBeCloseTo(c.data[i], 4));
  });
});

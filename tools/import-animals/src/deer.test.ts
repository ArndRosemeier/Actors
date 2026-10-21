import { describe, expect, it } from "vitest";
import { parseGlb } from "../../import-makehuman/src/gltf";
import { aimBone } from "./deer";
import { glbFromGltf } from "./quaternius";
import type { Rig } from "./rig";

describe("glbFromGltf", () => {
  it("packs a glTF with an embedded buffer into a GLB the reader understands", () => {
    // One node with an animation channel: 2 key times and 2 translations.
    const data = new Float32Array([0, 1, 0, 0, 0, 0, 2, 0]);
    const uri = `data:application/octet-stream;base64,${Buffer.from(data.buffer).toString("base64")}`;
    const gltf = {
      asset: { version: "2.0" },
      nodes: [{ name: "Bone", translation: [0, 1, 0] }],
      skins: [{ joints: [0] }],
      buffers: [{ uri, byteLength: data.byteLength }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 8 }, { buffer: 0, byteOffset: 8, byteLength: 24 }],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 2, type: "SCALAR" },
        { bufferView: 1, componentType: 5126, count: 2, type: "VEC3" },
      ],
      animations: [{ name: "Move", samplers: [{ input: 0, output: 1 }], channels: [{ sampler: 0, target: { node: 0, path: "translation" } }] }],
    };
    const g = parseGlb(glbFromGltf(JSON.stringify(gltf)));
    expect(g.nodes[0].name).toBe("Bone");
    expect(g.joints).toEqual([0]);
    expect(g.animations[0].duration).toBe(1);
    expect(Array.from(g.animations[0].channels[0].values)).toEqual([0, 0, 0, 0, 2, 0]);
  });
});

describe("aimBone", () => {
  it("turns a bone, sets its length and carries its children along", () => {
    const rig: Rig = {
      bones: [
        { name: "a", parent: -1, head: [0, 0, 0], tail: [0, 0, -1], roll: 0, node: 0 },
        { name: "b", parent: 0, head: [0, 0, -1], tail: [0, 0, -2], roll: 0, node: 1 },
      ],
      index: new Map([["a", 0], ["b", 1]]),
    };
    aimBone(rig, "a", [0, -1, 0], 0.5);
    expect(rig.bones[0].tail[1]).toBeCloseTo(-0.5, 6);
    expect(rig.bones[0].tail[2]).toBeCloseTo(0, 6);
    // The child keeps hanging from the tail and turned with it.
    expect(rig.bones[1].head[1]).toBeCloseTo(-0.5, 6);
    expect(rig.bones[1].tail[1]).toBeCloseTo(-1.5, 6);
    expect(rig.bones[1].tail[2]).toBeCloseTo(0, 6);
  });
});

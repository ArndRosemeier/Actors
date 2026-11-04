import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { BASE_SPACE, type FaceRig } from "@actors/core";
import { addMorphAttributes, morphAttribute } from "./morphs";
import { FACE_SLOT, createFaceRigUniforms, faceSlotsFor, patchFaceRig, releaseFaceRigTexture, setFaceRigTexture, setFaceSlots } from "./faceRig";

const rig: FaceRig = { units: ["a", "b"], slots: new Map([[BASE_SPACE, new Uint32Array([0, 1, 0, 2])]]), slotCount: 2, width: 4, height: 2, data: new Uint16Array(32) };

describe("face rig slots", () => {
  it("map drawn vertices to their source vertex's slot", () => {
    expect([...faceSlotsFor(rig, BASE_SPACE, [3, 1, 1, 0])!]).toEqual([2, 1, 1, 0]);
    expect(faceSlotsFor(rig, BASE_SPACE, [0, 2])).toBeNull();
    expect(faceSlotsFor(rig, "body-hi", [0])).toBeNull();
    // Parts mark unanchored vertices with 0xffffffff.
    expect([...faceSlotsFor(rig, BASE_SPACE, new Uint32Array([0xffffffff, 3]))!]).toEqual([0, 2]);
  });

  it("join the interleaved face morph buffer, keeping the morphs", () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));
    addMorphAttributes(g, 3, 2, true);
    g.getAttribute(morphAttribute(1, true)).setXYZ(2, 4, 5, 6);
    expect(setFaceSlots(g, new Float32Array([0, 1, 2]))).toBe(true);
    const slot = g.getAttribute(FACE_SLOT) as THREE.InterleavedBufferAttribute;
    expect(slot.isInterleavedBufferAttribute).toBe(true);
    expect(slot.data).toBe((g.getAttribute(morphAttribute(0)) as THREE.InterleavedBufferAttribute).data);
    expect([slot.getX(0), slot.getX(1), slot.getX(2)]).toEqual([0, 1, 2]);
    const n = g.getAttribute(morphAttribute(1, true));
    expect([n.getX(2), n.getY(2), n.getZ(2)]).toEqual([4, 5, 6]);
    // Second time: written in place, layout unchanged; null clears.
    expect(setFaceSlots(g, null)).toBe(false);
    expect(slot.getX(2)).toBe(0);
  });

  it("get their own attribute without interleaved morphs", () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    expect(setFaceSlots(g, null)).toBe(false);
    expect(g.getAttribute(FACE_SLOT)).toBeUndefined();
    expect(setFaceSlots(g, new Float32Array([1, 0]))).toBe(true);
    expect(g.getAttribute(FACE_SLOT).getX(0)).toBe(1);
  });
});

describe("face rig uniforms", () => {
  it("keep one texture object and switch on and off", () => {
    const u = createFaceRigUniforms();
    const tex = u.uFaceRig.value;
    setFaceRigTexture(u, rig);
    expect(u.uFaceRig.value).toBe(tex);
    expect(tex.image.width).toBe(4);
    expect(u.uFaceInfo.value.toArray()).toEqual([2, 4, 1, 0]);
    setFaceRigTexture(u, null);
    expect(u.uFaceInfo.value.z).toBe(0);
    expect(tex.image.width).toBe(1);
  });

  it("patch a three vertex shader before skinning", () => {
    const shader = { vertexShader: THREE.ShaderLib.physical.vertexShader };
    patchFaceRig(shader);
    const vs = shader.vertexShader;
    expect(vs).toContain("uniform highp sampler2D uFaceRig;");
    expect(vs.indexOf("objectNormal += actorFaceN")).toBeGreaterThan(vs.indexOf("#include <morphnormal_vertex>"));
    expect(vs.indexOf("transformed += actorFaceP")).toBeLessThan(vs.indexOf("#include <skinning_vertex>"));
    expect(vs.indexOf("actorFaceRig( actorFaceP, actorFaceN )")).toBeGreaterThan(vs.indexOf("void main()"));
  });
});

describe("face rig CPU copy", () => {
  it("is uploaded and dropped, only with a renderer that can upload", () => {
    const u = createFaceRigUniforms();
    setFaceRigTexture(u, rig);
    expect(releaseFaceRigTexture(u, null)).toBe(false);
    expect(u.uFaceRig.value.image.data).not.toBeNull();
    const uploaded: THREE.Texture[] = [];
    expect(releaseFaceRigTexture(u, { initTexture: (t: THREE.Texture) => uploaded.push(t) })).toBe(true);
    expect(uploaded).toEqual([u.uFaceRig.value]);
    expect(u.uFaceRig.value.image.data).toBeNull();
    expect(u.uFaceRig.value.image.width).toBe(4);
    // Nothing left to drop, and a failing upload keeps the data.
    expect(releaseFaceRigTexture(u, { initTexture: () => undefined })).toBe(false);
    setFaceRigTexture(u, rig);
    expect(releaseFaceRigTexture(u, { initTexture: () => { throw new Error("not ready"); } })).toBe(false);
    expect(u.uFaceRig.value.image.data).not.toBeNull();
  });
});


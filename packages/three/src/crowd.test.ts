import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { ActorRuntime, type ActorPackManifest } from "@actors/core";
import { RootSkeleton, ThreeActor } from "./index";

/**
 * A quad body on four base vertices with a full and a merging crowd level, a garment, textured
 * hair, eyes and teeth (one-triangle proxies or base meshes), on a two-bone rig.
 */
async function crowdPack(limbs: string[] = []): Promise<ActorRuntime> {
  const parts: ArrayBufferView[] = [];
  let offset = 0;
  const put = <T extends "f32" | "u32">(type: T, values: number[]) => {
    const a = type === "f32" ? new Float32Array(values) : new Uint32Array(values);
    const ref = { offset, count: values.length, type };
    parts.push(a);
    offset += a.byteLength;
    return ref;
  };
  const basePositions = put("f32", [0, 0, 0, 1, 0, 0, 1, 1.8, 0, 0, 1.8, 0]);
  const proxy = (name: string) => ({
    name,
    vertexCount: 3,
    refs: put("u32", [0, 1, 2, 0, 1, 2, 0, 1, 2]),
    weights: put("f32", [1, 0, 0, 0, 1, 0, 0, 0, 1]),
    offsets: put("f32", [0, 0, 0.01, 0, 0, 0.01, 0, 0, 0.01]),
    scaleRefs: [[0, 1, 1], [0, 3, 1], [0, 1, 1]] as [[number, number, number], [number, number, number], [number, number, number]],
  });
  const tri = () => ({ baseIndex: put("u32", [0, 1, 2]), uv: put("f32", [0, 0, 1, 0, 1, 1]), indices: put("u32", [0, 1, 2]) });
  const onProxy = (name: string) => ({ name, source: { kind: "proxy" as const, proxy: name }, ...tri() });
  const manifest: ActorPackManifest = {
    format: "actors-pack", version: 1, id: "crowd", species: "test", units: "meters", source: { name: "test", license: "CC0", url: "" },
    blob: "base.bin", vertexCount: 4, basePositions, targets: [],
    proxies: [proxy("shirt"), proxy("cap"), proxy("hair"), proxy("eyes")],
    meshes: [
      { name: "body", source: { kind: "base" }, role: "body", material: { kind: "skin" }, baseIndex: put("u32", [0, 1, 2, 3]), uv: put("f32", [0, 0, 1, 0, 1, 1, 0, 1]), indices: put("u32", [0, 1, 2, 0, 2, 3]) },
      { ...onProxy("shirt"), role: "garment", optional: true, material: { kind: "cloth", color: [0.5, 0.5, 0.5] } },
      { ...onProxy("cap"), role: "garment", optional: true, material: { kind: "cloth", color: [0.2, 0.2, 0.2] } },
      { ...onProxy("hair"), role: "hair", slot: "hair", optional: true, material: { kind: "hair", color: [0.3, 0.2, 0.1] }, textures: { color: "hair.png" } },
      { ...onProxy("eyes"), role: "eyes", lods: [0], material: { kind: "eye", color: [1, 1, 1] } },
      { name: "teeth", source: { kind: "base" }, role: "bodypart", lods: [0], material: { kind: "teeth", color: [1, 1, 1] }, ...tri() },
    ],
    lods: [{ name: "Full", distance: 0 }, { name: "Crowd", distance: 20, merge: true }],
    skeleton: { name: "tiny", bones: [
      { name: "root", parent: -1, head: { vertices: [0, 1] }, tail: { vertices: [0, 1, 2, 3] }, roll: 0 },
      { name: "top", parent: 0, head: { vertices: [0, 1, 2, 3] }, tail: { vertices: [2, 3] }, roll: 0 },
      ...limbs.map((name) => ({ name, parent: 0, head: { vertices: [0, 1] }, tail: { vertices: [1] }, roll: 0 })),
    ] },
    skin: { joints: put("u32", [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), weights: put("f32", [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]) },
  };
  const blob = new Uint8Array(offset);
  let at = 0;
  for (const p of parts) {
    blob.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), at);
    at += p.byteLength;
  }
  const files: Record<string, ArrayBuffer> = { "/crowd/manifest.json": new TextEncoder().encode(JSON.stringify(manifest)).buffer as ArrayBuffer, "/crowd/base.bin": blob.buffer };
  return ActorRuntime.load("/crowd/manifest.json", async (url) => files[url]);
}

/** An actor wearing the shirt and the hair, shaped (textures are stubbed: no images in node). */
async function dressed(): Promise<{ rt: ActorRuntime; actor: ThreeActor }> {
  const rt = await crowdPack();
  const hairMap = new THREE.Texture();
  vi.spyOn(ThreeActor.prototype, "texture").mockReturnValue(hairMap);
  const actor = new ThreeActor(rt);
  actor.setVisible("shirt", true);
  actor.setVisible("hair", true);
  actor.applyShape(rt.evaluateLoaded(new Map(), undefined, undefined, actor.neededMeshes()));
  actor.update(0);
  return { rt, actor };
}

const drawn = (actor: ThreeActor) => {
  const out: string[] = [];
  actor.object.traverse((o) => (o as THREE.Mesh).isMesh && o.visible && out.push(o.name));
  return out.sort();
};

describe("crowd level", () => {
  it("draws body, garments and hair as one mesh, the hair cut by its texture and two-sided", async () => {
    const { actor } = await dressed();
    expect(drawn(actor)).toEqual(["body", "eyes", "hair", "shirt", "teeth"]);
    actor.setLod(1);
    actor.update(0);
    expect(drawn(actor)).toEqual(["crowd", "eyes"]);
    const crowd = actor.crowdMesh()!;
    expect(crowd.parts.map((p) => p.name)).toEqual(["body", "shirt", "hair"]);
    const hairAttr = crowd.mesh.geometry.getAttribute("crowdHair");
    const hair = crowd.parts.find((p) => p.name === "hair")!;
    for (let i = 0; i < hairAttr.count; i++) expect(hairAttr.getX(i)).toBe(i >= hair.offset && i < hair.offset + hair.count ? 1 : 0);
    expect(actor.crowdHairMaps[0]).toBeInstanceOf(THREE.Texture);
    // Body 2 triangles, shirt 1, hair 1 twice (the second turned round).
    const index = crowd.mesh.geometry.index!.array;
    expect(index.length).toBe(3 * 5);
    expect([...index.slice(12)]).toEqual([index[9], index[11], index[10]]);
    actor.crowdHair = false;
    actor.update(0);
    expect(drawn(actor)).toEqual(["crowd", "eyes", "hair"]);
    expect(actor.crowdMesh()!.parts.map((p) => p.name)).toEqual(["body", "shirt"]);
  });

  it("keeps merged parts hidden when a garment is shown and hidden again before the next frame", async () => {
    const { actor } = await dressed();
    actor.setLod(1);
    actor.update(0);
    actor.setVisible("cap", true);
    actor.setVisible("cap", false);
    actor.update(0);
    expect(drawn(actor)).toEqual(["crowd", "eyes"]);
  });

  it("draws the eyes, which the pack leaves to the full level, unless crowdEyes is off (the crowd body has open sockets)", async () => {
    const { actor } = await dressed();
    actor.setLod(1);
    actor.update(0);
    expect(drawn(actor)).toContain("eyes");
    expect(drawn(actor)).not.toContain("teeth");
    actor.crowdEyes = false;
    actor.update(0);
    expect(drawn(actor)).toEqual(["crowd"]);
    actor.crowdEyes = true;
    actor.setLod(0);
    actor.update(0);
    expect(drawn(actor)).toEqual(["body", "eyes", "hair", "shirt", "teeth"]);
  });
});

describe("shadows of small parts", () => {
  it("lets eyes and teeth cast none unless asked", async () => {
    const { actor } = await dressed();
    expect(actor.meshes.get("eyes")!.castShadow).toBe(false);
    expect(actor.meshes.get("teeth")!.castShadow).toBe(false);
    expect(actor.meshes.get("body")!.castShadow).toBe(true);
    actor.smallPartShadows = true;
    expect(actor.meshes.get("eyes")!.castShadow).toBe(true);
  });
});

describe("animation rate", () => {
  it("animates every 2nd update at the crowd level and every 4th off screen, gathering the time", async () => {
    const { actor } = await dressed();
    const mixer = vi.spyOn(actor.mixer, "update");
    const skeleton = actor.skeleton as RootSkeleton;
    for (let i = 0; i < 4; i++) actor.update(0.01);
    expect(mixer).toHaveBeenCalledTimes(4);
    actor.setLod(1);
    mixer.mockClear();
    for (let i = 0; i < 4; i++) actor.update(0.01);
    expect(mixer.mock.calls.map((c) => +c[0].toFixed(3))).toEqual([0.01, 0.02]);
    // The last of those four only gathered its time: the bone matrices stay as they were.
    expect(skeleton.frozen).toBe(true);
    actor.update(0.01);
    expect(skeleton.frozen).toBe(false);
    actor.setOnScreen(false);
    mixer.mockClear();
    for (let i = 0; i < 8; i++) actor.update(0.01);
    expect(mixer).toHaveBeenCalledTimes(2);
    actor.animationSteps = [];
    actor.offscreenStep = 1;
    mixer.mockClear();
    for (let i = 0; i < 3; i++) actor.update(0.01);
    expect(mixer).toHaveBeenCalledTimes(3);
  });
});

describe("frustum culling", () => {
  it("culls with a sphere round the body, and not with root motion", async () => {
    const { actor } = await dressed();
    const body = actor.meshes.get("body")!;
    expect(body.frustumCulled).toBe(true);
    const s = actor.bounds();
    expect(s.containsPoint(new THREE.Vector3(0.5, 0.9, 0))).toBe(true);
    expect(s.radius).toBeGreaterThan(1.5);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0.5, 1, 5);
    camera.updateMatrixWorld();
    expect(actor.inView(camera)).toBe(true);
    camera.lookAt(0.5, 1, 20);
    camera.updateMatrixWorld();
    expect(actor.inView(camera)).toBe(false);
    actor.inPlace = false;
    actor.update(0);
    expect(body.frustumCulled).toBe(false);
  });
});

describe("binding", () => {
  it("binds every bone in the actor's own frame, also detached from a scene far from the origin (MasterWorld's stretched crowd bodies)", async () => {
    const rt = await crowdPack(["head", "arm"]);
    vi.spyOn(ThreeActor.prototype, "texture").mockReturnValue(new THREE.Texture());
    // As MasterWorld dresses a person: the actor in a place, the place in a scene 41 km out, then taken off the scene.
    const scene = new THREE.Scene();
    scene.position.set(-41000, 0, 30000);
    const place = new THREE.Group();
    place.position.set(5, 0, 2);
    scene.add(place);
    const actor = new ThreeActor(rt);
    place.add(actor.object);
    actor.setVisible("shirt", true);
    actor.applyShape(rt.evaluateLoaded(new Map(), undefined, undefined, actor.neededMeshes()));
    expect(actor.enableEyes()).toBe(true); // the eyes' bones hang under the head: binding reads its chain's world matrices
    scene.updateMatrixWorld(true);
    place.removeFromParent(); // its world matrix still holds the scene's offset
    actor.applyShape(rt.evaluateLoaded(new Map(), undefined, undefined, actor.neededMeshes()));
    // In the bind pose every bone's matrix, relative to the root, undoes its inverse: the skin stays where it was made.
    scene.add(place);
    scene.updateMatrixWorld(true);
    const skeleton = actor.skeleton as RootSkeleton;
    skeleton.update();
    const identity = new THREE.Matrix4().toArray();
    actor.bones.forEach((bone, i) => {
      const m = Array.from(skeleton.boneMatrices!.subarray(i * 16, i * 16 + 16));
      m.forEach((v, k) => expect(v, `${bone.name}[${k}]`).toBeCloseTo(identity[k], 3));
    });
  });
});

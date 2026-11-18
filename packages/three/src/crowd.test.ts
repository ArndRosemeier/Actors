import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { ActorRuntime, type ActorPackManifest, type AxisClip } from "@actors/core";
import { CROWD_ROW, CROWD_SLOT, CROWD_TEXELS, CrowdFigures, type CrowdKind, type CrowdMan, RootSkeleton, ThreeActor, crowdPieces } from "./index";

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

describe("garments drawn beside the crowd mesh", () => {
  it("drop their layer's polygon offset there, so the merged garments over them still show", async () => {
    const { rt, actor } = await dressed();
    // A skirt-skinned cap (leg colliders) stays its own mesh at the crowd level.
    rt.manifest.proxies.find((p) => p.name === "cap")!.legBlend = { remap: {}, pairs: [], hip: "root", hipShare: 0.5 };
    actor.setVisible("cap", true);
    actor.applyShape(rt.evaluateLoaded(new Map(), undefined, undefined, actor.neededMeshes()));
    actor.update(0);
    const cap = actor.meshes.get("cap")!.material as THREE.Material;
    expect(cap.polygonOffsetUnits).toBeLessThan(0);
    actor.setLod(1);
    actor.update(0);
    expect(drawn(actor)).toEqual(["cap", "crowd", "eyes"]);
    expect(cap.polygonOffsetUnits).toBe(0);
    actor.setLod(0);
    expect(cap.polygonOffsetUnits).toBeLessThan(0);
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

/** A clip bending the top bone forward and back over a second. */
const bend: AxisClip = { name: "bend", duration: 1, tracks: [{ bone: "top", axis: [1, 0, 0], keys: [{ t: 0, deg: 0 }, { t: 0.5, deg: 50 }, { t: 1, deg: 0 }] }] };
const sway: AxisClip = { name: "sway", duration: 2, tracks: [{ bone: "top", axis: [0, 0, 1], keys: [{ t: 0, deg: -20 }, { t: 1, deg: 20 }, { t: 2, deg: -20 }] }] };

/** Crowd figures baked from the dressed actor: one build, one kind with the hair as an option and the shirt recoloured per man. */
async function figures(): Promise<{ actor: ThreeActor; figures: CrowdFigures; kind: CrowdKind }> {
  const { actor } = await dressed();
  actor.setLod(1);
  actor.update(0);
  const f = new CrowdFigures({ material: () => new THREE.MeshBasicMaterial(), capacity: 8, liveSlots: 2 });
  f.addBuild("b", actor, { bend, sway });
  const kind = f.addKind("k", "b", crowdPieces(actor), { options: ["hair"], tints: [["shirt"]], max: 4 });
  return { actor, figures: f, kind };
}

/** The material's vertex stage on the CPU: vertex `v` of a man, skinned from his row and the atlas, then placed. */
function figureVertex(figures: CrowdFigures, man: CrowdMan, v: number): THREE.Vector3 {
  const rows = figures.instances.image.data as unknown as Float32Array;
  const atlas = figures.atlas.image.data as unknown as Float32Array;
  const g = man.kind.mesh.geometry;
  const o = (man.kind.first + man.row) * CROWD_TEXELS * 4;
  const row = (k: number) => rows.subarray(o + k * 4, o + k * 4 + 4);
  const [a0, a1, ta, wB] = row(CROWD_ROW.poseA), [b0, b1, tb] = row(CROWD_ROW.poseB);
  const frames: [number, number][] = [[a0, (1 - ta) * (1 - wB)], [a1, ta * (1 - wB)], [b0, (1 - tb) * wB], [b1, tb * wB]];
  const p = new THREE.Vector3().fromBufferAttribute(g.getAttribute("position") as THREE.BufferAttribute, v);
  const j = g.getAttribute("skinIndex"), w = g.getAttribute("skinWeight");
  const out = new THREE.Vector3();
  for (let k = 0; k < 4; k++) {
    const wk = w.getComponent(v, k);
    if (!wk) continue;
    const m = new Float32Array(12);
    for (const [f, wf] of frames) if (wf) for (let i = 0; i < 12; i++) m[i] += wf * atlas[(Math.round(f) * figures.atlasBones + j.getComponent(v, k)) * 12 + i];
    out.x += wk * (m[0] * p.x + m[1] * p.y + m[2] * p.z + m[3]);
    out.y += wk * (m[4] * p.x + m[5] * p.y + m[6] * p.z + m[7]);
    out.z += wk * (m[8] * p.x + m[9] * p.y + m[10] * p.z + m[11]);
  }
  const [r0, r1, r2] = [row(0), row(1), row(2)];
  return new THREE.Vector3(r0[0] * out.x + r0[1] * out.y + r0[2] * out.z + r0[3], r1[0] * out.x + r1[1] * out.y + r1[2] * out.z + r1[3], r2[0] * out.x + r2[1] * out.y + r2[2] * out.z + r2[3]);
}

/** The full character's crowd mesh vertex `v` of `part`, skinned as drawn now, in the actor's space with its feet at 0. */
function actorVertex(actor: ThreeActor, part: string, v: number): THREE.Vector3 {
  const crowd = actor.crowdMesh()!;
  const at = crowd.parts.find((p) => p.name === part)!.offset + v;
  actor.object.updateMatrixWorld(true);
  actor.skeleton!.update();
  return crowd.mesh.getVertexPosition(at, new THREE.Vector3()).add(new THREE.Vector3(0, actor.groundOffset(), 0));
}

describe("crowd figures", () => {
  it("stand in the full character's pose when both play the same clip at the same time", async () => {
    const { actor, figures: f, kind } = await figures();
    const man = f.add(kind, { show: ["hair"] });
    man.matrix.makeTranslation(3, 0, -1);
    f.play(man, "bend", { time: 10 / 30 });
    f.update(0);
    actor.animationSteps = [];
    actor.play(bend);
    actor.currentAction!.time = 10 / 30;
    actor.mixer.update(0);
    const pieces = crowdPieces(actor);
    let first = 0;
    for (const p of pieces.filter((p) => p.role !== "eyes")) {
      for (let i = 0; i < p.positions.length / 3; i++) {
        const fig = figureVertex(f, man, first + i).sub(new THREE.Vector3(3, 0, -1));
        const full = actorVertex(actor, p.name, i);
        expect(fig.distanceTo(full), `${p.name} ${i}`).toBeLessThan(1e-5);
      }
      first += p.positions.length / 3;
    }
    // Between baked frames the GPU blends the two around it.
    f.seek(man, 10.5 / 30);
    f.update(0);
    const o = (kind.first + man.row) * CROWD_TEXELS * 4 + CROWD_ROW.poseA * 4;
    const rows = f.instances.image.data as unknown as Float32Array;
    expect(rows[o + 1] - rows[o]).toBe(1);
    expect(rows[o + 2]).toBeCloseTo(0.5, 5);
  });

  it("loop clips, cross-fade between them and fade the man for a hand-over", async () => {
    const { figures: f, kind } = await figures();
    const man = f.add(kind);
    f.play(man, "bend");
    f.update(1.25); // a one-second clip: a quarter in again
    expect(man.playing!.time).toBeCloseTo(1.25);
    const rows = f.instances.image.data as unknown as Float32Array;
    const o = (kind.first + man.row) * CROWD_TEXELS * 4;
    const bendFirst = kind.build.clips.get("bend")!.first;
    expect(rows[o + CROWD_ROW.poseA * 4]).toBe(bendFirst + Math.floor(0.25 * 30));
    // Into the two-second sway at the same share of its loop, over half a second.
    f.play(man, "sway", { fade: 0.5 });
    expect(man.playing!.time).toBeCloseTo(0.5);
    f.update(0.25);
    expect(rows[o + CROWD_ROW.poseA * 4 + 3]).toBeCloseTo(0.5); // the bend still weighs half
    expect(rows[o + CROWD_ROW.poseB * 4]).toBe(bendFirst + Math.floor(0.5 * 30));
    f.update(0.3);
    expect(rows[o + CROWD_ROW.poseA * 4 + 3]).toBe(0);
    f.fade(man, 0, 0.5);
    f.update(0.25);
    expect(rows[o + CROWD_ROW.poseB * 4 + 3]).toBeCloseTo(0.5);
    f.update(1);
    expect(man.shown).toBe(0);
    expect(f.clipsOf(kind)).toEqual(["bend", "sway"]);
  });

  it("give each man his colours and pieces: skin, hair and garment groups by slot, options by bit", async () => {
    const { figures: f, kind } = await figures();
    const g = kind.mesh.geometry;
    const info = g.getAttribute("crowdFigure");
    const slots = new Set<number>(), parts = new Set<number>();
    for (let i = 0; i < info.count; i++) {
      slots.add(info.getX(i));
      parts.add(info.getY(i));
    }
    expect([...slots].sort()).toEqual([CROWD_SLOT.baked, CROWD_SLOT.skin, CROWD_SLOT.hair, CROWD_SLOT.tint].sort()); // eyes keep their colour
    expect([...parts].sort()).toEqual([0, 1]);
    expect(kind.options).toEqual(["hair"]);
    expect(kind.hairMaps.length).toBe(1);
    f.add(kind);
    const b = f.add(kind, { skin: "#ff0000", tints: ["#808080"], show: ["hair"] });
    f.update(0);
    const rows = f.instances.image.data as unknown as Float32Array;
    const o = (kind.first + b.row) * CROWD_TEXELS * 4;
    expect(rows[o + CROWD_ROW.skin * 4]).toBe(1);
    expect(rows[o + CROWD_ROW.skin * 4 + 3]).toBe(1); // the hair's bit
    expect(rows[o + CROWD_ROW.tints * 4]).toBeCloseTo(0.2158, 3); // sRGB #80 as linear
    expect(rows[(kind.first) * CROWD_TEXELS * 4 + CROWD_ROW.skin * 4 + 3]).toBe(0);
    expect((g as THREE.InstancedBufferGeometry).instanceCount).toBe(2);
  });

  it("take a pose from outside through a live row: a full character's skeleton gives its own pose", async () => {
    const { actor, figures: f, kind } = await figures();
    const man = f.add(kind);
    actor.animationSteps = [];
    actor.play(bend);
    actor.currentAction!.time = 0.4;
    actor.mixer.update(0);
    f.pose(man, actor);
    expect(man.playing).toBeNull();
    f.update(0);
    const twin = f.add(kind);
    f.play(twin, "bend", { time: 0.4 });
    f.update(0);
    const n = kind.mesh.geometry.getAttribute("position").count;
    for (let v = 0; v < n; v++) expect(figureVertex(f, man, v).distanceTo(figureVertex(f, twin, v))).toBeLessThan(1e-5);
    // Back to a clip with a fade: the live row is kept until the fade is over, then freed.
    f.play(man, "sway", { fade: 0.2, time: 0 });
    expect(man.live).toBe(0);
    f.update(0.3);
    expect(man.live).toBe(-1);
    const a = f.add(kind), b = f.add(kind);
    f.pose(a, actor);
    f.pose(b, actor);
    expect(() => f.pose(man, actor)).toThrow(/live slots/);
  });

  it("keep each kind's men in its own rows, the last taking a removed man's row", async () => {
    const { figures: f, kind } = await figures();
    const men = [f.add(kind), f.add(kind), f.add(kind)];
    f.remove(men[0]);
    expect(men[2].row).toBe(0);
    expect(kind.men).toEqual([men[2], men[1]]);
    f.add(kind);
    f.add(kind);
    expect(() => f.add(kind)).toThrow(/full/);
    expect(() => f.addKind("more", "b", [], { max: 5 })).toThrow(/rows/);
    const mem = f.memory();
    expect(mem.geometry).toBe(kind.bytes);
    expect(mem.instances).toBe(8 * CROWD_TEXELS * 16);
  });
});

describe("levels an actor is kept to", () => {
  it("makes no meshes of other levels and picks the nearest allowed level", async () => {
    const rt = await crowdPack();
    vi.spyOn(ThreeActor.prototype, "texture").mockReturnValue(new THREE.Texture());
    const far = new ThreeActor(rt, undefined, { levels: [1] });
    far.setVisible("shirt", true);
    far.applyShape(rt.evaluateLoaded(new Map(), undefined, undefined, far.neededMeshes()));
    far.update(0);
    expect(far.lod).toBe(1);
    expect([...far.meshes.keys()]).not.toContain("teeth"); // drawn at full detail only
    far.setLod(0);
    expect(far.lod).toBe(1);
    expect(drawn(far)).toEqual(["crowd", "eyes"]);
    const near = new ThreeActor(rt, undefined, { levels: [0] });
    near.applyShape(rt.evaluateLoaded(new Map(), undefined, undefined, near.neededMeshes()));
    near.setLod(1);
    near.update(0);
    expect(near.lod).toBe(0);
    expect(near.crowdMesh()).toBeNull();
  });

  it("merges skirt-skinned garments into the crowd mesh with crowdSkirts", async () => {
    const { rt, actor } = await dressed();
    rt.manifest.proxies.find((p) => p.name === "cap")!.legBlend = { remap: {}, pairs: [], hip: "root", hipShare: 0.5 };
    actor.setVisible("cap", true);
    actor.applyShape(rt.evaluateLoaded(new Map(), undefined, undefined, actor.neededMeshes()));
    actor.setLod(1);
    actor.update(0);
    expect(actor.crowdMesh()!.parts.map((p) => p.name)).not.toContain("cap");
    actor.crowdSkirts = true;
    actor.update(0);
    expect(actor.crowdMesh()!.parts.map((p) => p.name)).toContain("cap");
    expect(drawn(actor)).toEqual(["crowd", "eyes"]);
  });
});

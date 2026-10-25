import { describe, expect, it } from "vitest";
import { ActorRuntime, type ActorPackManifest } from "@actors/core";
import { ThreeActor } from "./index";

/**
 * A tiny pack: a quad body on four base vertices and two optional garments (a "shirt" and a
 * "hat"), each a one-triangle proxy bound to the body.
 */
async function tinyPack(rigged = false): Promise<ActorRuntime> {
  const parts: ArrayBufferView[] = [];
  let offset = 0;
  const put = <T extends "f32" | "u32">(type: T, values: number[]) => {
    const a = type === "f32" ? new Float32Array(values) : new Uint32Array(values);
    const ref = { offset, count: values.length, type };
    parts.push(a);
    offset += a.byteLength;
    return ref;
  };
  const basePositions = put("f32", [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
  const body = { baseIndex: put("u32", [0, 1, 2, 3]), uv: put("f32", [0, 0, 1, 0, 1, 1, 0, 1]), indices: put("u32", [0, 1, 2, 0, 2, 3]) };
  const proxy = (name: string) => ({
    name,
    vertexCount: 3,
    refs: put("u32", [0, 1, 2, 0, 1, 2, 0, 1, 2]),
    weights: put("f32", [1, 0, 0, 0, 1, 0, 0, 0, 1]),
    offsets: put("f32", [0, 0, 0.01, 0, 0, 0.01, 0, 0, 0.01]),
    scaleRefs: [[0, 1, 1], [0, 3, 1], [0, 1, 1]] as [[number, number, number], [number, number, number], [number, number, number]],
  });
  const garment = (name: string) => ({
    name,
    source: { kind: "proxy" as const, proxy: name },
    role: "garment" as const,
    optional: true,
    material: { kind: "cloth" as const, color: [0.5, 0.5, 0.5] as [number, number, number] },
    baseIndex: put("u32", [0, 1, 2]),
    uv: put("f32", [0, 0, 1, 0, 1, 1]),
    indices: put("u32", [0, 1, 2]),
  });
  const proxies = [proxy("shirt"), proxy("hat")];
  const meshes = [{ name: "body", source: { kind: "base" as const }, role: "body" as const, material: { kind: "skin" as const }, ...body }, garment("shirt"), garment("hat")];
  const manifest: ActorPackManifest = {
    format: "actors-pack", version: 1, id: "tiny", species: "test", units: "meters", source: { name: "test", license: "CC0", url: "" },
    blob: "base.bin", vertexCount: 4, basePositions, meshes, proxies, targets: [],
    ...(rigged
      ? {
          // Two bones up the quad, the lower half on the first.
          skeleton: { name: "tiny", bones: [
            { name: "root", parent: -1, head: { vertices: [0, 1] }, tail: { vertices: [0, 1, 2, 3] }, roll: 0 },
            { name: "top", parent: 0, head: { vertices: [0, 1, 2, 3] }, tail: { vertices: [2, 3] }, roll: 0 },
          ] },
          skin: { joints: put("u32", [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), weights: put("f32", [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]) },
        }
      : {}),
  };
  const blob = new Uint8Array(offset);
  let at = 0;
  for (const p of parts) {
    blob.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), at);
    at += p.byteLength;
  }
  const files: Record<string, ArrayBuffer> = { "/tiny/manifest.json": new TextEncoder().encode(JSON.stringify(manifest)).buffer as ArrayBuffer, "/tiny/base.bin": blob.buffer };
  return ActorRuntime.load("/tiny/manifest.json", async (url) => files[url]);
}

describe("fitting only what is worn", () => {
  it("fits the proxies of the named meshes only", async () => {
    const rt = await tinyPack();
    expect([...rt.evaluateLoaded(new Map()).proxies.keys()].sort()).toEqual(["hat", "shirt"]);
    expect([...rt.evaluateLoaded(new Map(), undefined, undefined, ["body", "shirt"]).proxies.keys()]).toEqual(["shirt"]);
  });
});

describe("scene meshes on demand", () => {
  it("makes garment meshes when they are first shown, after a shape includes them", async () => {
    const rt = await tinyPack();
    const actor = new ThreeActor(rt);
    // Optional garments cost nothing until worn.
    expect([...actor.meshes.keys()]).toEqual(["body"]);
    actor.applyShape(rt.evaluateLoaded(new Map(), undefined, undefined, actor.neededMeshes()));
    actor.setVisible("shirt", true);
    // Visibility changes are applied together.
    expect(actor.meshes.has("shirt")).toBe(false);
    expect(actor.neededMeshes().sort()).toEqual(["body", "shirt"]);
    actor.flushVisibility();
    // Not drawn before a shape fits it.
    expect(actor.meshes.get("shirt")?.visible ?? false).toBe(false);
    const shape = rt.evaluateLoaded(new Map(), undefined, undefined, actor.neededMeshes());
    actor.applyShape(shape);
    const shirt = actor.meshes.get("shirt")!;
    expect(shirt.visible).toBe(true);
    // Filled from the shape's fitted proxy.
    expect([...(shirt.geometry.getAttribute("position").array as Float32Array)]).toEqual([...shape.proxies.get("shirt")!.positions]);
    expect(actor.meshes.has("hat")).toBe(false);
  });
});

describe("meshes another actor loaded", () => {
  it("lists the meshes an actor has no scene mesh for", async () => {
    const rt = await tinyPack();
    const actor = new ThreeActor(rt);
    expect(actor.newMeshes(rt.meshes)).toEqual([]);
    // As if another actor sharing the runtime had loaded a garment after this one was made.
    const cloak = { ...rt.meshes[1], def: { ...rt.meshes[1].def, name: "cloak" } };
    expect(actor.newMeshes([...rt.meshes, cloak])).toEqual([cloak]);
    actor.addMeshes([cloak]);
    expect(actor.newMeshes([cloak])).toEqual([]);
  });
});

describe("reversed depth", () => {
  it("flips garment polygon offsets once", async () => {
    const shown = async (reversedDepth: boolean) => {
      const rt = await tinyPack();
      const actor = new ThreeActor(rt, undefined, { reversedDepth });
      actor.setVisible("shirt", true);
      actor.flushVisibility();
      actor.applyShape(rt.evaluateLoaded(new Map(), undefined, undefined, actor.neededMeshes()));
      return actor.meshes.get("shirt")!.material as import("three").Material;
    };
    const plain = await shown(false), reversed = await shown(true);
    expect(plain.polygonOffset).toBe(true);
    expect(plain.polygonOffsetUnits).toBeLessThan(0);
    expect(reversed.polygonOffsetUnits).toBe(-plain.polygonOffsetUnits);
    expect(reversed.polygonOffsetFactor).toBe(-plain.polygonOffsetFactor);
  });
});

describe("cross-fades", () => {
  const bend = (name: string, deg: number) => ({ name, duration: 1, tracks: [{ bone: "top", axis: [1, 0, 0] as [number, number, number], keys: [{ t: 0, deg }, { t: 1, deg }] }] });

  it("blends from the clip playing to the next, then lets the old one go", async () => {
    const rt = await tinyPack(true);
    const actor = new ThreeActor(rt);
    actor.applyShape(rt.evaluateLoaded(new Map(), undefined, undefined, actor.neededMeshes()));
    actor.play(bend("a", 0));
    actor.update(0.5);
    actor.play(bend("b", 90), { fade: 0.4 });
    const to = actor.currentAction!;
    // Same phase of the loop, both still running.
    expect(to.time).toBeCloseTo(0.5);
    expect(actor.mixer.stats.actions.inUse).toBe(2);
    actor.update(0.2);
    expect(to.getEffectiveWeight()).toBeGreaterThan(0);
    expect(to.getEffectiveWeight()).toBeLessThan(1);
    actor.update(0.3);
    expect(actor.mixer.stats.actions.inUse).toBe(1);
    expect(actor.mixer.stats.actions.total).toBe(1);
    expect(to.getEffectiveWeight()).toBe(1);
  });

  it("cuts without a fade, keeping the time", async () => {
    const rt = await tinyPack(true);
    const actor = new ThreeActor(rt);
    actor.applyShape(rt.evaluateLoaded(new Map(), undefined, undefined, actor.neededMeshes()));
    actor.play(bend("a", 0));
    actor.update(0.25);
    const from = actor.currentAction!;
    actor.play(bend("b", 90));
    expect(actor.currentAction).not.toBe(from);
    expect(actor.mixer.stats.actions.inUse).toBe(1);
    expect(actor.currentAction!.time).toBeCloseTo(0.25);
    expect(actor.currentAction!.getEffectiveWeight()).toBe(1);
  });
});

describe("garments on one layer", () => {
  it("are drawn in outfit order, later ones further out, before and after their meshes exist", async () => {
    const offsets = async (reversedDepth: boolean, order: string[]) => {
      const rt = await tinyPack();
      const actor = new ThreeActor(rt, undefined, { reversedDepth });
      actor.setVisible("shirt", true);
      actor.flushVisibility();
      actor.setGarmentOrder(order); // the shirt exists, the hat not yet
      actor.setVisible("hat", true);
      actor.flushVisibility();
      actor.applyShape(rt.evaluateLoaded(new Map(), undefined, undefined, actor.neededMeshes()));
      const units = (n: string) => (actor.meshes.get(n)!.material as import("three").Material).polygonOffsetUnits;
      return { shirt: units("shirt"), hat: units("hat") };
    };
    const a = await offsets(false, ["shirt", "hat"]);
    expect(a.hat).toBeLessThan(a.shirt); // more negative: nearer the camera
    const b = await offsets(false, ["hat", "shirt"]);
    expect(b.shirt).toBeLessThan(b.hat);
    expect(b.hat).toBe(a.shirt); // the inner one keeps its layer's offset
    const r = await offsets(true, ["shirt", "hat"]);
    expect(r.hat).toBeGreaterThan(r.shirt); // reversed depth: the other sign
    expect(r.shirt).toBe(-a.shirt);
  });
});

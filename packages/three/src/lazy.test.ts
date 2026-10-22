import { describe, expect, it } from "vitest";
import { ActorRuntime, type ActorPackManifest } from "@actors/core";
import { ThreeActor } from "./index";

/**
 * A tiny pack: a quad body on four base vertices and two optional garments (a "shirt" and a
 * "hat"), each a one-triangle proxy bound to the body.
 */
async function tinyPack(): Promise<ActorRuntime> {
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

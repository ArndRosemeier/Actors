import { describe, expect, it } from "vitest";
import { fitProxy, readBuffer } from "@actors/core";
import { FUTURE_OUTFITS, resolveOutfit } from "@actors/generator";
import { BlobWriter } from "./blob";
import { orbitalHalo } from "./future-accessories";
import { shapedGarment } from "./shaped-garment";
import { GARMENTS, type GarmentContext, selectGarmentFaces } from "./garments";
import type { ObjFace } from "./obj";

describe("future wardrobe", () => {
  it("gives shaped pants distinct volumes and preserves fitting under scale and translation", () => {
    const ctx: GarmentContext = {
      positions: [0.16, 0.85, 0.04, 0.18, 0.5, 0.07, 0.15, 0.18, -0.02, -0.16, 0.85, 0.04, -0.18, 0.5, 0.07, -0.15, 0.18, -0.02],
      dominantBone: (v) => `calf_${v < 3 ? "l" : "r"}`,
      joint: (bone) => [bone.endsWith("_l") ? 0.1 : -0.1, bone.startsWith("thigh") ? 1 : 0.1, 0],
    };
    const silhouettes: number[][] = [];
    for (const name of ["future-flares", "future-cocoon", "future-culottes", "future-shorts"]) {
      const spec = GARMENTS.find((g) => g.name === name)!;
      const writer = new BlobWriter();
      const { proxy, positions } = shapedGarment(writer, [0, 1, 2, 3, 4, 5], spec, ctx);
      silhouettes.push(positions);
      const blob = writer.toBuffer().buffer as ArrayBuffer;
      const binding = { def: proxy, refs: readBuffer(blob, { ...proxy.refs, type: "u32" }), weights: readBuffer(blob, { ...proxy.weights, type: "f32" }), offsets: readBuffer(blob, { ...proxy.offsets, type: "f32" }) };
      const rest = fitProxy(binding, Float32Array.from(ctx.positions));
      const shaped = fitProxy(binding, Float32Array.from(ctx.positions.map((x) => x * 1.5 + 0.2)));
      for (let i = 0; i < rest.length; i++) {
        expect(rest[i]).toBeCloseTo(positions[i], 5);
        expect(shaped[i]).toBeCloseTo(rest[i] * 1.5 + 0.2, 5);
      }
      for (let i = 0; i < 9; i += 3) expect(rest[i]).toBeCloseTo(-rest[i + 9], 5);
    }
    expect(new Set(silhouettes.map((p) => JSON.stringify(p))).size).toBe(4);
  });
  it("keeps every complete look intact and accessories independent of clothing", () => {
    const garments = GARMENTS.filter((g) => g.info).map((g) => ({ id: g.name, label: g.label, coversAnatomy: false, category: g.info!.category!, occupies: g.info!.occupies! }));
    for (const [id, occupies] of [["future-halo", "halo"], ["briefs", "briefs"], ["sneakers", "shoes"]]) garments.push({ id, label: id, category: "Other", occupies: [occupies], coversAnatomy: id === "briefs" });
    for (const outfit of FUTURE_OUTFITS) {
      expect(resolveOutfit({ garments }, outfit.garments)).toEqual(outfit.garments);
      for (const [id, color] of Object.entries(outfit.colors!)) {
        expect(outfit.garments).toContain(id);
        expect(color).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
    expect(resolveOutfit({ garments }, ["future-wrap", "future-mantle", "future-cuffs", "future-screen"])).toEqual(["future-mantle", "future-cuffs", "future-screen"]);
  });

  it("retains small intended cuff islands without changing the existing default", () => {
    const faces = Array.from({ length: 4 }, (_, i) => ({ v: [i * 2, i * 2 + 1, i * 2 + 3, i * 2 + 2], vt: [], group: "helper-tights" })) as ObjFace[];
    const cut = new Map(Array.from({ length: 10 }, (_, i) => [i, 0.02]));
    expect(selectGarmentFaces(faces, cut)).toHaveLength(0);
    expect(selectGarmentFaces(faces, cut, 4)).toHaveLength(4);
  });

  it("cuts paired forearm cuffs while excluding hands and torso", () => {
    const spec = GARMENTS.find((g) => g.name === "future-cuffs")!;
    const ctx: GarmentContext = {
      positions: [], dominantBone: () => "lowerarm_l",
      joint: (bone) => bone.startsWith("upperarm") ? [bone.endsWith("_l") ? 0.2 : -0.2, 1.4, 0] : [bone.endsWith("_l") ? 0.8 : -0.8, 1.4, 0],
    };
    for (const sign of [-1, 1]) {
      const p = { x: sign * 0.74, y: 1.4, z: 0, bone: `lowerarm_${sign > 0 ? "l" : "r"}` };
      expect(spec.cut(p, ctx)).toBeGreaterThan(0);
      expect(spec.cut({ ...p, bone: "hand_l" }, ctx)).toBeLessThan(0);
      expect(spec.cut({ ...p, bone: "spine_03" }, ctx)).toBeLessThan(0);
    }
  });
});

describe("orbital halo", () => {
  it("produces finite indexed geometry that translates and scales with the head", () => {
    const p = [-0.1, 1.5, -0.1, 0.1, 1.5, -0.1, -0.1, 1.8, 0.1, 0.1, 1.8, 0.1];
    const writer = new BlobWriter();
    const { mesh, proxy } = orbitalHalo(writer, p, [0, 1, 2, 3]);
    const blob = writer.toBuffer().buffer as ArrayBuffer;
    const refs = readBuffer(blob, { ...proxy.refs, type: "u32" });
    const weights = readBuffer(blob, { ...proxy.weights, type: "f32" });
    const offsets = readBuffer(blob, { ...proxy.offsets, type: "f32" });
    const binding = { def: proxy, refs, weights, offsets };
    const rest = fitProxy(binding, Float32Array.from(p));
    const shaped = fitProxy(binding, Float32Array.from(p.map((x, i) => 2 * x + (i % 3 === 0 ? 1 : 0))));
    expect(rest.every(Number.isFinite)).toBe(true);
    for (let i = 0; i < rest.length; i++) expect(shaped[i]).toBeCloseTo(rest[i] * 2 + (i % 3 === 0 ? 1 : 0), 5);
    const indices = readBuffer(blob, { ...mesh.indices!, type: "u32" });
    expect(indices.length).toBe(96 * 8 * 6 * 2);
    for (const index of indices) expect(index).toBeLessThan(proxy.vertexCount);
    for (let i = 0; i < weights.length; i += 3) expect(weights[i] + weights[i + 1] + weights[i + 2]).toBeCloseTo(1);
  });
});

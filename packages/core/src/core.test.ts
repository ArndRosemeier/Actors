import { describe, expect, it } from "vitest";
import { applyTarget, decodeTarget, encodeTarget } from "./target";
import { boneRotationFromRoll } from "./skeleton";
import { mat3Apply, normalize } from "./math";
import { fitProxy } from "./proxy";

describe("morph targets", () => {
  it("round-trips sparse targets within quantization error", () => {
    const t = decodeTarget(encodeTarget([2, 5], [0.1, -0.2, 0.3, 0.01, 0, -0.05], 10));
    expect(t.indices).not.toBeNull();
    const pos = new Float32Array(30);
    applyTarget(pos, t, 1);
    expect(pos[6]).toBeCloseTo(0.1, 4);
    expect(pos[7]).toBeCloseTo(-0.2, 4);
    expect(pos[17]).toBeCloseTo(-0.05, 4);
    expect(pos[0]).toBe(0);
  });

  it("stores targets densely when they touch most vertices", () => {
    const idx = [0, 1, 2, 3];
    const t = decodeTarget(encodeTarget(idx, new Array(12).fill(0.5), 4));
    expect(t.indices).toBeNull();
    const pos = new Float32Array(12);
    applyTarget(pos, t, 0.5);
    expect(pos[11]).toBeCloseTo(0.25, 4);
  });
});

describe("bone rotation", () => {
  it("maps local +Y onto the bone direction for any roll", () => {
    const dir = normalize([0.3, -0.5, 0.8]);
    for (const roll of [0, 1, -2.5]) {
      const y = mat3Apply(boneRotationFromRoll(dir, roll), [0, 1, 0]);
      y.forEach((v, i) => expect(v).toBeCloseTo(dir[i], 6));
    }
  });
});

describe("proxy fitting", () => {
  it("places proxy vertices from barycentric weights plus scaled offsets", () => {
    const positions = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2]);
    const def = {
      name: "p",
      vertexCount: 1,
      refs: { offset: 0, count: 3, type: "u32" as const },
      weights: { offset: 0, count: 3, type: "f32" as const },
      offsets: { offset: 0, count: 3, type: "f32" as const },
      // rest lengths 1 -> current distance 2 => offsets doubled
      scaleRefs: [[0, 1, 1], [0, 2, 1], [0, 3, 1]] as [[number, number, number], [number, number, number], [number, number, number]],
    };
    const out = fitProxy(
      { def, refs: new Uint32Array([0, 1, 2]), weights: new Float32Array([0.5, 0.5, 0]), offsets: new Float32Array([0, 0, 0.1]) },
      positions,
    );
    expect([...out].map((v) => +v.toFixed(5))).toEqual([1, 0, 0.2]);
  });
});

describe("skirt skinning", () => {
  it("moves lower-leg weight to the thighs, averages left/right and shares some with the hip", async () => {
    const { proxySkin } = await import("./proxy");
    const names = ["pelvis", "thigh_l", "thigh_r", "calf_l"];
    const binding = {
      def: {
        name: "s",
        vertexCount: 1,
        refs: { offset: 0, count: 0, type: "u32" as const },
        weights: { offset: 0, count: 0, type: "f32" as const },
        offsets: { offset: 0, count: 0, type: "f32" as const },
        scaleRefs: [[0, 0, 1], [0, 0, 1], [0, 0, 1]] as [[number, number, number], [number, number, number], [number, number, number]],
        legBlend: { remap: { calf_l: "thigh_l" }, pairs: [["thigh_l", "thigh_r"]] as [string, string][], hip: "pelvis", hipShare: 0.2 },
      },
      refs: new Uint32Array([0, 0, 0]),
      weights: new Float32Array([1, 0, 0]),
      offsets: new Float32Array(3),
    };
    // Base vertex 0: 60% calf_l, 40% thigh_l.
    const { joints, weights } = proxySkin(binding, new Uint16Array([3, 1, 0, 0]), new Float32Array([0.6, 0.4, 0, 0]), names);
    const w = new Map<string, number>();
    for (let k = 0; k < 4; k++) if (weights[k]) w.set(names[joints[k]], weights[k]);
    expect(w.get("thigh_l")).toBeCloseTo(0.4, 5);
    expect(w.get("thigh_r")).toBeCloseTo(0.4, 5);
    expect(w.get("pelvis")).toBeCloseTo(0.2, 5);
    expect(w.has("calf_l")).toBe(false);
  });
});

describe("on-demand meshes", () => {
  it("loads a garment from its own file and fits its proxy afterwards", async () => {
    const { ActorRuntime } = await import("./runtime");
    const f32 = (a: number[]) => new Float32Array(a).buffer;
    const u32 = (a: number[]) => new Uint32Array(a).buffer;
    const concat = (parts: ArrayBuffer[]) => {
      const out = new Uint8Array(parts.reduce((s, p) => s + p.byteLength, 0));
      let o = 0;
      for (const p of parts) {
        out.set(new Uint8Array(p), o);
        o += p.byteLength;
      }
      return out.buffer;
    };
    // Base: one triangle. Garment: one vertex 1 cm in front of its centre.
    const base = concat([f32([0, 0, 0, 1, 0, 0, 0, 1, 0]), u32([0, 1, 2]), f32([0, 0, 0, 1, 0, 1]), u32([0, 1, 2])]);
    const garment = concat([u32([0, 1, 2]), f32([1 / 3, 1 / 3, 1 / 3]), f32([0, 0, 0.01]), u32([0]), f32([0, 0]), u32([0, 0, 0])]);
    const manifest = {
      format: "actors-pack",
      version: 1,
      id: "t",
      species: "test",
      units: "meters",
      source: { name: "", license: "", url: "" },
      blob: "base.bin",
      vertexCount: 3,
      basePositions: { offset: 0, count: 9, type: "f32" },
      meshes: [
        { name: "body", source: { kind: "base" }, role: "body", baseIndex: { offset: 36, count: 3, type: "u32" }, uv: { offset: 48, count: 6, type: "f32" }, indices: { offset: 72, count: 3, type: "u32" }, material: { kind: "skin" } },
        {
          name: "cape",
          source: { kind: "proxy", proxy: "cape" },
          role: "garment",
          blob: "cape.bin",
          optional: true,
          baseIndex: { offset: 36, count: 1, type: "u32" },
          uv: { offset: 40, count: 2, type: "f32" },
          indices: { offset: 48, count: 3, type: "u32" },
          material: { kind: "cloth" },
        },
      ],
      proxies: [{ name: "cape", blob: "cape.bin", vertexCount: 1, refs: { offset: 0, count: 3, type: "u32" }, weights: { offset: 12, count: 3, type: "f32" }, offsets: { offset: 24, count: 3, type: "f32" }, scaleRefs: [[0, 1, 0], [0, 2, 0], [0, 1, 0]] }],
      targets: [],
    };
    const files: Record<string, ArrayBuffer> = { "p/m.json": new TextEncoder().encode(JSON.stringify(manifest)).buffer as ArrayBuffer, "p/base.bin": base, "p/cape.bin": garment };
    const fetched: string[] = [];
    const rt = await ActorRuntime.load("p/m.json", async (url) => {
      fetched.push(url);
      return files[url];
    });
    expect(rt.isLoaded("body")).toBe(true);
    expect(rt.isLoaded("cape")).toBe(false);
    expect(fetched).not.toContain("p/cape.bin");
    expect((await rt.evaluate(new Map())).proxies.has("cape")).toBe(false);
    const [cape] = await rt.loadMeshes(["cape", "body"]);
    expect(cape.def.name).toBe("cape");
    expect(await rt.loadMeshes(["cape"])).toEqual([]);
    const shape = await rt.evaluate(new Map());
    const p = shape.proxies.get("cape")!.positions;
    expect(p[0]).toBeCloseTo(1 / 3, 5);
    expect(p[2]).toBeCloseTo(0.01, 5);
  });
});

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAPE_BONES, type CostumeParts, hasCostume } from "./costume";
import { EMBLEM_SHAPES, EMBLEM_SYMBOLS, emblemTexture, plateDistance } from "./emblem";
import { Human } from "./human";
import { partsBody, buildParts, type PartsConfig } from "./parts";

const MANIFEST = new URL("../../../apps/viewer/public/packs/human/manifest.json", import.meta.url).pathname;
const white: [number, number, number] = [1, 1, 1];
const full: CostumeParts = { cape: "classic", collar: "flared", capeColor: white, liningColor: white, mask: "cowl", maskColor: white, belt: "utility", beltColor: white, buckleColor: white, emblem: "shield", symbol: "bolt", emblemSize: 0.5, rimColor: white };

describe("emblem", () => {
  it("paints every shape and symbol, and the plate outline encloses the centre", () => {
    for (const shape of EMBLEM_SHAPES.filter((s) => s !== "none"))
      for (const symbol of EMBLEM_SYMBOLS) {
        const t = emblemTexture({ shape, symbol, plate: [0.8, 0.1, 0.1], ink: [1, 0.9, 0.2] }, 32);
        expect(t.length).toBe(32 * 32 * 4);
        if (shape !== "cutout" || symbol === "none" || symbol === "star" || symbol === "eye") expect(plateDistance(shape, symbol, 0, 0)).toBeLessThan(0);
        expect(plateDistance(shape, symbol, 1.2, 1.2)).toBeGreaterThan(0);
      }
  });
});

describe.skipIf(!existsSync(MANIFEST))("costume parts (needs the human pack)", () => {
  it("builds a cape on bones behind the body, a mask, a belt and an emblem in front", async () => {
    const fetcher = async (url: string) => {
      const b = readFileSync(url);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    };
    const h = await Human.load(MANIFEST, fetcher, true);
    await h.runtime.loadMeshes(["body", "eyes"]);
    h.fit = ["body", "eyes"];
    const shape = await h.evaluate();
    const body = partsBody(shape, h.runtime.meshes, null, null)!;
    const cfg: PartsConfig = { seed: 0.5, scale: 1, horns: "none", hornSize: 0, hornColor: white, tusks: 0, tail: "none", tailLength: 0, beard: "none", hair: "none", costume: full };
    expect(hasCostume(full)).toBe(true);
    const parts = buildParts(body, cfg);
    const names = parts.map((p) => p.name);
    expect(names).toEqual(["cape", "cape-lining", "mask", "belt", "buckle", "emblem", "emblem-rim"]);
    const cape = parts[0];
    expect(cape.bones?.map((b) => b.name)).toEqual(CAPE_BONES);
    const nb = body.skeleton.names.length;
    for (const p of parts) {
      for (const x of p.positions) expect(Number.isFinite(x)).toBe(true);
      for (const j of p.joints) expect(j).toBeLessThan(nb + CAPE_BONES.length);
      expect(p.indices.length % 3).toBe(0);
      for (const i of p.indices) expect(i).toBeLessThan(p.positions.length / 3);
    }
    const spine = body.skeleton.heads[body.skeleton.names.indexOf("spine_03")];
    let behind = 0;
    for (let i = 0; i < cape.positions.length; i += 3) if (cape.positions[i + 2] < spine[2]) behind++;
    expect(behind / (cape.positions.length / 3)).toBeGreaterThan(0.85); // (the collar wraps round the neck)
    const emblem = parts[5];
    for (let i = 2; i < emblem.positions.length; i += 3) expect(emblem.positions[i]).toBeGreaterThan(spine[2]);
    // Deterministic.
    expect(buildParts(body, cfg)[0].positions).toEqual(cape.positions);
  }, 30000);
});

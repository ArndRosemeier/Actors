import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { massHairPng, writeRgbaDownsampled } from "./image";

describe("a texture's mean colour", () => {
  it("is averaged in linear light, so a high-contrast texture's mean is not too dark", () => {
    const dir = mkdtempSync(join(tmpdir(), "mean-"));
    const png = new PNG({ width: 2, height: 1 });
    png.data = Buffer.from([0, 0, 0, 255, 255, 255, 255, 255]); // black and white
    writeFileSync(join(dir, "src.png"), PNG.sync.write(png));
    const [r] = writeRgbaDownsampled(join(dir, "src.png"), join(dir, "out.png"), 16);
    // Linear mean 0.5 is sRGB 0.735; an sRGB average would give 0.5 (linear 0.21).
    expect(r).toBeCloseTo(0.735, 2);
  });
});

describe("hair masses", () => {
  it("closes the gaps between dense strands and drops a lone strand", () => {
    const dir = mkdtempSync(join(tmpdir(), "mass-"));
    const W = 256;
    const png = new PNG({ width: W, height: W });
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        // Left half: a lock of 2-px strands with 1-px gaps. x = 200: one lone strand.
        const hair = (x < 128 && x % 3 !== 2) || x === 200;
        png.data[i] = png.data[i + 1] = png.data[i + 2] = hair ? 120 : 0;
        png.data[i + 3] = hair ? 255 : 0;
      }
    writeFileSync(join(dir, "hair.png"), PNG.sync.write(png));
    massHairPng(join(dir, "hair.png"));
    const out = PNG.sync.read(readFileSync(join(dir, "hair.png")));
    const alpha = (x: number) => out.data[(128 * W + x) * 4 + 3];
    expect(alpha(62)).toBe(255); // a former gap inside the lock
    expect(alpha(200)).toBe(0); // the lone strand
    // Gap texels take the hair's colour (a little darker), not black.
    expect(out.data[(128 * W + 62) * 4]).toBeGreaterThan(60);
  });
});

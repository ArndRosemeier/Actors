import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { writeRgbaDownsampled } from "./image";

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

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { skinToneColor } from "./character";

describe("procedural skin tone", () => {
  it("is a flesh colour, not near-white, across the light end (sRGB as seen)", () => {
    for (const t of [0, 0.05, 0.25, 0.45]) {
      const c = skinToneColor(t).getStyle(THREE.SRGBColorSpace).match(/\d+/g)!.map(Number);
      const [r, g, b] = c;
      expect(r).toBeLessThanOrEqual(240);
      expect(r - b).toBeGreaterThan(50); // warm, not grey or white
      expect(g).toBeLessThan(r);
    }
  });

  it("runs from light to dark", () => {
    const lum = (t: number) => { const c = skinToneColor(t); return c.r + c.g + c.b; };
    expect(lum(0)).toBeGreaterThan(lum(0.5));
    expect(lum(0.5)).toBeGreaterThan(lum(1));
    expect(skinToneColor(0).getHexString(THREE.SRGBColorSpace)).toBe(new THREE.Color().setRGB(0.93, 0.76, 0.66, THREE.SRGBColorSpace).getHexString(THREE.SRGBColorSpace));
  });
});

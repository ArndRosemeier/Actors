import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createNodeClothMaterial } from "./materials";
import type { ClothTintUniforms } from "../materials";

describe("node cloth", () => {
  it("carries the same tint uniforms as the WebGL kit, the costume pattern included", () => {
    // ThreeActor.setGarmentPattern writes uTintPattern on every worn garment (Character's costume finishes): a node
    // garment without it threw on every dress-up under WebGPURenderer (0.35.0).
    const tint = createNodeClothMaterial(new THREE.Color(1, 1, 1), 0.7, "knit", 1).userData.tint as ClothTintUniforms;
    expect(tint.uTintPattern.value).toBe(1);
    tint.uTintPattern.value = 0.2;
    expect(tint.uTintPattern.value).toBe(0.2);
  });

  it("shares one graph between garments, with or without a costume pattern", () => {
    const a = createNodeClothMaterial(new THREE.Color(1, 0, 0), 0.7, "knit", 1), b = createNodeClothMaterial(new THREE.Color(0, 0, 1), 0.5, "smooth", 2);
    expect(a.colorNode).toBe(b.colorNode);
  });
});

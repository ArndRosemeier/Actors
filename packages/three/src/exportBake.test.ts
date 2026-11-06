import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { cutClippedGeometry, dilate } from "./exportBake";

function strip(clip: number[]): THREE.BufferGeometry {
  // Two triangles side by side along x: vertices at x = 0, 1, 2 (bottom) and 0, 1, 2 (top).
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 0, 1, 1, 0, 2, 1, 0], 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 0.5, 0, 1, 0, 0, 1, 0.5, 1, 1, 1], 2));
  g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute([0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0], 4));
  g.setAttribute("clipValue", new THREE.Float32BufferAttribute(clip, 1));
  g.setIndex([0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4]);
  return g;
}

describe("cutClippedGeometry", () => {
  it("returns null when nothing is below zero", () => {
    expect(cutClippedGeometry(strip([1, 1, 1, 1, 1, 1]))).toBeNull();
  });

  it("cuts faces at clipValue = 0 and drops the clipped part", () => {
    // Clip falls from 1 at x = 0 to -1 at x = 2: the cut runs along x = 1.
    const cut = cutClippedGeometry(strip([1, 0.0001, -1, 1, 0.0001, -1]))!;
    expect(cut).not.toBeNull();
    const pos = cut.getAttribute("position");
    const index = cut.getIndex()!;
    let maxX = 0;
    for (let i = 0; i < index.count; i++) maxX = Math.max(maxX, pos.getX(index.getX(i)));
    expect(maxX).toBeCloseTo(1, 3);
    expect(cut.getAttribute("clipValue")).toBeUndefined();
    // New vertices interpolate uv but take the nearer end's bone.
    const last = pos.count - 1;
    expect(cut.getAttribute("uv").getX(last)).toBeCloseTo(pos.getX(last) / 2, 5);
    expect([1, 2]).toContain(cut.getAttribute("skinIndex").getX(last));
  });

  it("keeps the winding of split faces", () => {
    const cut = cutClippedGeometry(strip([1, -1, -1, 1, 1, -1]))!;
    const pos = cut.getAttribute("position");
    const index = cut.getIndex()!;
    for (let i = 0; i < index.count; i += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(pos, index.getX(i + k)));
      const z = new THREE.Vector3().crossVectors(b.sub(a), c.sub(a)).z;
      expect(z).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("dilate", () => {
  it("fills uncovered pixels from covered neighbours", () => {
    const size = 3;
    const rgba = new Uint8Array(size * size * 4);
    const cover = new Uint8Array(size * size * 4);
    rgba.set([200, 100, 50, 255], 4 * 4);
    cover.set([255, 255, 255, 255], 4 * 4);
    dilate(rgba, cover, size, 1);
    expect(Array.from(rgba.subarray(0, 4))).toEqual([200, 100, 50, 255]);
  });
});

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { addMorphAttributes, clearDeltas, morphArrays, morphAttribute, setDelta } from "./morphs";

/** Distinct GPU buffers a geometry's attributes need (interleaved attributes share theirs). */
function buffers(g: THREE.BufferGeometry): number {
  const set = new Set<unknown>();
  for (const a of Object.values(g.attributes)) set.add((a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ? (a as THREE.InterleavedBufferAttribute).data : a);
  return set.size;
}

describe("attribute morphs", () => {
  it("pack every channel into one vertex buffer", () => {
    const g = new THREE.BufferGeometry();
    addMorphAttributes(g, 4, 2, true);
    expect(Object.keys(g.attributes).sort()).toEqual([morphAttribute(0), morphAttribute(0, true), morphAttribute(1), morphAttribute(1, true)].sort());
    expect(buffers(g)).toBe(1);
    const parts = new THREE.BufferGeometry();
    addMorphAttributes(parts, 4, 2, false);
    expect(buffers(parts)).toBe(1);
  });

  it("write each channel to its own slot", () => {
    const g = new THREE.BufferGeometry();
    addMorphAttributes(g, 3, 2, true);
    const c0 = morphArrays(g, 0)!;
    const c1 = morphArrays(g, 1)!;
    setDelta(c1.positions, 2, 1, 2, 3);
    setDelta(c0.normals!, 2, 4, 5, 6);
    const p1 = g.getAttribute(morphAttribute(1));
    expect([p1.getX(2), p1.getY(2), p1.getZ(2)]).toEqual([1, 2, 3]);
    const n0 = g.getAttribute(morphAttribute(0, true));
    expect([n0.getX(2), n0.getY(2), n0.getZ(2)]).toEqual([4, 5, 6]);
    clearDeltas(c0.normals!, 3);
    expect(n0.getX(2)).toBe(0);
    expect(p1.getX(2)).toBe(1); // the other channel is untouched
  });

  it("still read three's morph targets", () => {
    const g = new THREE.BufferGeometry();
    g.morphAttributes.position = [new THREE.BufferAttribute(new Float32Array(6), 3)];
    const a = morphArrays(g, 0)!;
    setDelta(a.positions, 1, 7, 8, 9);
    expect(Array.from(g.morphAttributes.position[0].array)).toEqual([0, 0, 0, 7, 8, 9]);
    expect(a.normals).toBeNull();
  });
});

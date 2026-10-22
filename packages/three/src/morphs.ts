/**
 * Face morph channels (ThreeActor.MORPHS) as plain vertex attributes.
 *
 * three keys a node material's shader by the identity of a geometry's morph
 * targets, so with three's morphs every actor's face meshes would build
 * shaders of their own. A kit with `attributeMorphs` (the node kit) gets the
 * channels as ordinary attributes instead (`actorMorph<k>`, `actorMorph<k>N`
 * for normals), which its materials blend themselves with the mesh's
 * `morphTargetInfluences`; those shaders are shared. The WebGL kit keeps
 * three's morph targets.
 *
 * All channels of a geometry live in ONE interleaved buffer, so they take a
 * single vertex buffer slot: WebGPU allows only 8 per draw, and a body with
 * position, normal, uv, skinning and clip values already uses 6.
 */
import * as THREE from "three";

/** The attribute holding channel `k`'s position deltas (`normal`: its normal deltas). */
export function morphAttribute(k: number, normal = false): string {
  return `actorMorph${k}${normal ? "N" : ""}`;
}

/**
 * Adds `channels` morph channels for `count` vertices to `g` as attributes
 * sharing one interleaved buffer (per vertex: channel 0 position delta,
 * channel 0 normal delta if `normals`, channel 1 ...).
 */
export function addMorphAttributes(g: THREE.BufferGeometry, count: number, channels: number, normals: boolean): void {
  const per = normals ? 6 : 3;
  const buffer = new THREE.InterleavedBuffer(new Float32Array(count * channels * per), channels * per);
  for (let k = 0; k < channels; k++) {
    g.setAttribute(morphAttribute(k), new THREE.InterleavedBufferAttribute(buffer, 3, k * per));
    if (normals) g.setAttribute(morphAttribute(k, true), new THREE.InterleavedBufferAttribute(buffer, 3, k * per + 3));
  }
}

/** Where one channel's deltas live: vertex `i`'s xyz is at `array[i * stride + offset]` onwards. */
export interface MorphSlot {
  array: Float32Array;
  offset: number;
  stride: number;
}

function slot(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined): MorphSlot | null {
  if (!a) return null;
  if ((a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) {
    const ia = a as THREE.InterleavedBufferAttribute;
    return { array: ia.data.array as Float32Array, offset: ia.offset, stride: ia.data.stride };
  }
  return { array: a.array as Float32Array, offset: 0, stride: a.itemSize };
}

/** Channel `k`'s position and normal deltas in `g` (either kind of morph), or null if it has none. */
export function morphArrays(g: THREE.BufferGeometry, k: number): { positions: MorphSlot; normals: MorphSlot | null } | null {
  const p = slot(g.getAttribute(morphAttribute(k)) as THREE.InterleavedBufferAttribute | undefined);
  if (p) return { positions: p, normals: slot(g.getAttribute(morphAttribute(k, true)) as THREE.InterleavedBufferAttribute | undefined) };
  const mp = slot(g.morphAttributes.position?.[k] as THREE.BufferAttribute | undefined);
  if (!mp) return null;
  return { positions: mp, normals: slot(g.morphAttributes.normal?.[k] as THREE.BufferAttribute | undefined) };
}

/** Sets vertex `i` of `s` to (x, y, z). */
export function setDelta(s: MorphSlot, i: number, x: number, y: number, z: number): void {
  const o = i * s.stride + s.offset;
  s.array[o] = x;
  s.array[o + 1] = y;
  s.array[o + 2] = z;
}

/** Zeroes all `count` vertices of `s` (leaves other channels sharing its buffer alone). */
export function clearDeltas(s: MorphSlot, count: number): void {
  if (s.offset === 0 && s.stride === 3) {
    s.array.fill(0);
    return;
  }
  for (let i = 0; i < count; i++) setDelta(s, i, 0, 0, 0);
}

/** After writing channel `k`'s arrays: re-upload them. */
export function morphsChanged(g: THREE.BufferGeometry, k: number): void {
  const p = g.getAttribute(morphAttribute(k)) as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
  if (p) {
    p.needsUpdate = true; // on an interleaved attribute this flags the shared buffer
    const n = g.getAttribute(morphAttribute(k, true)) as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
    if (n) n.needsUpdate = true;
    return;
  }
  // three caches morph targets in a texture; disposing forces a re-upload (attributes are re-created on demand).
  g.dispose();
}

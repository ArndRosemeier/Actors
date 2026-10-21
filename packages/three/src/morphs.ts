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
 */
import type * as THREE from "three";

/** The attribute holding channel `k`'s position deltas (`normal`: its normal deltas). */
export function morphAttribute(k: number, normal = false): string {
  return `actorMorph${k}${normal ? "N" : ""}`;
}

/** Channel `k`'s position and normal delta arrays in `g` (either kind of morph), or null if it has none. */
export function morphArrays(g: THREE.BufferGeometry, k: number): { positions: Float32Array; normals: Float32Array | null } | null {
  const p = g.getAttribute(morphAttribute(k)) as THREE.BufferAttribute | undefined;
  if (p) return { positions: p.array as Float32Array, normals: ((g.getAttribute(morphAttribute(k, true)) as THREE.BufferAttribute | undefined)?.array as Float32Array | undefined) ?? null };
  const mp = g.morphAttributes.position?.[k];
  if (!mp) return null;
  return { positions: mp.array as Float32Array, normals: (g.morphAttributes.normal?.[k]?.array as Float32Array | undefined) ?? null };
}

/** After writing channel `k`'s arrays: re-upload them. */
export function morphsChanged(g: THREE.BufferGeometry, k: number): void {
  const p = g.getAttribute(morphAttribute(k)) as THREE.BufferAttribute | undefined;
  if (p) {
    p.needsUpdate = true;
    const n = g.getAttribute(morphAttribute(k, true)) as THREE.BufferAttribute | undefined;
    if (n) n.needsUpdate = true;
    return;
  }
  // three caches morph targets in a texture; disposing forces a re-upload (attributes are re-created on demand).
  g.dispose();
}

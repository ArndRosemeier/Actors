/**
 * Extra skinned meshes generated at runtime (horns, beards, tails...), in the
 * same model space and skeleton as the actor's pack meshes. Renderer-free.
 */
export type PartKind = "hair" | "leaf" | "horn" | "tusk" | "skin" | "fin" | "fur";

export interface PartMesh {
  name: string;
  kind: PartKind;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** Per vertex brightness factor (shading variation along horns, between strands...). */
  shade: Float32Array;
  /** 4 influences per vertex, as bone indices of the pack skeleton. */
  joints: Uint16Array;
  weights: Float32Array;
  indices: Uint32Array;
  /** Base colour (sRGB 0..1); hair-like parts take the hair colour instead when it is set. */
  color?: [number, number, number];
}

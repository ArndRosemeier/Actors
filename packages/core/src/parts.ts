/**
 * Extra skinned meshes generated at runtime (horns, beards, tails...), in the
 * same model space and skeleton as the actor's pack meshes. Renderer-free.
 */
export type PartKind =
  | "hair" | "leaf" | "horn" | "tusk" | "skin" | "fin" | "fur"
  // Robot parts: painted armour plates, second paint, flexible inner frame, bare-metal joint housings, visor glass, lights.
  | "plate" | "trim" | "frame" | "joint" | "visor" | "glow";

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
  /**
   * Extra bones this part adds (e.g. a tail chain), in model space (bind pose).
   * Joint indices past the pack skeleton refer to them: pack bone count + the
   * bone's position among all parts' extra bones, in part order.
   */
  bones?: PartBone[];
  /**
   * Per vertex: a base vertex the part follows in face morphs (a beard strand
   * moves with the skin it grows from when the mouth opens). Absent = rigid.
   */
  anchors?: Uint32Array;
}

export interface PartBone {
  name: string;
  /** Parent bone name: a pack bone or an earlier extra bone. */
  parent: string;
  head: [number, number, number];
}

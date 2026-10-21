import type { MeshDef } from "@actors/core";

/**
 * Garment layer order: skin 0, garments cut from the body (underwear, T-shirt,
 * jeans, by thickness) above it, fitted garments (proxies) on top. Tucked-in
 * tops (tag "tucked") stay with the body-cut layer, under the trousers.
 */
export function garmentLayer(def: MeshDef): number {
  if (def.role === "body") return 0;
  const fitted = def.source.kind === "proxy" && !def.tags?.includes("tucked");
  return (fitted ? 2 : 1) + (def.inflate ?? 0) * 100;
}

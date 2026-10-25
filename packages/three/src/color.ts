import * as THREE from "three";

/**
 * A colour picked by eye (sRGB, as a colour picker shows it). `new THREE.Color(r, g, b)` would read the
 * numbers as linear and the colour would come out far too pale.
 */
export function srgb(r: number, g: number, b: number): THREE.Color {
  return new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
}

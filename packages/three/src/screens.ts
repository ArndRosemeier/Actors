import * as THREE from "three";

const SIZE = 64;
type ScreenMaterial = THREE.Material & Pick<THREE.MeshStandardMaterial, "color" | "emissive" | "emissiveMap" | "emissiveIntensity">;
interface ScreenState {
  texture: THREE.DataTexture;
  color: THREE.Color;
  time: number;
  frame: number;
}
const screens = new WeakMap<THREE.Material, ScreenState>();

/** Slow aurora ribbons on a pixel grid. Opaque, deterministic, and exportable as a still image. */
export function screenPixels(time: number, data = new Uint8Array(SIZE * SIZE * 4)): Uint8Array {
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const u = x / SIZE, v = y / SIZE;
    const wave = Math.sin(v * 17 + Math.sin(u * 9 + time * 0.22) * 2.8 - time * 0.38);
    const ribbon = Math.pow(Math.max(0, wave), 4);
    const grid = x % 4 === 0 || y % 4 === 0 ? 0.7 : 1;
    const p = (y * SIZE + x) * 4;
    for (let c = 0; c < 3; c++) {
      const hue = 0.5 + 0.5 * Math.sin(u * 6 + v * 4 + c * 2.094 + time * 0.13);
      data[p + c] = Math.round((12 + ribbon * (80 + hue * 163)) * grid);
    }
    data[p + 3] = 255;
  }
  return data;
}

/** Standard emissive maps work in WebGL, WebGPU and glTF without a custom export shader. */
export function useScreenMaterial<T extends ScreenMaterial>(material: T, color: THREE.Color): T {
  const texture = new THREE.DataTexture(screenPixels(0), SIZE, SIZE);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  material.emissiveMap = texture;
  material.emissive.copy(color);
  material.emissiveIntensity = 1.8;
  // Dark textile backing keeps unlit pixels dark even under the studio's key light.
  // The garment tint still colours the backing via its existing luminance-preserving shader.
  material.color.multiplyScalar(0.06);
  const state: ScreenState = { texture, color: color.clone(), time: 0, frame: 0 };
  screens.set(material, state);
  material.addEventListener("dispose", () => { texture.dispose(); screens.delete(material); });
  return material;
}

export function setScreenColor(material: THREE.Material, color: THREE.ColorRepresentation | null): void {
  const state = screens.get(material);
  if (state) (material as ScreenMaterial).emissive.copy(color === null ? state.color : new THREE.Color(color));
}

/** At most 12 texture uploads per second per visible screen; no timers or shared mutable texture. */
export function updateScreen(material: THREE.Material, dt: number): void {
  const state = screens.get(material);
  if (!state || !Number.isFinite(dt) || dt <= 0) return;
  state.time += dt;
  const frame = Math.floor(state.time * 12);
  if (frame === state.frame) return;
  state.frame = frame;
  screenPixels(state.time, state.texture.image.data as Uint8Array);
  state.texture.needsUpdate = true;
}

import * as THREE from "three";

/** Width and height of screenPixels' RGBA8 sRGB image. */
export const SCREEN_TEXTURE_SIZE = 64;
const SIZE = SCREEN_TEXTURE_SIZE;
type ScreenMaterial = THREE.Material & Pick<THREE.MeshStandardMaterial, "color" | "emissive" | "emissiveMap" | "emissiveIntensity">;
interface ScreenState {
  texture: THREE.DataTexture;
  color: THREE.Color;
  time: number;
  frame: number;
  shared?: ScreenLease;
}
const screens = new WeakMap<THREE.Material, ScreenState>();

interface ScreenLease {
  pool: ScreenTexturePool;
  texture: THREE.DataTexture;
  sample(): void;
  release(): void;
}

function screenTexture(time: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(screenPixels(time), SIZE, SIZE);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Shared screen phases for one scene. Advance update(dt) once per scene frame,
 * before updating actors. Visible materials sample lazily, so each used phase
 * is redrawn at most once per 1/12 second regardless of the number of wearers.
 * Materials keep independent emission colours. Textures are released when
 * their last material is disposed or moved out of the pool.
 */
export class ScreenTexturePool {
  private time = 0;
  private next = 0;
  private readonly phases = new Map<number, { texture: THREE.DataTexture; frame: number; refs: number }>();

  constructor(readonly phaseCount = 4) {
    if (!Number.isInteger(phaseCount) || phaseCount < 1 || phaseCount > 64) throw new RangeError("Screen phase count must be an integer from 1 to 64");
  }

  /** Advances the scene clock only; unused phases do no pixel work. dt is seconds. */
  update(dt: number): void {
    if (Number.isFinite(dt) && dt > 0) this.time += dt;
  }

  /** @internal A material's reference to a phase; released on material disposal. */
  acquire(): ScreenLease {
    const phase = this.next++ % this.phaseCount;
    let entry = this.phases.get(phase);
    if (!entry) {
      const frame = Math.floor(this.time * 12);
      entry = { texture: screenTexture(frame / 12 + phase * 5), frame, refs: 0 };
      this.phases.set(phase, entry);
    }
    entry.refs++;
    const owned = entry;
    let released = false;
    return {
      pool: this, texture: owned.texture,
      sample: () => {
        const frame = Math.floor(this.time * 12);
        if (released || owned.frame === frame) return;
        screenPixels(frame / 12 + phase * 5, owned.texture.image.data as Uint8Array);
        owned.frame = frame;
        owned.texture.needsUpdate = true;
      },
      release: () => {
        if (released) return;
        released = true;
        if (--owned.refs === 0) { owned.texture.dispose(); this.phases.delete(phase); }
      },
    };
  }
}

/**
 * Slow aurora ribbons on a pixel grid, independent of garment tint.
 * Returns an opaque RGBA8 sRGB image, SCREEN_TEXTURE_SIZE square. `time` is
 * seconds; pass a SCREEN_TEXTURE_SIZE * SCREEN_TEXTURE_SIZE * 4 byte buffer to update it in place without
 * allocating. Useful for application-owned textures shared by phase groups.
 */
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
export function useScreenMaterial<T extends ScreenMaterial>(material: T, color: THREE.Color, pool?: ScreenTexturePool | null): T {
  const shared = pool?.acquire();
  const texture = shared?.texture ?? screenTexture(0);
  material.emissiveMap = texture;
  material.emissive.copy(color);
  material.emissiveIntensity = 1.8;
  // Dark textile backing keeps unlit pixels dark even under the studio's key light.
  // The garment tint still colours the backing via its existing luminance-preserving shader.
  material.color.multiplyScalar(0.06);
  const state: ScreenState = { texture, color: color.clone(), time: 0, frame: 0, shared };
  screens.set(material, state);
  material.addEventListener("dispose", () => {
    if (screens.get(material) !== state) return;
    if (state.shared) state.shared.release(); else state.texture.dispose();
    screens.delete(material);
  });
  return material;
}

/** Moves an existing screen between scene pools or back to independent animation. */
export function setScreenTexturePool(material: THREE.Material, pool: ScreenTexturePool | null): void {
  const state = screens.get(material);
  if (!state || (state.shared?.pool ?? null) === pool) return;
  if (state.shared) state.shared.release(); else state.texture.dispose();
  state.shared = pool?.acquire();
  state.texture = state.shared?.texture ?? screenTexture(state.time);
  (material as ScreenMaterial).emissiveMap = state.texture;
  material.needsUpdate = true;
}

export function setScreenColor(material: THREE.Material, color: THREE.ColorRepresentation | null): void {
  const state = screens.get(material);
  if (state) (material as ScreenMaterial).emissive.copy(color === null ? state.color : new THREE.Color(color));
}

/** At most 12 updates/second per visible private screen or shared phase. No timers. */
export function updateScreen(material: THREE.Material, dt: number): void {
  const state = screens.get(material);
  if (!state || !Number.isFinite(dt) || dt <= 0) return;
  if (state.shared) { state.shared.sample(); return; }
  state.time += dt;
  const frame = Math.floor(state.time * 12);
  if (frame === state.frame) return;
  state.frame = frame;
  screenPixels(state.time, state.texture.image.data as Uint8Array);
  state.texture.needsUpdate = true;
}

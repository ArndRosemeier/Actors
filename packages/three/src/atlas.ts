import * as THREE from "three";

/** Where one texture sits in an atlas, as `uv * scale + offset` (UVs are clamped to 0..1 first). */
export interface AtlasCell {
  offset: [number, number];
  scale: number;
}

/** Several textures drawn into one (for a merged mesh: one draw instead of one per texture). */
export interface TextureAtlas {
  texture: THREE.Texture;
  /** Per source texture (null: a plain white cell, for untextured parts). */
  cells: Map<THREE.Texture | null, AtlasCell>;
  /** Drops this user's hold on the atlas; the last one disposes it. */
  release(): void;
}

const atlases = new Map<string, { atlas: TextureAtlas; users: number }>();

/** Room around each cell (share of its size) that repeats the texture's edge, so mip levels don't bleed between cells. */
const PAD = 1 / 32;

/**
 * An atlas of `textures` (null for a white cell), `size` pixels square, in a grid. Shared page-wide
 * by every caller with the same textures (characters wearing the same outfit hold one atlas).
 * Textures still loading are drawn in when they arrive. Without a DOM (tests, workers) the atlas
 * is a white 1x1 texture with the same cells.
 */
export function textureAtlas(textures: (THREE.Texture | null)[], size = 1024): TextureAtlas {
  const list = [...new Set(textures)];
  const key = `${size}|${list.map((t) => t?.uuid ?? "-").join(",")}`;
  const known = atlases.get(key);
  if (known) {
    known.users++;
    return known.atlas;
  }
  const grid = Math.max(1, Math.ceil(Math.sqrt(list.length)));
  const cell = 1 / grid;
  const cells = new Map<THREE.Texture | null, AtlasCell>();
  list.forEach((t, i) => {
    const x = (i % grid) * cell, y = Math.floor(i / grid) * cell;
    cells.set(t, { offset: [x + cell * PAD, y + cell * PAD], scale: cell * (1 - 2 * PAD) });
  });
  const canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
  let texture: THREE.Texture;
  if (canvas) {
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, size, size);
    texture = new THREE.CanvasTexture(canvas);
    const draw = (t: THREE.Texture) => {
      const image = t.image as CanvasImageSource & { width?: number; complete?: boolean };
      const { offset, scale } = cells.get(t)!;
      const px = cell * size;
      // Rows go top down in the canvas, UV v bottom up (three flips textures loaded from images).
      const x0 = offset[0] * size - px * PAD, y0 = size - (offset[1] * size - px * PAD) - px;
      ctx.clearRect(x0, y0, px, px);
      ctx.drawImage(image, x0, y0, px, px); // the pad: the image a little larger behind
      ctx.drawImage(image, offset[0] * size, size - offset[1] * size - scale * size, scale * size, scale * size);
      texture.needsUpdate = true;
    };
    for (const t of list) {
      if (!t) continue;
      const image = t.image as (HTMLImageElement & { width?: number }) | undefined;
      if (image && (image.complete === undefined || image.complete) && image.width) draw(t);
      else if (image?.addEventListener) image.addEventListener("load", () => draw(t), { once: true });
      else {
        // TextureLoader sets `image` when it arrives: check again a few times.
        let tries = 0;
        const wait = () => {
          const img = t.image as { width?: number } | undefined;
          if (img?.width) draw(t);
          else if (tries++ < 600) setTimeout(wait, 100);
        };
        setTimeout(wait, 100);
      }
    }
  } else {
    texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    texture.needsUpdate = true;
  }
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const atlas: TextureAtlas = {
    texture,
    cells,
    release() {
      const entry = atlases.get(key);
      if (!entry || --entry.users > 0) return;
      atlases.delete(key);
      texture.dispose();
    },
  };
  atlases.set(key, { atlas, users: 1 });
  return atlas;
}

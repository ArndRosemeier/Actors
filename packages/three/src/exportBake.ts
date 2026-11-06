import * as THREE from "three";

/**
 * Baking a character's look into plain textures, for glTF export.
 *
 * Much of the look lives in shader code that glTF can't carry: the skin tone,
 * blush, brows and stubble are computed per pixel, garments and hair are
 * recoloured by tint uniforms, eyes by an iris hue shift, and lashes take
 * their alpha from an `alphaMap`. Other engines would show white skin and
 * untinted cloth. `bakeLookForExport` draws each such material in UV space
 * (the mesh unwrapped flat over a render target) and reads back its base
 * colour and alpha, just before lighting, so every custom step is included.
 */

/** Edge length of the baked base colour texture. */
export interface BakeSizes {
  /** Skin (the body mesh), default 2048. */
  skin?: number;
  /** Everything else, default 1024. */
  other?: number;
}

/** Restores the materials after export. */
export type RestoreLook = () => void;

const BAKE_VERTEX = "\n// uv bake: draw the mesh unwrapped over the target\ngl_Position = vec4( uv * 2.0 - 1.0, 0.0, 1.0 );\n";
const BAKE_FRAGMENT = "gl_FragColor = vec4( diffuseColor.rgb, clamp( diffuseColor.a, 0.0, 1.0 ) );";

function needsBake(m: THREE.Material): boolean {
  const std = m as THREE.MeshStandardMaterial;
  if ((m as THREE.ShaderMaterial).isShaderMaterial || !("color" in std)) return false;
  // An alpha map glTF has no slot for (lashes).
  if (std.alphaMap) return true;
  const key = m.customProgramCacheKey();
  // Skin colour and eye iris shift are always computed in the shader.
  if (key.startsWith("actors-skin") || key.startsWith("actors-eye")) return true;
  // Garments and hair only when recoloured; otherwise map times colour exports as it is.
  const tint = m.userData.tint as { uTintMix?: { value: number } } | undefined;
  const hair = m.userData.hair as { uHairMix?: { value: number } } | undefined;
  return (tint?.uTintMix?.value ?? 0) > 0 || (hair?.uHairMix?.value ?? 0) > 0;
}

function hasUv(g: THREE.BufferGeometry): boolean {
  return !!g.getAttribute("uv");
}

/**
 * Draws `material` on `mesh` in UV space into a `size`² RGBA texture (sRGB, rows
 * top-down like an image file). Pixels no triangle covers are filled from their
 * neighbours, so filtering and mip levels don't pull in black at UV seams.
 */
function bakeOne(renderer: THREE.WebGLRenderer, mesh: THREE.Mesh, material: THREE.Material, size: number): HTMLCanvasElement {
  const target = new THREE.WebGLRenderTarget(size, size, { type: THREE.UnsignedByteType, colorSpace: THREE.SRGBColorSpace, depthBuffer: false });
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mats = ([] as THREE.Material[]).concat(mesh.material);
  // Every setting the bake changes, to put back afterwards.
  const saved = {
    onBeforeCompile: material.onBeforeCompile,
    key: material.customProgramCacheKey,
    side: material.side,
    blending: material.blending,
    transparent: material.transparent,
    alphaTest: material.alphaTest,
    alphaToCoverage: material.alphaToCoverage,
    depthTest: material.depthTest,
    depthWrite: material.depthWrite,
    visible: mats.map((m) => m.visible),
    culled: mesh.frustumCulled,
  };
  const previous = material.onBeforeCompile.bind(material);
  const previousKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, r) => {
    previous(shader, r);
    shader.vertexShader = shader.vertexShader.replace(/}\s*$/, `${BAKE_VERTEX}}`);
    shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", BAKE_FRAGMENT);
  };
  material.customProgramCacheKey = () => `${previousKey()}|uv-bake`;
  material.side = THREE.DoubleSide;
  material.blending = THREE.NoBlending;
  material.transparent = false;
  // Keep the alpha in the texture instead of cutting holes (the importer's alpha test does that).
  material.alphaTest = 0;
  material.alphaToCoverage = false;
  material.depthTest = false;
  material.depthWrite = false;
  material.needsUpdate = true;
  for (const m of mats) m.visible = m === material;
  mesh.frustumCulled = false;

  // A second pass in flat white marks which pixels the UV islands cover.
  const cover = new THREE.ShaderMaterial({
    vertexShader: `void main() { ${BAKE_VERTEX} }`,
    fragmentShader: "void main() { gl_FragColor = vec4( 1.0 ); }",
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
  });
  const coverTarget = new THREE.WebGLRenderTarget(size, size, { type: THREE.UnsignedByteType, depthBuffer: false });

  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevAutoClear = renderer.autoClear;
  const prevShadows = renderer.shadowMap.autoUpdate;
  const parent = mesh.parent;
  const pixels = new Uint8Array(size * size * 4);
  const coverage = new Uint8Array(size * size * 4);
  try {
    renderer.autoClear = true;
    renderer.shadowMap.autoUpdate = false;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(target);
    renderer.render(mesh, camera);
    renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
    const geometryOnly = new THREE.Mesh(mesh.geometry, cover);
    geometryOnly.frustumCulled = false;
    renderer.setRenderTarget(coverTarget);
    renderer.render(geometryOnly, camera);
    renderer.readRenderTargetPixels(coverTarget, 0, 0, size, size, coverage);
  } finally {
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.autoClear = prevAutoClear;
    renderer.shadowMap.autoUpdate = prevShadows;
    if (mesh.parent !== parent) parent?.add(mesh);
    material.onBeforeCompile = saved.onBeforeCompile;
    material.customProgramCacheKey = saved.key;
    material.side = saved.side;
    material.blending = saved.blending;
    material.transparent = saved.transparent;
    material.alphaTest = saved.alphaTest;
    material.alphaToCoverage = saved.alphaToCoverage;
    material.depthTest = saved.depthTest;
    material.depthWrite = saved.depthWrite;
    material.needsUpdate = true;
    mats.forEach((m, i) => (m.visible = saved.visible[i]));
    mesh.frustumCulled = saved.culled;
    target.dispose();
    coverTarget.dispose();
    cover.dispose();
  }
  dilate(pixels, coverage, size, 8);
  // Render targets read bottom row first; images store the top row first.
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const image = new ImageData(size, size);
  const row = size * 4;
  for (let y = 0; y < size; y++) image.data.set(pixels.subarray((size - 1 - y) * row, (size - y) * row), y * row);
  canvas.getContext("2d")!.putImageData(image, 0, 0);
  return canvas;
}

/** Grows the covered pixels outward `rings` times, copying the average of covered neighbours. */
export function dilate(rgba: Uint8Array, coverage: Uint8Array, size: number, rings: number): void {
  let covered = new Uint8Array(size * size);
  for (let i = 0; i < covered.length; i++) covered[i] = coverage[i * 4] > 127 ? 1 : 0;
  for (let ring = 0; ring < rings; ring++) {
    const next = covered.slice();
    let grew = false;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        if (covered[i]) continue;
        let n = 0;
        const sum = [0, 0, 0, 0];
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= size) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= size || !covered[yy * size + xx]) continue;
            const j = (yy * size + xx) * 4;
            for (let c = 0; c < 4; c++) sum[c] += rgba[j + c];
            n++;
          }
        }
        if (!n) continue;
        for (let c = 0; c < 4; c++) rgba[i * 4 + c] = Math.round(sum[c] / n);
        next[i] = 1;
        grew = true;
      }
    }
    covered = next;
    if (!grew) break;
  }
}

/**
 * Bakes the look of every mesh under `root` whose material computes its colour
 * in shader code (or uses an alpha map) into a plain base colour texture, and
 * swaps it in: `map` = the bake, `color` = white, no `alphaMap`. Call the
 * returned function after export to put the live materials back.
 *
 * `renderer` should be the WebGL renderer the character is drawn with: some
 * skin inputs (blended photo skins) are its render targets.
 */
export function bakeLookForExport(root: THREE.Object3D, renderer: THREE.WebGLRenderer, sizes: BakeSizes = {}): RestoreLook {
  const restores: (() => void)[] = [];
  const baked = new Map<THREE.Material, THREE.Texture>();
  const skinSize = sizes.skin ?? 2048;
  const otherSize = sizes.other ?? 1024;
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible || !hasUv(mesh.geometry)) return;
    for (const material of ([] as THREE.Material[]).concat(mesh.material)) {
      if (baked.has(material) || !needsBake(material)) continue;
      const skin = material.customProgramCacheKey().startsWith("actors-skin");
      const canvas = bakeOne(renderer, mesh, material, skin ? skinSize : otherSize);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
      baked.set(material, texture);
      const std = material as THREE.MeshStandardMaterial;
      const saved = { map: std.map, color: std.color.clone(), alphaMap: std.alphaMap ?? null };
      std.map = texture;
      std.color.setRGB(1, 1, 1);
      if ("alphaMap" in std) std.alphaMap = null;
      restores.push(() => {
        std.map = saved.map;
        std.color.copy(saved.color);
        if ("alphaMap" in std) std.alphaMap = saved.alphaMap;
        texture.dispose();
      });
    }
  });
  return () => {
    for (const r of restores.reverse()) r();
  };
}

/**
 * A copy of a garment geometry with the triangles cut along `clipValue` = 0
 * (the smooth hems the live shader cuts per pixel): faces entirely below zero
 * go, faces across the line are split at it. Other engines get the same hems
 * from plain triangles. Returns null when there's nothing to cut.
 */
export function cutClippedGeometry(g: THREE.BufferGeometry): THREE.BufferGeometry | null {
  const clipAttr = g.getAttribute("clipValue") as THREE.BufferAttribute | undefined;
  const index = g.getIndex();
  if (!clipAttr || !index || g.groups.length > 1) return null;
  const clip = (i: number) => clipAttr.getX(i);
  const start = Math.max(0, g.drawRange.start);
  const end = Math.min(index.count, g.drawRange.count === Infinity ? index.count : start + g.drawRange.count);
  let anyBelow = false;
  for (let i = start; i < end; i++) if (clip(index.getX(i)) < 0) { anyBelow = true; break; }
  if (!anyBelow) return null;

  const names = Object.keys(g.attributes).filter((n) => n !== "clipValue");
  const attrs = names.map((n) => g.getAttribute(n) as THREE.BufferAttribute);
  const morphSource = g.morphAttributes as Record<string, THREE.BufferAttribute[]>;
  const morphNames = Object.keys(morphSource);
  const morphs = morphNames.map((n) => morphSource[n]);
  // Skin influences can't be blended between unrelated bone lists: a new vertex takes its nearer end's.
  const nearest = new Set(["skinIndex", "skinWeight"]);
  const out = attrs.map((a) => Array.from({ length: a.count * a.itemSize }, (_, k) => a.getComponent(Math.floor(k / a.itemSize), k % a.itemSize)));
  const outMorph = morphs.map((list) => list.map((a) => Array.from({ length: a.count * a.itemSize }, (_, k) => a.getComponent(Math.floor(k / a.itemSize), k % a.itemSize))));
  let count = clipAttr.count;
  const split = new Map<string, number>();
  const edgeVertex = (a: number, b: number): number => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const known = split.get(key);
    if (known !== undefined) return known;
    const t = clip(a) / (clip(a) - clip(b));
    const lerp = (arr: number[], size: number, near: boolean) => {
      for (let c = 0; c < size; c++) {
        const va = arr[a * size + c];
        const vb = arr[b * size + c];
        arr.push(near ? (t < 0.5 ? va : vb) : va + (vb - va) * t);
      }
    };
    attrs.forEach((at, k) => lerp(out[k], at.itemSize, nearest.has(names[k])));
    morphs.forEach((list, k) => list.forEach((at, m) => lerp(outMorph[k][m], at.itemSize, false)));
    split.set(key, count);
    return count++;
  };
  const tris: number[] = [];
  for (let i = start; i + 2 < end; i += 3) {
    const v = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    const keep = v.map((x) => clip(x) >= 0);
    const kept = keep.filter(Boolean).length;
    if (kept === 3) { tris.push(...v); continue; }
    if (kept === 0) continue;
    // Walk the triangle's edges (keeping winding), emitting kept corners and the crossings.
    const poly: number[] = [];
    for (let e = 0; e < 3; e++) {
      const a = v[e];
      const b = v[(e + 1) % 3];
      if (keep[e]) poly.push(a);
      if (keep[e] !== keep[(e + 1) % 3]) poly.push(edgeVertex(a, b));
    }
    for (let k = 1; k + 1 < poly.length; k++) tris.push(poly[0], poly[k], poly[k + 1]);
  }
  const cut = new THREE.BufferGeometry();
  attrs.forEach((a, k) => {
    const Typed = (a.array as unknown as { constructor: new (n: number[]) => THREE.TypedArray }).constructor;
    cut.setAttribute(names[k], new THREE.BufferAttribute(new Typed(out[k]), a.itemSize, a.normalized));
  });
  morphNames.forEach((n, k) => {
    (cut.morphAttributes as Record<string, THREE.BufferAttribute[]>)[n] = morphs[k].map((a, m) => new THREE.BufferAttribute(new Float32Array(outMorph[k][m]), a.itemSize, a.normalized));
  });
  cut.morphTargetsRelative = g.morphTargetsRelative;
  cut.setIndex(tris);
  cut.computeBoundingBox();
  cut.computeBoundingSphere();
  return cut;
}

/** Swaps every garment under `root` for its hem-cut copy (see cutClippedGeometry); returns the undo. */
export function cutHemsForExport(root: THREE.Object3D): RestoreLook {
  const restores: (() => void)[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    const cut = cutClippedGeometry(mesh.geometry);
    if (!cut) return;
    const original = mesh.geometry;
    mesh.geometry = cut;
    restores.push(() => {
      mesh.geometry = original;
      cut.dispose();
    });
  });
  return () => {
    for (const r of restores.reverse()) r();
  };
}

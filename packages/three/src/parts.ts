import * as THREE from "three";
import type { PartMesh } from "@actors/core";
import { useDualQuaternionSkinning } from "./dqs";
import { addMorphAttributes } from "./morphs";
import { fabricNormalMap } from "./procedural";
import { createAlphaDepthMaterial, createDepthMaterial, createSkinMaterial, type SkinUniforms } from "./materials";

/** Small deterministic PRNG so the generated textures are identical on every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let strands: THREE.DataTexture | undefined;
/** Hair-card texture: light grey strands across u, thinning out toward the tip (v = 1). */
export function strandTexture(): THREE.DataTexture {
  if (strands) return strands;
  const W = 256, H = 128;
  const data = new Uint8Array(W * H * 4);
  const r = rng(7);
  const list = Array.from({ length: 70 }, () => ({ x: r() * W, w: 0.8 + r() * 1.6, len: 0.65 + r() * 0.35, b: 0.75 + r() * 0.25, wave: r() * 6 }));
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    for (let x = 0; x < W; x++) {
      let a = 0, c = 0;
      for (const s of list) {
        if (v > s.len) continue;
        let d = Math.abs(x - s.x - Math.sin(v * 4 + s.wave) * 2);
        d = Math.min(d, W - d);
        const w = s.w * (1 - 0.6 * (v / s.len));
        const k = Math.max(0, 1 - d / w);
        if (k > a) {
          a = k;
          c = s.b;
        }
      }
      const o = (y * W + x) * 4;
      const g = Math.round(c * 235);
      data[o] = data[o + 1] = data[o + 2] = g;
      data[o + 3] = Math.round(Math.min(1, a * 1.6) * 255);
    }
  }
  strands = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  strands.colorSpace = THREE.SRGBColorSpace;
  strands.wrapS = THREE.RepeatWrapping;
  strands.magFilter = THREE.LinearFilter;
  strands.minFilter = THREE.LinearMipmapLinearFilter;
  strands.generateMipmaps = true;
  strands.needsUpdate = true;
  return strands;
}

let leaf: THREE.DataTexture | undefined;
/** One leaf per card: pointed oval silhouette with a midrib and side veins (u across, v from stem to tip). */
export function leafTexture(): THREE.DataTexture {
  if (leaf) return leaf;
  const W = 64, H = 128;
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    const half = 0.46 * Math.pow(Math.sin(Math.min(1, v * 1.05) * Math.PI), 0.75);
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W - 0.5;
      const inside = Math.abs(u) < half && v > 0.04;
      const rib = Math.abs(u) < 0.025 ? 0.7 : 1;
      const vein = Math.abs(Math.sin((v * 9 - Math.abs(u) * 6) * Math.PI)) < 0.12 ? 0.85 : 1;
      const edge = half > 0 ? Math.abs(u) / half : 1;
      const o = (y * W + x) * 4;
      const g = Math.round(220 * rib * vein * (1 - 0.2 * edge));
      data[o] = data[o + 1] = data[o + 2] = g;
      data[o + 3] = inside ? 255 : 0;
    }
  }
  leaf = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  leaf.colorSpace = THREE.SRGBColorSpace;
  leaf.magFilter = THREE.LinearFilter;
  leaf.minFilter = THREE.LinearMipmapLinearFilter;
  leaf.generateMipmaps = true;
  leaf.needsUpdate = true;
  return leaf;
}

/** Robot part kinds (see `@actors/human` robot.ts). */
export const ROBOT_PART_KINDS = ["plate", "trim", "frame", "joint", "visor", "glow"] as const;

let ribs: THREE.Texture | undefined;
/** Fine ribbing for the robot's inner frame (synthetic muscle), on the body UVs. */
function frameNormalMap(): THREE.Texture {
  if (!ribs) {
    ribs = fabricNormalMap("knit").clone();
    ribs.wrapS = ribs.wrapT = THREE.RepeatWrapping;
    ribs.repeat.set(10, 10);
    ribs.needsUpdate = true;
  }
  return ribs;
}

/**
 * Physical-material settings for a robot or skeleton part kind, shared by the WebGL and
 * node kits. Colours and finish are changed later with `ThreeActor.setPartColor`
 * and `setPartMaterial`; "glow" parts take their colour as emissive
 * (`userData.emissiveTint`).
 */
export function robotMaterialParams(kind: string): THREE.MeshPhysicalMaterialParameters | null {
  switch (kind) {
    case "plate":
    case "trim":
      return { color: 0xd8dade, vertexColors: true, metalness: 0.35, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.12 };
    case "frame":
      return { color: 0x22252b, roughness: 0.5, metalness: 0.35, normalMap: frameNormalMap(), normalScale: new THREE.Vector2(0.6, 0.6) };
    case "joint":
      return { color: 0x9aa0a8, vertexColors: true, metalness: 1, roughness: 0.28 };
    case "visor":
      return { color: 0x07090c, metalness: 0.4, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02 };
    case "glow":
      return { color: 0x000000, emissive: 0x44d8ff, emissiveIntensity: 2.5, roughness: 0.3 };
    // Skeleton bones (see `@actors/human` skeletal.ts): dry, slightly waxy; stains and cavities are in the vertex shade.
    case "bone":
      return { color: 0xe2d6bc, vertexColors: true, metalness: 0, roughness: 0.62, clearcoat: 0.12, clearcoatRoughness: 0.5, sheen: 0.25, sheenRoughness: 0.6, sheenColor: 0xfff2dc };
  }
  return null;
}

/** Material for a generated part. Skin-like parts share the actor's skin uniforms (colour, photo albedo, pattern). */
export function createPartMaterial(part: PartMesh, skin: SkinUniforms): THREE.Material {
  const color = new THREE.Color().setRGB(...(part.color ?? [0.3, 0.2, 0.12]), THREE.SRGBColorSpace);
  const robot = robotMaterialParams(part.kind);
  if (robot) {
    const m = useDualQuaternionSkinning(new THREE.MeshPhysicalMaterial(robot));
    if (part.kind === "glow") m.userData.emissiveTint = true;
    return m;
  }
  switch (part.kind) {
    case "skin":
      return createSkinMaterial(skin);
    case "fin": {
      const m = createSkinMaterial(skin);
      m.side = THREE.DoubleSide;
      return m;
    }
    case "hair":
    case "leaf": {
      const mat = useDualQuaternionSkinning(
        new THREE.MeshPhysicalMaterial({
          color,
          map: part.kind === "leaf" ? leafTexture() : strandTexture(),
          vertexColors: true,
          alphaTest: 0.35,
          alphaToCoverage: true,
          side: THREE.DoubleSide,
          roughness: part.kind === "leaf" ? 0.6 : 0.55,
          sheen: part.kind === "leaf" ? 0.2 : 0.6,
          sheenRoughness: 0.35,
          sheenColor: new THREE.Color(0.35, 0.3, 0.25),
          specularIntensity: 0.35,
        }),
      );
      mat.userData.alphaShadow = true;
      return mat;
    }
    case "fur":
      return useDualQuaternionSkinning(new THREE.MeshStandardMaterial({ color, vertexColors: true, roughness: 0.9 }));
    case "tusk":
      return useDualQuaternionSkinning(new THREE.MeshPhysicalMaterial({ color, vertexColors: true, roughness: 0.35, clearcoat: 0.4, clearcoatRoughness: 0.3 }));
    default:
      return useDualQuaternionSkinning(new THREE.MeshPhysicalMaterial({ color, vertexColors: true, roughness: 0.45, clearcoat: 0.25, clearcoatRoughness: 0.4 }));
  }
}

/** A part's geometry: positions, normals, uvs, shade (vertex colour), skinning and, for skin-following parts, two face-morph channels. */
export function createPartGeometry(part: PartMesh, attributeMorphs = false): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(part.positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(part.normals, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(part.uvs, 2));
  const shade = new Float32Array(part.shade.length * 3);
  for (let i = 0; i < part.shade.length; i++) shade[i * 3] = shade[i * 3 + 1] = shade[i * 3 + 2] = part.shade[i];
  g.setAttribute("color", new THREE.BufferAttribute(shade, 3));
  g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(part.joints, 4));
  g.setAttribute("skinWeight", new THREE.BufferAttribute(part.weights, 4));
  g.setIndex(new THREE.BufferAttribute(part.indices, 1));
  // Parts that follow the skin in face morphs get the two morph channels (see ThreeActor.MORPHS).
  if (part.anchors) {
    const n = part.positions.length;
    if (attributeMorphs) addMorphAttributes(g, n / 3, 2, false);
    else {
      g.morphAttributes.position = [0, 1].map(() => new THREE.BufferAttribute(new Float32Array(n), 3));
      g.morphTargetsRelative = true;
    }
  }
  return g;
}

/** A skinned three.js mesh for a part (bind it to the actor's skeleton). `material` defaults to the WebGL one; `depth` is its shadow-map material, if it needs one. */
export function createPartMesh(part: PartMesh, skin: SkinUniforms, material: THREE.Material = createPartMaterial(part, skin), depth?: THREE.Material | null, attributeMorphs = false): THREE.SkinnedMesh {
  const mesh = new THREE.SkinnedMesh(createPartGeometry(part, attributeMorphs), material);
  mesh.name = part.name;
  mesh.userData.partKind = part.kind;
  if (part.anchors) {
    mesh.userData.anchors = part.anchors;
    if (attributeMorphs) mesh.morphTargetInfluences = [0, 0];
    else mesh.updateMorphTargets();
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (depth === undefined) {
    const map = (material as THREE.MeshPhysicalMaterial).map;
    mesh.customDepthMaterial = map ? createAlphaDepthMaterial(map) : createDepthMaterial();
  } else if (depth) mesh.customDepthMaterial = depth;
  mesh.frustumCulled = false;
  return mesh;
}

import * as THREE from "three";
import {
  type ActorRuntime,
  type ActorShape,
  type AxisClip,
  type Clip,
  type FittedSkeleton,
  type Pose,
  type LodDef,
  type MergedMesh,
  type MeshData,
  type PartMesh,
  Retargeter,
  type SurfaceDelta,
  bakeAxisClip,
  drawnAt,
  fillMerged,
  lodBoneMap,
  lodForDistance,
  lodIndices,
  lodLevels,
  mergeMeshes,
} from "@actors/core";
import {
  type ClothTintUniforms,
  type EyeUniforms,
  IRIS_PRESETS,
  type SkinUniforms,
  createClothMaterial,
  createDepthMaterial,
  createEyeMaterial,
  createLashMaterial,
  createHairMaterial,
  createAlphaDepthMaterial,
  createSkinMaterial,
  createSkinUniforms,
  createWetMaterial,
  useClipAttribute,
} from "./materials";
import { SkinComposer } from "./skincompose";
import { type ColliderUniforms, MAX_COLLIDERS, createColliderUniforms, useColliders } from "./colliders";
import { createPartMaterial, createPartMesh } from "./parts";
import { createCrowdMaterial } from "./crowd";
import { garmentLayer } from "./layers";

export * from "./materials";
export * from "./dqs";
export * from "./procedural";
export * from "./skincompose";
export * from "./colliders";
export * from "./racepatterns";
export * from "./parts";
export * from "./crowd";
export * from "./fur";
export * from "./drone";

export interface MaterialFactory {
  (mesh: MeshData, actor: ThreeActor): THREE.Material;
}

/** Default materials from the pack's material hints. Swap in your own via the constructor. */
export const defaultMaterials: MaterialFactory = (data, actor) => {
  const { def } = data;
  const color = new THREE.Color(...(def.material.color ?? [0.8, 0.8, 0.8]));
  const tex = (key: "color" | "normal" | "maskA" | "maskB", srgb = false) => {
    const file = def.textures?.[key];
    if (!file) return null;
    return actor.texture(file, srgb);
  };
  switch (def.material.kind) {
    case "skin": {
      const u = actor.skin;
      u.uMaskA.value ??= tex("maskA");
      u.uMaskB.value ??= tex("maskB");
      return createSkinMaterial(u);
    }
    case "eye":
      return createEyeMaterial(tex("color", true), actor.eye);
    case "teeth":
      return createWetMaterial(new THREE.Color(0.92, 0.89, 0.8), 0.25);
    case "mouth":
      return createWetMaterial(new THREE.Color(0.75, 0.38, 0.38), 0.4);
    case "hair":
      if (def.textures?.color) {
        const mat = createHairMaterial(tex("color", true), def.tags?.includes("brows"));
        mat.userData.meanColor = new THREE.Color().setRGB(...(def.material.color ?? [0.3, 0.2, 0.1]), THREE.SRGBColorSpace);
        return mat;
      }
      return createLashMaterial(new THREE.Color(0.05, 0.035, 0.03));
    case "cloth": {
      const fabric = def.tags?.find((t) => t.startsWith("fabric:"))?.slice(7) ?? "smooth";
      // Garments follow their own layer order: proxies (socks) over base garments (tights), outerwear over underwear.
      const layer = garmentLayer(def);
      // Textured garments store their texture's mean colour (sRGB); plain ones their linear colour.
      const mean = def.textures?.color ? new THREE.Color().setRGB(...(def.material.color ?? [0.5, 0.5, 0.5]), THREE.SRGBColorSpace) : color;
      const meanLum = 0.2126 * mean.r + 0.7152 * mean.g + 0.0722 * mean.b;
      let mat = createClothMaterial(color, def.material.roughness ?? 0.7, fabric, layer, tex("color", true), tex("normal"), meanLum);
      if (data.clip) mat = useClipAttribute(mat);
      // Skirt-skinned garments hang between the legs; leg capsules keep the legs from piercing them.
      const blended = def.source.kind === "proxy" && actor.runtime.manifest.proxies.find((p) => p.name === (def.source as { proxy: string }).proxy)?.legBlend;
      return blended ? useColliders(mat, actor.colliders) : mat;
    }
    default:
      return new THREE.MeshStandardMaterial({ color, roughness: def.material.roughness ?? 0.6 });
  }
};

/**
 * Everything renderer-specific about how an actor is drawn. `webglMaterials`
 * (the default) patches three's WebGL materials; `@actors/three/webgpu`
 * exports `nodeMaterials` for three's WebGPURenderer (node materials, both
 * of its backends).
 */
export interface ActorMaterialKit {
  /** Material for a pack mesh (body, eyes, hair, garments...). */
  mesh: MaterialFactory;
  /** Material for a generated add-on (horns, beards, tails...). */
  part(part: PartMesh, actor: ThreeActor): THREE.Material;
  /**
   * Shadow-map material for a mesh drawn with `material`, when the shadow pass
   * needs its own (WebGL: dual-quaternion skinning, hem cuts, alpha cards).
   * Null: the material casts its own shadow.
   */
  depth(material: THREE.Material, clip: boolean): THREE.Material | null;
  /** Shows a blend of photographic skins (same UV layout; loaded textures, weights summing to 1) as the skin's albedo. */
  blendSkins(actor: ThreeActor, layers: { texture: THREE.Texture; weight: number }[], renderer: unknown): void;
  /**
   * Material of a merged crowd mesh (see `LodDef.merge`): vertex colours for
   * garments (attribute `color`), the skin's tone or photo skin where the
   * float attribute `crowdSkin` is 1, cut away where the interpolated
   * `crowdClip` is below 0 (garment hems). Default: the WebGL one (`createCrowdMaterial`).
   */
  crowd?(actor: ThreeActor): THREE.Material;
  /** Frees what the kit holds for an actor that is going away (e.g. its share of a composed skin). */
  release?(actor: ThreeActor): void;
}

const sharedDepth = new WeakMap<object, THREE.Material>();

/** Composed photo skins by blend (see webglMaterials.blendSkins), with the number of actors showing each. */
const composedSkins = new Map<string, { composer: SkinComposer; users: number }>();
function releaseSkin(key: string | undefined): void {
  const shared = key === undefined ? undefined : composedSkins.get(key);
  if (!shared || --shared.users > 0) return;
  shared.composer.dispose();
  composedSkins.delete(key!);
}

/** The WebGL kit: three's built-in materials with GLSL patches (see materials.ts). */
export const webglMaterials: ActorMaterialKit = {
  mesh: defaultMaterials,
  part: (part, actor) => createPartMaterial(part, actor.skin),
  depth(material, clip) {
    const hairMap = material.userData.alphaShadow ? (material as THREE.MeshPhysicalMaterial).map : null;
    if (hairMap) return createAlphaDepthMaterial(hairMap);
    if (clip) return useClipAttribute(createDepthMaterial());
    let d = sharedDepth.get(webglMaterials);
    if (!d) sharedDepth.set(webglMaterials, (d = createDepthMaterial()));
    return d;
  },
  crowd: (actor) => createCrowdMaterial(actor.skin),
  blendSkins(actor, layers, renderer) {
    // Actors with (nearly) the same blend share one composed texture: a 2k render target each would add up fast.
    const key = layers.map((l) => `${l.texture.uuid}:${l.weight.toFixed(2)}`).join("|");
    const previous = actor.userData.skinBlend as string | undefined;
    if (previous === key) return;
    let shared = composedSkins.get(key);
    const own = previous === undefined ? undefined : composedSkins.get(previous);
    if (!shared && own?.users === 1) {
      // Nobody else shows the old blend (e.g. while an age slider moves): recompose in place.
      composedSkins.delete(previous!);
      own.composer.compose(renderer as THREE.WebGLRenderer, layers);
      composedSkins.set(key, own);
    } else {
      if (!shared) {
        shared = { composer: new SkinComposer(), users: 0 };
        shared.composer.compose(renderer as THREE.WebGLRenderer, layers);
        composedSkins.set(key, shared);
      }
      shared.users++;
      releaseSkin(previous);
    }
    shared ??= own!;
    actor.userData.skinBlend = key;
    actor.skin.uAlbedo.value = shared.composer.target.texture;
  },
  release(actor) {
    releaseSkin(actor.userData.skinBlend as string | undefined);
    delete actor.userData.skinBlend;
  },
};

/** Pack textures, shared by every actor on the page (by URL and colour space). */
const packTextures = new Map<string, THREE.Texture>();
/** Photographic skin sources (see setSkinTextures), shared the same way. */
const skinTextures = new Map<string, Promise<THREE.Texture>>();
const textureLoader = new THREE.TextureLoader();

export type PlayableClip = AxisClip | Clip;
const isRetargetClip = (c: PlayableClip): c is Clip => "def" in c;

/**
 * three.js view of an ActorRuntime: one SkinnedMesh per pack mesh, all sharing
 * one skeleton. Call `applyShape()` whenever the shape changes; the skeleton
 * is re-fitted and meshes are re-bound in place, so animation keeps playing.
 *
 * Extras: dual-quaternion skinning on every material, retargeted mocap
 * playback, two GPU morph channels for the face ("expression" and "blink")
 * and slot-based visibility (only one mesh per slot is shown).
 */
export class ThreeActor {
  readonly object = new THREE.Group();
  readonly meshes = new Map<string, THREE.SkinnedMesh>();
  readonly bones: THREE.Bone[] = [];
  /** Shared skeleton: the pack's bones, then extra bones added by parts (tails). Replaced when parts add bones. */
  skeleton?: THREE.Skeleton;
  /** Number of pack bones at the start of `bones`. */
  private packBones = 0;
  /** Extra bones (from parts) and their bind-pose heads in model space. */
  private readonly extraHeads = new Map<THREE.Bone, THREE.Vector3>();
  /** Last face-morph deltas per channel (re-applied to parts built later). */
  private readonly lastDeltas = new Map<string, SurfaceDelta | null>();
  readonly mixer: THREE.AnimationMixer;
  readonly skin: SkinUniforms = createSkinUniforms();
  /** Leg capsules for skirt-like garments, updated every frame from the bones. */
  readonly colliders: ColliderUniforms = createColliderUniforms();
  private legRadii = new Map<string, number>();
  readonly eye: EyeUniforms = { uIrisHue: { value: -1 }, uIrisSat: { value: 1 }, uIrisLight: { value: 1 }, uPupil: { value: new THREE.Vector4(0, 0.5, 0, 0) } };
  /** Morph channels for face animation (GPU-blended every frame). */
  static readonly MORPHS = ["expression", "blink"] as const;
  /** Play mocap in place (no root translation) by default, for previews. */
  inPlace = true;
  private fitted?: FittedSkeleton;
  private clip?: PlayableClip;
  private action?: THREE.AnimationAction;
  private lastShape?: ActorShape;
  private readonly data = new Map<string, MeshData>();
  /** Meshes that are drawn (internal helper meshes are skipped). */
  private readonly rendered: MeshData[];
  private readonly slotsSeen = new Set<string>();
  /** How this actor is drawn (see ActorMaterialKit). */
  readonly kit: ActorMaterialKit;
  /** Free for the kit (e.g. the WebGL skin compositor). */
  readonly userData: Record<string, unknown> = {};
  /** The pack's detail levels (see `setLod`). */
  readonly lods: LodDef[];
  private level = 0;
  /** Crowd level: body and garments merged into one mesh (see LodDef.merge). */
  private crowd?: { mesh: THREE.SkinnedMesh; merged: MergedMesh };
  /** Meshes that should be drawn at the current level (before crowd merging). */
  private readonly shown = new Set<string>();

  /** `materials`: a kit (`webglMaterials`, the default, or `nodeMaterials` from `@actors/three/webgpu`), or just a mesh material factory for WebGL. */
  constructor(
    readonly runtime: ActorRuntime,
    materials: MaterialFactory | ActorMaterialKit = webglMaterials,
  ) {
    this.kit = typeof materials === "function" ? { ...webglMaterials, mesh: materials } : materials;
    this.lods = lodLevels(runtime.manifest);
    this.rendered = runtime.meshes.filter((m) => !m.def.internal);
    const skel = runtime.manifest.skeleton;
    if (skel) {
      for (const b of skel.bones) {
        const bone = new THREE.Bone();
        bone.name = b.name;
        this.bones.push(bone);
      }
      skel.bones.forEach((b, i) => (b.parent >= 0 ? this.bones[b.parent].add(this.bones[i]) : this.object.add(this.bones[i])));
      this.skeleton = new THREE.Skeleton(this.bones);
      this.packBones = this.bones.length;
    }
    const genitals = (runtime.manifest.extra?.human as { anatomy?: { genitalsUV: number[] } } | undefined)?.anatomy?.genitalsUV;
    if (genitals) this.skin.uGenitalBox.value.fromArray(genitals);

    this.addMeshes(this.rendered.splice(0));
    this.mixer = new THREE.AnimationMixer(this.object);
  }

  /**
   * Creates scene meshes for mesh data loaded after construction (see
   * `ActorRuntime.loadMeshes`). They start hidden if optional; apply a shape
   * that includes them (re-evaluate) before showing them.
   */
  addMeshes(list: MeshData[]): void {
    for (const data of list) {
      if (data.def.internal || this.data.has(data.def.name)) continue;
      this.rendered.push(data);
      this.data.set(data.def.name, data);
      // Optional meshes start hidden; of several meshes in a slot, the first is shown.
      const slot = data.def.slot;
      const visible = !data.def.optional && !(slot && this.slotsSeen.has(slot));
      if (slot && visible) this.slotsSeen.add(slot);
      this.wanted.set(data.def.name, visible);
      // Scene meshes (and their buffers) are only made for what is shown: a garment or hairstyle
      // nobody wears costs nothing (see ensureMesh).
      if (visible) this.ensureMesh(data);
    }
    this.visDirty = true;
    if (this.level > 0) this.flushVisibility();
  }

  /** Whether a shape includes the surface a mesh follows (garments are only fitted when needed, see `neededMeshes`). */
  private includes(shape: ActorShape, data: MeshData): boolean {
    if (data.stencil) return shape.meshes.has(data.def.name);
    return data.def.source.kind === "base" || shape.proxies.has(data.def.source.proxy);
  }

  /**
   * Names of the meshes a shape is needed for: everything that is or would be drawn (worn
   * garments, the chosen hair, the body and its stand-ins). Pass them to `Human.fit`.
   */
  neededMeshes(): string[] {
    const out = new Set<string>();
    for (const [n, d] of this.data) {
      if (!this.wanted.get(n)) continue;
      out.add(n);
      // Stand-ins drawn at other detail levels (the low body, the crowd body).
      for (const [m, e] of this.data) if (e.def.lodOf === n) out.add(m);
      if (d.def.lodOf) out.add(d.def.lodOf);
    }
    return [...out];
  }

  /** The scene mesh of a mesh, made on first use (filled from the last shape when it includes it). */
  private ensureMesh(data: MeshData): THREE.SkinnedMesh {
    const existing = this.meshes.get(data.def.name);
    if (existing) return existing;
    const materials = this.kit.mesh;
    {
      const n = data.map.length;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute("uv", new THREE.BufferAttribute(data.uv, 2));
      if (data.joints && data.weights) {
        g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(data.joints, 4));
        g.setAttribute("skinWeight", new THREE.BufferAttribute(data.weights, 4));
      }
      if (data.clip) g.setAttribute("clipValue", new THREE.BufferAttribute(data.clip.slice(), 1));
      // Extra per-vertex data from the pack (e.g. fur flow and coat regions), under its own name.
      for (const [name, attr] of Object.entries(data.attributes ?? {})) g.setAttribute(name, new THREE.BufferAttribute(attr.array, attr.size));
      g.setIndex(new THREE.BufferAttribute(data.indices, 1));
      // Face morph channels only on base-following meshes (body, lashes, teeth...), not garments.
      const morphable = data.def.source.kind === "base" && data.def.role !== "garment";
      if (morphable) {
        g.morphAttributes.position = ThreeActor.MORPHS.map(() => new THREE.BufferAttribute(new Float32Array(n * 3), 3));
        g.morphAttributes.normal = ThreeActor.MORPHS.map(() => new THREE.BufferAttribute(new Float32Array(n * 3), 3));
        g.morphTargetsRelative = true;
      }
      const mesh = new THREE.SkinnedMesh(g, materials(data, this));
      mesh.name = data.def.name;
      if (morphable) mesh.updateMorphTargets();
      const transparent = (mesh.material as THREE.Material).transparent;
      mesh.castShadow = !transparent;
      mesh.receiveShadow = true;
      const depth = transparent ? null : this.kit.depth(mesh.material as THREE.Material, !!data.clip);
      if (depth) mesh.customDepthMaterial = depth;
      mesh.frustumCulled = false; // bounds change with morphs and animation
      mesh.visible = false;
      this.object.add(mesh);
      this.meshes.set(data.def.name, mesh);
      if (this.skeleton) mesh.bind(this.skeleton, new THREE.Matrix4());
      const tint = this.tints.get(data.def.name);
      if (tint !== undefined) this.setGarmentColor(data.def.name, tint);
      if (this.hairColor !== undefined && data.def.role === "hair") this.setHairColor(this.hairColor);
      if (this.lastShape && this.includes(this.lastShape, data)) this.writePositions(data, this.lastShape);
      if (morphable) for (const [channel, delta] of this.lastDeltas) this.fillMorph(mesh, data, ThreeActor.MORPHS.indexOf(channel as (typeof ThreeActor.MORPHS)[number]), delta);
      return mesh;
    }
  }

  /** Generated add-ons (horns, beards, tails...; see `Human.parts`), by name. */
  readonly parts = new Map<string, THREE.SkinnedMesh>();

  /**
   * Replaces the generated add-on meshes. Build them from the shape last given
   * to `applyShape`, so they match the skeleton's bind pose.
   */
  setParts(parts: PartMesh[]): void {
    for (const mesh of this.parts.values()) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.parts.clear();
    // Extra bones (tail chains): replace the previous ones, then rebuild the skeleton.
    const hadExtra = this.extraHeads.size > 0;
    for (const bone of this.extraHeads.keys()) bone.removeFromParent();
    this.extraHeads.clear();
    this.bones.length = this.packBones;
    for (const part of parts)
      for (const b of part.bones ?? []) {
        const parent = this.bones.find((x) => x.name === b.parent);
        if (!parent) throw new Error(`Part ${part.name}: unknown parent bone ${b.parent}`);
        const bone = new THREE.Bone();
        bone.name = b.name;
        parent.add(bone);
        this.bones.push(bone);
        this.extraHeads.set(bone, new THREE.Vector3(...b.head));
      }
    const skeletonChanged = hadExtra || this.extraHeads.size > 0;
    if (skeletonChanged && this.skeleton) this.skeleton = new THREE.Skeleton(this.bones);
    for (const part of parts) {
      const material = this.kit.part(part, this);
      const mesh = createPartMesh(part, this.skin, material, this.kit.depth(material, false));
      this.object.add(mesh);
      this.parts.set(part.name, mesh);
      if (this.skeleton && !skeletonChanged) mesh.bind(this.skeleton, new THREE.Matrix4());
    }
    if (skeletonChanged && this.fitted) this.rebind(this.fitted);
    // Face morphs: parts that follow the skin get the current deltas and weights.
    for (const [channel, delta] of this.lastDeltas) this.setPartMorph(channel as (typeof ThreeActor.MORPHS)[number], delta);
    const body = [...this.meshes.values()].find((m) => m.morphTargetInfluences);
    for (const mesh of this.parts.values()) if (mesh.morphTargetInfluences && body) mesh.morphTargetInfluences.splice(0, 2, ...body.morphTargetInfluences!);
  }

  private setPartMorph(channel: (typeof ThreeActor.MORPHS)[number], delta: SurfaceDelta | null): void {
    const k = ThreeActor.MORPHS.indexOf(channel);
    for (const mesh of this.parts.values()) {
      const anchors = mesh.userData.anchors as Uint32Array | undefined;
      const g = mesh.geometry;
      if (!anchors || !g.morphAttributes.position) continue;
      const mp = g.morphAttributes.position[k].array as Float32Array;
      mp.fill(0);
      if (delta)
        for (let i = 0; i < anchors.length; i++) {
          const a = anchors[i];
          if (a === 0xffffffff) continue;
          mp[i * 3] = delta.positions[a * 3];
          mp[i * 3 + 1] = delta.positions[a * 3 + 1];
          mp[i * 3 + 2] = delta.positions[a * 3 + 2];
        }
      g.dispose();
    }
  }

  /** Colour (sRGB hex or THREE.Color) of the generated parts of the given kinds (e.g. ["hair", "leaf"] for the hair colour). */
  setPartColor(kinds: string[], color: THREE.ColorRepresentation): void {
    for (const mesh of this.parts.values()) {
      if (!kinds.includes(mesh.userData.partKind)) continue;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      (mat.userData.emissiveTint ? mat.emissive : mat.color).set(color);
    }
  }

  /** Surface settings (metalness, roughness, clearcoat, emissiveIntensity...) of the generated parts of the given kinds. */
  setPartMaterial(kinds: string[], settings: Partial<Pick<THREE.MeshPhysicalMaterial, "metalness" | "roughness" | "clearcoat" | "clearcoatRoughness" | "emissiveIntensity">>): void {
    for (const mesh of this.parts.values()) if (kinds.includes(mesh.userData.partKind)) Object.assign(mesh.material as THREE.MeshPhysicalMaterial, settings);
  }

  private packHidden = false;

  /** Hides every pack mesh (body, eyes, hair, garments...), e.g. while generated robot parts stand in for the body. */
  hidePackMeshes(hidden: boolean): void {
    if (hidden === this.packHidden) return;
    this.packHidden = hidden;
    this.visDirty = true;
  }

  /** A texture shipped with the pack (loaded, decoded and uploaded once per page; every actor shares it). */
  texture(file: string, srgb = false): THREE.Texture {
    const key = `${srgb ? "srgb" : "raw"}|${this.runtime.url}${file}`;
    let t = packTextures.get(key);
    if (!t) {
      t = textureLoader.load(this.runtime.url + file);
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 4;
      packTextures.set(key, t);
    }
    return t;
  }

  private readonly wanted = new Map<string, boolean>();

  /**
   * Shows or hides a mesh. Showing a mesh hides the other meshes in its slot.
   * Meshes tagged "anatomy" stay hidden while a garment tagged "covers:anatomy" is shown.
   */
  setVisible(name: string, visible: boolean): void {
    const data = this.data.get(name);
    if (!data) return;
    const slot = data.def.slot;
    if (visible && slot) for (const [n, d] of this.data) if (n !== name && d.def.slot === slot) this.wanted.set(n, false);
    this.wanted.set(name, visible);
    this.visDirty = true;
  }

  /** Whether the mesh was asked to be shown (it may still be covered, see setVisible). */
  isVisible(name: string): boolean {
    return this.wanted.get(name) ?? this.meshes.get(name)?.visible ?? false;
  }

  private readonly concealed = new Set<string>();

  /**
   * Keeps a shown mesh from being drawn, e.g. underwear fully covered by outer
   * clothes (so it can never peek through). It still counts as worn: a
   * concealed garment tagged "covers:anatomy" keeps the anatomy hidden.
   */
  setConcealed(name: string, concealed: boolean): void {
    if (concealed === this.concealed.has(name)) return;
    if (concealed) this.concealed.add(name);
    else this.concealed.delete(name);
    this.visDirty = true;
  }

  /** Visibility changes (setVisible, setConcealed, …) wait for the next update, shape or level change, so a whole outfit costs one pass. */
  private visDirty = false;

  /** Applies pending visibility changes now (they are otherwise applied by the next `update`, `applyShape` or `setLod`). */
  flushVisibility(): void {
    if (this.visDirty) this.updateVisibility();
  }

  private batching = 0;
  private visibilityDirty = false;
  private shownKey = "";

  /**
   * Runs `fn` (many setVisible/setConcealed calls, say) and updates what is
   * drawn once at the end, instead of after every call.
   */
  batch<T>(fn: () => T): T {
    this.batching++;
    try {
      return fn();
    } finally {
      if (--this.batching === 0 && this.visibilityDirty) this.updateVisibility();
    }
  }

  private updateVisibility(): void {
    if (this.batching > 0) {
      this.visibilityDirty = true;
      return;
    }
    this.visibilityDirty = false;
    this.visDirty = false;
    const level = this.level;
    const on = (n: string) => !!this.wanted.get(n) && !this.concealed.has(n);
    this.shown.clear();
    for (const [n, d] of this.data) {
      const { def } = d;
      if (!drawnAt(def, level)) continue;
      let show = on(n);
      // A stand-in (e.g. the low-poly body) is drawn where the mesh it stands in for is not.
      const target = def.lodOf ? this.data.get(def.lodOf) : undefined;
      if (!show && target && !drawnAt(target.def, level)) {
        const slot = target.def.slot;
        show = on(target.def.name) || (!!slot && [...this.data.values()].some((x) => x.def.slot === slot && on(x.def.name)));
      }
      if (show) this.shown.add(n);
    }
    const covered = [...this.data.values()].some((d) => d.def.tags?.includes("covers:anatomy") && this.wanted.get(d.def.name));
    if (covered) for (const d of this.data.values()) if (d.def.tags?.includes("anatomy")) this.shown.delete(d.def.name);
    if (this.packHidden) this.shown.clear();
    // Not drawn until a shape includes it (a garment worn since the last shape waits for the next one).
    const shape = this.lastShape;
    if (shape) for (const n of [...this.shown]) if (!this.includes(shape, this.data.get(n)!)) this.shown.delete(n);
    for (const n of this.shown) this.ensureMesh(this.data.get(n)!);
    for (const [n, mesh] of this.meshes) mesh.visible = this.shown.has(n);
    // Cutting the skin under garments is the slow part: only redo it when what is drawn changed.
    const key = `${level}|${this.data.size}|${[...this.shown].sort().join(",")}`;
    if (key === this.shownKey) return;
    this.shownKey = key;
    this.updateLifts();
    this.updateHiddenSkin();
  }

  /** The current detail level (index into `lods`). */
  get lod(): number {
    return this.level;
  }

  /**
   * Switches the detail level (0 = full detail, see `lods`). Instant: every
   * level draws from the shape already applied. Levels with `bones` animate
   * only those; levels with `merge` draw body and garments as one mesh.
   */
  setLod(level: number): void {
    level = Math.max(0, Math.min(this.lods.length - 1, Math.round(level)));
    this.flushVisibility();
    if (level === this.level) return;
    const bonesBefore = this.lods[this.level].bones;
    this.level = level;
    this.updateVisibility();
    if (this.crowdDirty) this.buildCrowd();
    if (this.lods[level].bones !== bonesBefore && this.clip) this.play(this.clip);
  }

  /**
   * Picks the detail level from the camera's distance (see `LodDef.distance`,
   * scaled for the camera's field of view).
   * `bias` > 1 keeps detail longer (e.g. for a narrow field of view). Call once a frame or less.
   */
  updateLod(camera: THREE.Camera, bias = 1): number {
    const a = new THREE.Vector3().setFromMatrixPosition(this.object.matrixWorld);
    const b = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    // Switch distances are meant for a 50° vertical field of view; narrower views keep detail longer.
    const fov = (camera as THREE.PerspectiveCamera).isPerspectiveCamera ? (camera as THREE.PerspectiveCamera).getEffectiveFOV() : 50;
    const zoom = Math.tan(THREE.MathUtils.degToRad(25)) / Math.tan(THREE.MathUtils.degToRad(fov / 2));
    this.setLod(lodForDistance(this.lods, a.distanceTo(b), bias * zoom));
    return this.level;
  }

  private skinKey = "";

  /** Frees what this actor holds besides its meshes (its share of a composed photo skin). */
  dispose(): void {
    this.kit.release?.(this);
  }

  /**
   * Photographic skin: blends the given pack textures (e.g. `Human.skinTextures()`)
   * on the GPU and uses the result as the skin's albedo. Null or an empty list
   * switches back to the procedural tone (`setSkinTone`).
   */
  async setSkinTextures(renderer: unknown, layers: { file: string; weight: number }[] | null): Promise<void> {
    const key = layers?.map((l) => `${l.file}:${l.weight.toFixed(3)}`).join("|") ?? "";
    if (key === this.skinKey) return;
    this.skinKey = key;
    if (!layers?.length) {
      this.skin.uAlbedoMix.value = 0;
      return;
    }
    const textures = await Promise.all(
      layers.map((l) => {
        const url = this.runtime.url + l.file;
        let job = skinTextures.get(url);
        if (!job) {
          job = textureLoader.loadAsync(url).then((t) => {
            t.colorSpace = THREE.SRGBColorSpace;
            return t;
          });
          job.catch(() => skinTextures.delete(url));
          skinTextures.set(url, job);
        }
        return job;
      }),
    );
    if (key !== this.skinKey) return; // a newer request won
    this.kit.blendSkins(this, layers.map((l, i) => ({ texture: textures[i], weight: l.weight })), renderer);
    this.skin.uAlbedoMix.value = 1;
  }

  /**
   * Hair colour (sRGB hex or THREE.Color), applied to every hair mesh relative
   * to its texture's own colour; null restores the texture's colour.
   */
  setHairColor(color: THREE.ColorRepresentation | null): void {
    this.hairColor = color;
    for (const mesh of this.meshes.values()) {
      const mat = mesh.material as THREE.Material;
      const u = mat.userData.hair as { uHairTint: { value: THREE.Color }; uHairMix: { value: number }; uHairMeanLum: { value: number } } | undefined;
      const mean = mat.userData.meanColor as THREE.Color | undefined;
      if (!u || !mean) continue;
      u.uHairMix.value = color === null ? 0 : 1;
      if (color !== null) u.uHairTint.value.set(color);
      u.uHairMeanLum.value = Math.max(0.01, 0.2126 * mean.r + 0.7152 * mean.g + 0.0722 * mean.b);
    }
  }

  private readonly tints = new Map<string, THREE.ColorRepresentation | null>();
  /** Last setHairColor (also given to hair meshes made later). */
  private hairColor?: THREE.ColorRepresentation | null;

  /**
   * Recolours a garment (sRGB hex or THREE.Color), keeping its texture's
   * shading pattern; null restores its own colours. Also applies to garments
   * loaded later.
   */
  setGarmentColor(name: string, color: THREE.ColorRepresentation | null): void {
    this.tints.set(name, color);
    if (this.crowd?.merged.parts.some((p) => p.data.def.name === name)) this.colorCrowd();
    const mat = this.meshes.get(name)?.material as THREE.Material | undefined;
    const u = mat?.userData.tint as ClothTintUniforms | undefined;
    if (!u) return;
    u.uTintMix.value = color === null ? 0 : 1;
    if (color !== null) u.uTint.value.set(color);
  }

  /** Whether a mesh can be recoloured with setGarmentColor. */
  isTintable(name: string): boolean {
    return !!(this.meshes.get(name)?.material as THREE.Material | undefined)?.userData.tint;
  }

  /** Skin base colour (linear RGB). */
  setSkinTone(color: THREE.Color): void {
    this.skin.uTone.value.copy(color);
  }

  /** Writes a mesh's bind-pose positions and normals for a shape (garments pushed out by their thickness). */
  private writePositions(data: MeshData, shape: ActorShape): void {
    const mesh = this.meshes.get(data.def.name);
    if (!mesh) return; // made (and filled) on first use
    const src = this.source(shape, data);
    const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const nor = mesh.geometry.getAttribute("normal") as THREE.BufferAttribute;
    const p = pos.array as Float32Array, nn = nor.array as Float32Array;
    const map = data.map;
    const inflate = data.def.inflate ?? 0;
    const lift = this.liftOf(data, shape);
    for (let i = 0; i < map.length; i++) {
      const s = map[i] * 3;
      const nx = src.normals[s], ny = src.normals[s + 1], nz = src.normals[s + 2];
      const d = lift ? inflate + lift[map[i]] : inflate;
      p[i * 3] = src.positions[s] + nx * d;
      p[i * 3 + 1] = src.positions[s + 1] + ny * d;
      p[i * 3 + 2] = src.positions[s + 2] + nz * d;
      nn[i * 3] = nx;
      nn[i * 3 + 1] = ny;
      nn[i * 3 + 2] = nz;
    }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
  }

  /** Shown garments cut from the body, as a key (fitted garments are lifted over them, see liftOf). */
  private liftKey = "";
  private readonly lifts = new Map<string, Float32Array | null>();

  /**
   * Extra lift per proxy vertex for fitted garments (proxies): where one lies
   * over a shown body-cut garment (a T-shirt over jeans) closer to the body
   * than that garment's thickness, it is pushed out to sit on top of it
   * instead of cutting into it. Parts that hang further out stay put.
   */
  private liftOf(data: MeshData, shape: ActorShape): Float32Array | null {
    const src = data.def.source;
    if (data.def.role !== "garment" || src.kind !== "proxy" || data.def.tags?.includes("tucked")) return null;
    let lift = this.lifts.get(data.def.name);
    if (lift !== undefined) return lift;
    lift = null;
    const binding = this.runtime.proxies.get(src.proxy);
    const fitted = shape.proxies.get(src.proxy);
    const garmentOf = this.runtime.garmentVertexOf;
    const under = this.underThickness();
    if (binding && fitted && garmentOf && under) {
      const n = binding.def.vertexCount;
      lift = new Float32Array(n);
      const { refs, weights } = binding;
      const P = shape.positions, N = shape.normals;
      const own = data.def.inflate ?? 0;
      for (let i = 0; i < n; i++) {
        // The body-cut garment's outer surface under this vertex (weighted over its body anchors).
        let wsum = 0;
        const top = [0, 0, 0];
        for (let k = 0; k < 3; k++) {
          const g = garmentOf[refs[i * 3 + k]], w = weights[i * 3 + k];
          if (g === 0xffffffff || !under[g] || w <= 0) continue;
          wsum += w;
          for (let c = 0; c < 3; c++) top[c] += w * (P[g * 3 + c] + N[g * 3 + c] * under[g]);
        }
        if (wsum < 0.5) continue;
        // How far that surface lies outside the garment here, along the garment's normal.
        let gap = 0;
        for (let c = 0; c < 3; c++) gap += (top[c] / wsum - fitted.positions[i * 3 + c]) * fitted.normals[i * 3 + c];
        lift[i] = Math.max(0, gap + 0.003 - own);
      }
    }
    this.lifts.set(data.def.name, lift);
    return lift;
  }

  private underCache?: Float32Array | null;

  /** Per base vertex: thickness (inflate) of the thickest shown body-cut garment there, null if none is shown. */
  private underThickness(): Float32Array | null {
    if (this.underCache !== undefined) return this.underCache;
    let under: Float32Array | null = null;
    for (const data of this.rendered) {
      const { def } = data;
      if (def.role !== "garment" || def.source.kind !== "base" || !this.shown.has(def.name) || !def.inflate) continue;
      under ??= new Float32Array(this.runtime.manifest.vertexCount);
      // Also just past a hem cut (those triangles are still partly drawn), fading out over 2 cm so the lift has no step.
      for (let i = 0; i < data.map.length; i++) {
        const t = data.clip ? Math.min(1, Math.max(0, 1 + data.clip[i] / 0.02)) : 1;
        under[data.map[i]] = Math.max(under[data.map[i]], def.inflate * t);
      }
    }
    return (this.underCache = under);
  }

  /** Re-lifts fitted garments when the shown body-cut garments change. */
  private updateLifts(): void {
    const key = this.rendered.filter((d) => d.def.role === "garment" && d.def.source.kind === "base" && this.shown.has(d.def.name)).map((d) => d.def.name).join(",");
    if (key === this.liftKey) return;
    this.liftKey = key;
    this.lifts.clear();
    this.underCache = undefined;
    const shape = this.lastShape;
    if (shape) for (const data of this.rendered) if (data.def.role === "garment" && data.def.source.kind === "proxy" && this.includes(shape, data)) this.writePositions(data, shape);
  }

  /** Iris colour preset (see IRIS_PRESETS) or custom hue/saturation/lightness factors. */
  setIris(preset: keyof typeof IRIS_PRESETS | { hue: number; sat: number; light: number }): void {
    const p = typeof preset === "string" ? IRIS_PRESETS[preset] : preset;
    this.eye.uIrisHue.value = p.hue;
    this.eye.uIrisSat.value = p.sat;
    this.eye.uIrisLight.value = p.light;
  }

  /** Writes a new shape into the GPU buffers and re-binds the skeleton to it. */
  applyShape(shape: ActorShape): void {
    this.lastShape = shape;
    this.lifts.clear();
    // Meshes not made yet are filled when they are; meshes the shape doesn't include keep their last fit (and are not drawn).
    for (const data of this.rendered) if (this.meshes.has(data.def.name) && this.includes(shape, data)) this.writePositions(data, shape);
    // Which meshes the shape includes decides what is drawn; the skin cut is redone either way.
    this.shownKey = "";
    this.updateVisibility();
    if (shape.skeleton && this.skeleton) this.rebind(shape.skeleton);
    if (shape.skeleton) this.measureLegs(shape);
    if (this.crowdDirty) this.buildCrowd();
    else this.fillCrowd();
  }

  private static readonly LEGS: [string, string][] = [
    ["thigh_l", "calf_l"],
    ["calf_l", "foot_l"],
    ["thigh_r", "calf_r"],
    ["calf_r", "foot_r"],
  ];

  /** Capsule radius per leg bone: how far the body surface sits from the bone (80th percentile). */
  private measureLegs(shape: ActorShape): void {
    const sk = shape.skeleton!;
    const body = this.runtime.meshes.find((m) => m.def.role === "body" && !m.stencil && m.joints);
    if (!body?.joints || !body.weights) return;
    for (const [bone, child] of ThreeActor.LEGS) {
      const bi = sk.names.indexOf(bone), ci = sk.names.indexOf(child);
      if (bi < 0 || ci < 0) continue;
      const a = new THREE.Vector3(...sk.heads[bi]), b = new THREE.Vector3(...sk.heads[ci]);
      const seg = new THREE.Line3(a, b), p = new THREE.Vector3(), c = new THREE.Vector3();
      const d: number[] = [];
      for (let i = 0; i < body.map.length; i++) {
        let w = 0;
        for (let k = 0; k < 4; k++) if (body.joints[i * 4 + k] === bi) w = body.weights[i * 4 + k];
        if (w < 0.6) continue;
        const v = body.map[i] * 3;
        p.set(shape.positions[v], shape.positions[v + 1], shape.positions[v + 2]);
        seg.closestPointToPoint(p, true, c);
        d.push(p.distanceTo(c));
      }
      d.sort((x, y) => x - y);
      if (d.length) this.legRadii.set(bone, d[Math.floor(d.length * 0.8)] + 0.012);
    }
  }

  private updateColliders(): void {
    const { uCapA, uCapB } = this.colliders;
    this.object.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.object.matrixWorld).invert();
    const pos = (name: string, out: THREE.Vector3) => {
      const bone = this.bones.find((b) => b.name === name);
      return bone ? out.setFromMatrixPosition(bone.matrixWorld).applyMatrix4(inv) : null;
    };
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    pos("pelvis", this.colliders.uCenter.value);
    ThreeActor.LEGS.slice(0, MAX_COLLIDERS).forEach(([bone, child], i) => {
      const r = this.legRadii.get(bone) ?? 0;
      if (!r || !pos(bone, a) || !pos(child, b)) {
        uCapA.value[i].w = 0;
        return;
      }
      // Thigh capsules start below the hip joint so the waist and hips keep their shape.
      if (bone.startsWith("thigh")) a.lerp(b, 0.3);
      uCapA.value[i].set(a.x, a.y, a.z, r);
      uCapB.value[i].copy(b);
    });
  }

  private source(shape: ActorShape, data: MeshData) {
    if (data.stencil) return shape.meshes.get(data.def.name)!;
    return data.def.source.kind === "base" ? shape : shape.proxies.get(data.def.source.proxy)!;
  }

  /**
   * Loads deltas (from `Human.faceDelta` / `ActorRuntime.surfaceDelta`) into a
   * morph channel. Blend it every frame with `setMorphWeight`.
   * Recompute the delta after the shape changes.
   */
  setMorph(channel: (typeof ThreeActor.MORPHS)[number], delta: SurfaceDelta | null): void {
    const k = ThreeActor.MORPHS.indexOf(channel);
    for (const data of this.rendered) {
      const mesh = this.meshes.get(data.def.name);
      if (mesh) this.fillMorph(mesh, data, k, delta);
    }
    this.lastDeltas.set(channel, delta);
    this.setPartMorph(channel, delta);
  }

  /** Writes a face-morph delta into one mesh's morph channel `k` (zero for null, or a delta that lacks the mesh). */
  private fillMorph(mesh: THREE.SkinnedMesh, data: MeshData, k: number, delta: SurfaceDelta | null): void {
    const g = mesh.geometry;
    if (!g.morphAttributes.position) return;
    const mp = g.morphAttributes.position[k].array as Float32Array;
    const mn = g.morphAttributes.normal![k].array as Float32Array;
    const src = delta && (data.stencil ? delta.meshes.get(data.def.name) : delta);
    if (!src) {
      mp.fill(0);
      mn.fill(0);
    } else {
      const map = data.map;
      for (let i = 0; i < map.length; i++) {
        const s = map[i] * 3;
        mp[i * 3] = src.positions[s];
        mp[i * 3 + 1] = src.positions[s + 1];
        mp[i * 3 + 2] = src.positions[s + 2];
        mn[i * 3] = src.normals[s];
        mn[i * 3 + 1] = src.normals[s + 1];
        mn[i * 3 + 2] = src.normals[s + 2];
      }
    }
    // three caches morph data in a texture; disposing forces a re-upload (attributes are re-created on demand).
    g.dispose();
    // Keep the weights of the other channels (a new mesh starts at 0).
    const body = [...this.meshes.values()].find((m) => m !== mesh && m.morphTargetInfluences);
    if (mesh.morphTargetInfluences && body?.morphTargetInfluences) mesh.morphTargetInfluences.splice(0, body.morphTargetInfluences.length, ...body.morphTargetInfluences);
  }

  setMorphWeight(channel: (typeof ThreeActor.MORPHS)[number], weight: number): void {
    const k = ThreeActor.MORPHS.indexOf(channel);
    for (const mesh of this.meshes.values()) if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[k] = weight;
    for (const mesh of this.parts.values()) if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[k] = weight;
  }


  /**
   * Drops triangles hidden under visible garments to avoid poke-through: skin
   * under any garment (e.g. feet under socks), and body-following garments
   * (briefs, bra, tights, …) under a garment on a higher layer.
   */
  private updateHiddenSkin(): void {
    const level = this.level;
    const covers: { layer: number; verts: Uint32Array }[] = [];
    for (const data of this.rendered)
      if (data.hidesBaseVertices && this.shown.has(data.def.name)) covers.push({ layer: garmentLayer(data.def), verts: data.hidesBaseVertices });
    for (const data of this.rendered) {
      const { def } = data;
      const mesh = this.meshes.get(def.name);
      if (!mesh) continue;
      const isGarment = def.role === "garment" && def.source.kind === "base";
      if (def.role !== "body" && !isGarment) {
        this.useIndices(mesh, data, level);
        continue;
      }
      // Hidden garments keep their last index list; it is rebuilt when they are shown.
      if (isGarment && !this.shown.has(def.name)) continue;
      const layer = garmentLayer(def);
      const hide = new Set<number>();
      for (const c of covers) if (c.layer > layer) for (const v of c.verts) hide.add(v);
      const { map, dominant } = data;
      const indices = lodIndices(data, level);
      const base = (i: number) => (dominant ? dominant[map[i]] : map[i]);
      // Garments with a hem cut fade out around covered vertices per pixel instead of losing whole triangles.
      if (isGarment && data.clip) {
        this.useIndices(mesh, data, level);
        const attr = mesh.geometry.getAttribute("clipValue") as THREE.BufferAttribute;
        const values = attr.array as Float32Array;
        // Barely below zero: the cut sits right at the covered vertices, so no gap opens below the covering hem.
        for (let i = 0; i < map.length; i++) values[i] = hide.has(map[i]) ? -0.002 : data.clip[i];
        attr.needsUpdate = true;
        continue;
      }
      const out = new Uint32Array(indices.length);
      let n = 0;
      for (let t = 0; t < indices.length; t += 3) {
        if (hide.size && hide.has(base(indices[t])) && hide.has(base(indices[t + 1])) && hide.has(base(indices[t + 2]))) continue;
        out[n++] = indices[t];
        out[n++] = indices[t + 1];
        out[n++] = indices[t + 2];
      }
      mesh.geometry.setIndex(new THREE.BufferAttribute(out.slice(0, n), 1));
    }
    if (this.lods[level].merge) {
      // Merged into the crowd mesh: hide the parts now, rebuild the merged mesh before the next frame.
      for (const data of this.rendered) if (this.mergeable(data) && this.shown.has(data.def.name)) this.meshes.get(data.def.name)!.visible = false;
      this.crowdDirty = true;
    } else if (this.crowd) this.dropCrowd();
  }

  private readonly indexCache = new WeakMap<Uint32Array, THREE.BufferAttribute>();

  /** Gives a mesh its triangle list for a level (index attributes are cached, so switching levels uploads nothing new). */
  private useIndices(mesh: THREE.SkinnedMesh, data: MeshData, level: number): void {
    const indices = lodIndices(data, level);
    if (mesh.geometry.index?.array === indices) return;
    let attr = this.indexCache.get(indices);
    if (!attr) this.indexCache.set(indices, (attr = new THREE.BufferAttribute(indices, 1)));
    mesh.geometry.setIndex(attr);
  }

  /**
   * Body and garments are merged at crowd levels; hair, eyes and add-ons stay
   * separate, and so do skirt-skinned garments (they need the leg colliders).
   */
  private mergeable(data: MeshData): boolean {
    return (data.def.role === "body" || data.def.role === "garment") && !this.usesColliders(data);
  }

  private readonly colliderUse = new WeakMap<MeshData, boolean>();

  private usesColliders(data: MeshData): boolean {
    let use = this.colliderUse.get(data);
    if (use === undefined) {
      const src = data.def.source;
      use = src.kind === "proxy" && !!this.runtime.manifest.proxies.find((p) => p.name === src.proxy)?.legBlend;
      this.colliderUse.set(data, use);
    }
    return use;
  }

  private crowdDirty = false;

  /** Builds the crowd level's merged mesh from the shown body and garments (with their current hidden-skin cuts). */
  private buildCrowd(): void {
    this.crowdDirty = false;
    const lod = this.lods[this.level];
    if (!lod.merge || !this.lastShape) return;
    const shape = this.lastShape;
    const parts: { data: MeshData; indices: Uint32Array }[] = [];
    for (const data of this.rendered) {
      if (!this.mergeable(data) || !this.shown.has(data.def.name)) continue;
      // Not fitted yet (loaded after the last shape): joins once the next shape includes it.
      if (data.def.source.kind === "proxy" && !shape.proxies.has(data.def.source.proxy)) continue;
      if (data.stencil && !shape.meshes.has(data.def.name)) continue;
      const g = this.meshes.get(data.def.name)!.geometry;
      const indices = g.index!.array as Uint32Array;
      // Hem cuts as they are now (including skin hidden under higher layers), still cut per pixel.
      const clip = data.clip ? ((g.getAttribute("clipValue") as THREE.BufferAttribute).array as Float32Array) : undefined;
      parts.push({ data: clip ? { ...data, clip } : data, indices });
    }
    const skel = this.runtime.manifest.skeleton;
    const merged = mergeMeshes(parts, skel ? lodBoneMap(skel, lod) : null);
    const n = merged.vertexCount;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("uv", new THREE.BufferAttribute(merged.uv, 2));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("crowdSkin", new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute("crowdClip", new THREE.BufferAttribute(merged.clip ?? new Float32Array(n).fill(1), 1));
    if (merged.joints && merged.weights) {
      g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(merged.joints, 4));
      g.setAttribute("skinWeight", new THREE.BufferAttribute(merged.weights, 4));
    }
    g.setIndex(new THREE.BufferAttribute(merged.indices, 1));
    const material = this.crowd?.mesh.material ?? (this.kit.crowd ?? webglMaterials.crowd!)(this);
    const mesh = new THREE.SkinnedMesh(g, material);
    mesh.name = "crowd";
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    if (this.crowd) this.dropCrowd(false);
    this.object.add(mesh);
    if (this.skeleton) mesh.bind(this.skeleton, new THREE.Matrix4());
    this.crowd = { mesh, merged };
    this.colorCrowd();
    this.fillCrowd();
  }

  /**
   * The crowd level's merged mesh (body and garments in one draw call) and which vertex range
   * came from which mesh, or null when the actor is not drawn at a merging level. For tools that
   * bake it, e.g. into vertex-animation textures.
   */
  crowdMesh(): { mesh: THREE.SkinnedMesh; parts: { name: string; role: string; offset: number; count: number }[] } | null {
    this.flushVisibility();
    if (this.crowdDirty) this.buildCrowd();
    if (!this.crowd) return null;
    return { mesh: this.crowd.mesh, parts: this.crowd.merged.parts.map((p) => ({ name: p.data.def.name, role: p.data.def.role, offset: p.offset, count: p.count })) };
  }

  private dropCrowd(disposeMaterial = true): void {
    if (!this.crowd) return;
    this.crowd.mesh.removeFromParent();
    this.crowd.mesh.geometry.dispose();
    if (disposeMaterial) (this.crowd.mesh.material as THREE.Material).dispose();
    this.crowd = undefined;
  }

  private fillCrowd(): void {
    if (!this.crowd || !this.lastShape) return;
    const g = this.crowd.mesh.geometry;
    const pos = g.getAttribute("position") as THREE.BufferAttribute, nor = g.getAttribute("normal") as THREE.BufferAttribute;
    fillMerged(this.crowd.merged, this.lastShape, pos.array as Float32Array, nor.array as Float32Array);
    pos.needsUpdate = true;
    nor.needsUpdate = true;
  }

  /** Crowd mesh colours: skin where the body is, each garment's tint (or its texture's mean colour). */
  private colorCrowd(): void {
    if (!this.crowd) return;
    const g = this.crowd.mesh.geometry;
    const color = g.getAttribute("color") as THREE.BufferAttribute, skin = g.getAttribute("crowdSkin") as THREE.BufferAttribute;
    const c = new THREE.Color();
    for (const { data, offset, count } of this.crowd.merged.parts) {
      const { def } = data;
      const isSkin = def.role === "body" ? 1 : 0;
      const tint = this.tints.get(def.name);
      if (tint !== undefined && tint !== null) c.set(tint);
      else {
        const rgb = def.material.color ?? [0.5, 0.5, 0.5];
        // Textured garments store their texture's mean colour (sRGB), plain ones a linear colour.
        if (def.textures?.color) c.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
        else c.setRGB(rgb[0], rgb[1], rgb[2]);
      }
      for (let i = offset; i < offset + count; i++) {
        color.setXYZ(i, c.r, c.g, c.b);
        skin.setX(i, isSkin);
      }
    }
    color.needsUpdate = true;
    skin.needsUpdate = true;
  }

  private rebind(fitted: FittedSkeleton): void {
    this.fitted = fitted;
    fitted.names.forEach((_, i) => {
      const bone = this.bones[i];
      bone.position.fromArray(fitted.localPositions[i]);
      bone.quaternion.fromArray(fitted.localRotations[i]);
      bone.scale.set(1, 1, 1);
    });
    this.object.updateMatrixWorld(true);
    this.placeExtraBones();
    const rootInv = this.object.matrixWorld.clone().invert();
    this.skeleton!.boneInverses = this.bones.map((b) => new THREE.Matrix4().multiplyMatrices(rootInv, b.matrixWorld).invert());
    for (const mesh of this.meshes.values()) mesh.bind(this.skeleton!, new THREE.Matrix4());
    for (const mesh of this.parts.values()) mesh.bind(this.skeleton!, new THREE.Matrix4());
    this.crowd?.mesh.bind(this.skeleton!, new THREE.Matrix4());
    // Joint positions moved, so rebuild the clip against the new bind pose.
    if (this.clip) this.play(this.clip);
  }

  /** Plays a clip (looping): retargeted mocap from the pack (`runtime.loadClip`) or a procedural clip. Null = bind pose. */
  play(clip: PlayableClip | null): void {
    const time = this.action?.time ?? 0;
    this.mixer.stopAllAction();
    if (this.action) this.mixer.uncacheClip(this.action.getClip());
    this.action = undefined;
    this.clip = clip ?? undefined;
    if (!clip || !this.fitted) {
      if (this.fitted) this.restPose();
      return;
    }
    const three = this.toThreeClip(clip);
    // Levels with fewer bones animate only those (the others keep their pose and drive no visible vertex).
    const keep = this.lods[this.level].bones;
    if (keep) {
      const kept = new Set(keep);
      const pack = new Set(this.bones.slice(0, this.packBones).map((b) => b.name));
      three.tracks = three.tracks.filter((t) => {
        const bone = t.name.slice(0, t.name.lastIndexOf("."));
        return kept.has(bone) || !pack.has(bone);
      });
    }
    this.action = this.mixer.clipAction(three);
    this.action.play();
    this.action.time = time % three.duration;
  }

  private restPose(): void {
    const f = this.fitted!;
    f.names.forEach((_, i) => {
      this.bones[i].quaternion.fromArray(f.localRotations[i]);
      this.bones[i].position.fromArray(f.localPositions[i]);
    });
    for (const bone of this.extraHeads.keys()) bone.quaternion.identity();
  }

  /** Puts extra (part) bones at their bind-pose heads, unrotated relative to their parents. Pack bones must be in the bind pose. */
  private placeExtraBones(): void {
    const sway = new THREE.Quaternion();
    for (const [bone, head] of this.extraHeads) {
      bone.quaternion.identity();
      bone.position.copy(bone.parent!.worldToLocal(this.object.localToWorld(head.clone())));
      bone.updateMatrixWorld(true);
      if (bone.parent && !this.extraHeads.has(bone.parent as THREE.Bone)) {
        // Sway axes of the chain, in its root's frame (the chain is unrotated, so they hold for every bone).
        const inv = (bone.parent as THREE.Bone).getWorldQuaternion(sway).invert().multiply(this.object.getWorldQuaternion(new THREE.Quaternion()));
        bone.userData.yaw = new THREE.Vector3(0, 1, 0).applyQuaternion(inv);
        bone.userData.pitch = new THREE.Vector3(1, 0, 0).applyQuaternion(inv);
      }
    }
  }

  /**
   * Idle sway for tail chains, as tracks over `duration` seconds (whole cycles,
   * so looping clips stay seamless). Baked into every clip, so it also exports.
   */
  private swayTracks(duration: number): THREE.KeyframeTrack[] {
    const tracks: THREE.KeyframeTrack[] = [];
    const roots = [...this.extraHeads.keys()].filter((b) => !this.extraHeads.has(b.parent as THREE.Bone));
    for (const root of roots) {
      const chain: THREE.Bone[] = [root];
      for (let b = root; ; ) {
        const next = b.children.find((c) => this.extraHeads.has(c as THREE.Bone)) as THREE.Bone | undefined;
        if (!next) break;
        chain.push(next);
        b = next;
      }
      const yaw = root.userData.yaw as THREE.Vector3, pitch = root.userData.pitch as THREE.Vector3;
      if (!yaw || !pitch) continue;
      const cycles = Math.max(1, Math.round(duration / 1.8));
      const steps = Math.max(12, cycles * 24);
      const times = Array.from({ length: steps + 1 }, (_, i) => (i / steps) * duration);
      const q = new THREE.Quaternion(), qp = new THREE.Quaternion();
      chain.forEach((bone, k) => {
        const values: number[] = [];
        for (const t of times) {
          const ph = (t / duration) * cycles * Math.PI * 2;
          // A wave travelling to the tip, stronger toward it; a slight lift and fall.
          q.setFromAxisAngle(yaw, 0.09 * (0.4 + k * 0.25) * Math.sin(ph - k * 0.7));
          qp.setFromAxisAngle(pitch, 0.03 * Math.sin(ph * 2 - k * 0.5));
          q.multiply(qp);
          values.push(q.x, q.y, q.z, q.w);
        }
        tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values));
      });
    }
    return tracks;
  }

  /** Converts a clip into a regular three.js AnimationClip for the current skeleton (e.g. for glTF export). */
  toThreeClip(clip: PlayableClip): THREE.AnimationClip {
    if (!this.fitted) throw new Error("No shape applied yet");
    if (isRetargetClip(clip)) {
      const baked = new Retargeter(this.fitted, clip, { inPlace: this.inPlace }).bake(clip.def.fps);
      const tracks: THREE.KeyframeTrack[] = this.fitted.names.map((n, i) => new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, baked.times, baked.rotations[i]));
      tracks.push(new THREE.VectorKeyframeTrack(`${baked.rootBone}.position`, baked.times, baked.rootPositions));
      const duration = baked.times[baked.times.length - 1];
      tracks.push(...this.swayTracks(duration));
      return new THREE.AnimationClip(clip.def.name, duration, tracks);
    }
    const { times, tracks } = bakeAxisClip(this.fitted, clip);
    const out: THREE.KeyframeTrack[] = [...tracks].map(([bone, values]) => new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values));
    out.push(...this.swayTracks(clip.duration));
    return new THREE.AnimationClip(clip.name, clip.duration, out);
  }

  /** The skeleton as fitted to the current shape (bind pose), for sampling clips or blending poses yourself. Replaced on every shape change. */
  get fittedSkeleton(): FittedSkeleton | undefined {
    return this.fitted;
  }

  /**
   * Puts a pose (from `Retargeter.sampleInto`, a `PoseMixer` or a `Locomotion`) on the pack
   * bones. Stop any playing clip first (`play(null)`), or the mixer overwrites it next update.
   */
  setPose(pose: Pose): void {
    const n = Math.min(this.packBones, pose.rotations.length / 4);
    for (let i = 0; i < n; i++) this.bones[i].quaternion.fromArray(pose.rotations, i * 4);
    this.bones[pose.rootIndex]?.position.fromArray(pose.root);
  }

  /** The running clip's action, if any (for seeking or syncing other mixers). */
  get currentAction(): THREE.AnimationAction | undefined {
    return this.action;
  }

  update(dt: number): void {
    this.flushVisibility();
    if (this.crowdDirty) this.buildCrowd();
    this.mixer.update(dt);
    // Leg colliders only matter while a skirt-skinned garment is drawn.
    if ([...this.shown].some((n) => this.usesColliders(this.data.get(n)!))) this.updateColliders();
  }

  /** Height of the current body shape (lowest to highest point), in meters. */
  height(): number {
    const p = this.lastShape?.positions;
    const body = this.runtime.meshes.find((m) => m.def.role === "body" && !m.stencil);
    if (!p || !body) return 0;
    let min = Infinity, max = -Infinity;
    for (const v of body.map) {
      min = Math.min(min, p[v * 3 + 1]);
      max = Math.max(max, p[v * 3 + 1]);
    }
    return max - min;
  }

  /** The lowest point of the current shape (for standing the actor on the ground). */
  groundOffset(): number {
    const p = this.lastShape?.positions;
    const body = this.runtime.meshes.find((m) => m.def.role === "body" && !m.stencil);
    if (!p || !body) return 0;
    let min = Infinity;
    for (const v of body.map) min = Math.min(min, p[v * 3 + 1]);
    return -min;
  }
}

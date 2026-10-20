import * as THREE from "three";
import {
  type ActorRuntime,
  type ActorShape,
  type AxisClip,
  type Clip,
  type FittedSkeleton,
  type MeshData,
  type PartMesh,
  Retargeter,
  type SurfaceDelta,
  bakeAxisClip,
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
import { createPartMesh } from "./parts";

export * from "./materials";
export * from "./dqs";
export * from "./procedural";
export * from "./skincompose";
export * from "./colliders";
export * from "./racepatterns";
export * from "./parts";

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
      const layer = (def.source.kind === "proxy" ? 2 : 1) + (def.inflate ?? 0) * 100;
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
  readonly skeleton?: THREE.Skeleton;
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
  private readonly textures = new Map<string, THREE.Texture>();
  private readonly loader = new THREE.TextureLoader();
  private readonly data = new Map<string, MeshData>();
  /** Meshes that are drawn (internal helper meshes are skipped). */
  private readonly rendered: MeshData[];
  private readonly depth = createDepthMaterial();
  private readonly slotsSeen = new Set<string>();

  constructor(
    readonly runtime: ActorRuntime,
    private readonly materials: MaterialFactory = defaultMaterials,
  ) {
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
    const materials = this.materials;
    for (const data of list) {
      if (data.def.internal || this.data.has(data.def.name)) continue;
      this.rendered.push(data);
      this.data.set(data.def.name, data);
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
      const hairMap = (mesh.material as THREE.MeshPhysicalMaterial).userData.hair ? (mesh.material as THREE.MeshPhysicalMaterial).map : null;
      if (hairMap && !transparent) mesh.customDepthMaterial = createAlphaDepthMaterial(hairMap);
      else if (!transparent) mesh.customDepthMaterial = data.clip ? useClipAttribute(createDepthMaterial()) : this.depth;
      mesh.frustumCulled = false; // bounds change with morphs and animation
      // Optional meshes start hidden; of several meshes in a slot, the first is shown.
      const slot = data.def.slot;
      mesh.visible = !data.def.optional && !(slot && this.slotsSeen.has(slot));
      if (slot && mesh.visible) this.slotsSeen.add(slot);
      this.wanted.set(data.def.name, mesh.visible);
      this.object.add(mesh);
      this.meshes.set(data.def.name, mesh);
      if (this.skeleton) mesh.bind(this.skeleton, new THREE.Matrix4());
      const tint = this.tints.get(data.def.name);
      if (tint !== undefined) this.setGarmentColor(data.def.name, tint);
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
    for (const part of parts) {
      const mesh = createPartMesh(part, this.skin);
      this.object.add(mesh);
      if (this.skeleton) mesh.bind(this.skeleton, new THREE.Matrix4());
      this.parts.set(part.name, mesh);
    }
  }

  /** Colour (sRGB hex or THREE.Color) of the generated parts of the given kinds (e.g. ["hair", "leaf"] for the hair colour). */
  setPartColor(kinds: string[], color: THREE.ColorRepresentation): void {
    for (const mesh of this.parts.values()) if (kinds.includes(mesh.userData.partKind)) (mesh.material as THREE.MeshStandardMaterial).color.set(color);
  }

  /** A texture shipped with the pack (cached). */
  texture(file: string, srgb = false): THREE.Texture {
    let t = this.textures.get(file);
    if (!t) {
      t = this.loader.load(this.runtime.url + file);
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 4;
      this.textures.set(file, t);
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
    this.updateVisibility();
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
    this.updateVisibility();
  }

  private updateVisibility(): void {
    for (const [n, w] of this.wanted) this.meshes.get(n)!.visible = w && !this.concealed.has(n);
    const covered = [...this.data.values()].some((d) => d.def.tags?.includes("covers:anatomy") && this.wanted.get(d.def.name));
    if (covered) for (const d of this.data.values()) if (d.def.tags?.includes("anatomy")) this.meshes.get(d.def.name)!.visible = false;
    this.updateHiddenSkin();
  }

  private composer?: SkinComposer;
  private readonly loading = new Map<string, Promise<THREE.Texture>>();
  private skinKey = "";

  /**
   * Photographic skin: blends the given pack textures (e.g. `Human.skinTextures()`)
   * on the GPU and uses the result as the skin's albedo. Null or an empty list
   * switches back to the procedural tone (`setSkinTone`).
   */
  async setSkinTextures(renderer: THREE.WebGLRenderer, layers: { file: string; weight: number }[] | null): Promise<void> {
    const key = layers?.map((l) => `${l.file}:${l.weight.toFixed(3)}`).join("|") ?? "";
    if (key === this.skinKey) return;
    this.skinKey = key;
    if (!layers?.length) {
      this.skin.uAlbedoMix.value = 0;
      return;
    }
    const textures = await Promise.all(
      layers.map((l) => {
        if (!this.loading.has(l.file))
          this.loading.set(
            l.file,
            this.loader.loadAsync(this.runtime.url + l.file).then((t) => {
              t.colorSpace = THREE.SRGBColorSpace;
              return t;
            }),
          );
        return this.loading.get(l.file)!;
      }),
    );
    if (key !== this.skinKey) return; // a newer request won
    this.composer ??= new SkinComposer();
    this.composer.compose(renderer, layers.map((l, i) => ({ texture: textures[i], weight: l.weight })));
    this.skin.uAlbedo.value = this.composer.target.texture;
    this.skin.uAlbedoMix.value = 1;
  }

  /**
   * Hair colour (sRGB hex or THREE.Color), applied to every hair mesh relative
   * to its texture's own colour; null restores the texture's colour.
   */
  setHairColor(color: THREE.ColorRepresentation | null): void {
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

  /**
   * Recolours a garment (sRGB hex or THREE.Color), keeping its texture's
   * shading pattern; null restores its own colours. Also applies to garments
   * loaded later.
   */
  setGarmentColor(name: string, color: THREE.ColorRepresentation | null): void {
    this.tints.set(name, color);
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
    for (const data of this.rendered) {
      const mesh = this.meshes.get(data.def.name)!;
      const src = this.source(shape, data);
      const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      const nor = mesh.geometry.getAttribute("normal") as THREE.BufferAttribute;
      const p = pos.array as Float32Array, nn = nor.array as Float32Array;
      const map = data.map;
      const inflate = data.def.inflate ?? 0;
      for (let i = 0; i < map.length; i++) {
        const s = map[i] * 3;
        const nx = src.normals[s], ny = src.normals[s + 1], nz = src.normals[s + 2];
        p[i * 3] = src.positions[s] + nx * inflate;
        p[i * 3 + 1] = src.positions[s + 1] + ny * inflate;
        p[i * 3 + 2] = src.positions[s + 2] + nz * inflate;
        nn[i * 3] = nx;
        nn[i * 3 + 1] = ny;
        nn[i * 3 + 2] = nz;
      }
      pos.needsUpdate = true;
      nor.needsUpdate = true;
    }
    this.updateHiddenSkin();
    if (shape.skeleton && this.skeleton) this.rebind(shape.skeleton);
    if (shape.skeleton) this.measureLegs(shape);
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
      const mesh = this.meshes.get(data.def.name)!;
      const g = mesh.geometry;
      if (!g.morphAttributes.position) continue;
      const mp = g.morphAttributes.position[k].array as Float32Array;
      const mn = g.morphAttributes.normal[k].array as Float32Array;
      if (!delta) {
        mp.fill(0);
        mn.fill(0);
      } else {
        const src = data.stencil ? delta.meshes.get(data.def.name)! : delta;
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
    }
  }

  setMorphWeight(channel: (typeof ThreeActor.MORPHS)[number], weight: number): void {
    const k = ThreeActor.MORPHS.indexOf(channel);
    for (const mesh of this.meshes.values()) if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[k] = weight;
  }

  /**
   * Garment layer order: skin 0, garments cut from the body (underwear, T-shirt,
   * jeans, by thickness) above it, fitted garments (proxies) on top.
   */
  private static layerOf(def: MeshData["def"]): number {
    if (def.role === "body") return 0;
    return (def.source.kind === "proxy" ? 2 : 1) + (def.inflate ?? 0) * 100;
  }

  /**
   * Drops triangles hidden under visible garments to avoid poke-through: skin
   * under any garment (e.g. feet under socks), and body-following garments
   * (briefs, bra, tights, …) under a garment on a higher layer.
   */
  private updateHiddenSkin(): void {
    const covers: { layer: number; verts: Uint32Array }[] = [];
    for (const data of this.rendered)
      if (data.hidesBaseVertices && this.meshes.get(data.def.name)?.visible) covers.push({ layer: ThreeActor.layerOf(data.def), verts: data.hidesBaseVertices });
    for (const data of this.rendered) {
      const { def } = data;
      const isGarment = def.role === "garment" && def.source.kind === "base";
      if (def.role !== "body" && !isGarment) continue;
      const mesh = this.meshes.get(def.name)!;
      // Hidden garments keep their last index list; it is rebuilt when they are shown.
      if (isGarment && !mesh.visible) continue;
      const layer = ThreeActor.layerOf(def);
      const hide = new Set<number>();
      for (const c of covers) if (c.layer > layer) for (const v of c.verts) hide.add(v);
      const { indices, map, dominant } = data;
      const base = (i: number) => (dominant ? dominant[map[i]] : map[i]);
      // Garments with a hem cut fade out around covered vertices per pixel instead of losing whole triangles.
      if (isGarment && data.clip) {
        const attr = mesh.geometry.getAttribute("clipValue") as THREE.BufferAttribute;
        const values = attr.array as Float32Array;
        for (let i = 0; i < map.length; i++) values[i] = hide.has(map[i]) ? -0.03 : data.clip[i];
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
    const rootInv = this.object.matrixWorld.clone().invert();
    this.skeleton!.boneInverses = this.bones.map((b) => new THREE.Matrix4().multiplyMatrices(rootInv, b.matrixWorld).invert());
    for (const mesh of this.meshes.values()) mesh.bind(this.skeleton!, new THREE.Matrix4());
    for (const mesh of this.parts.values()) mesh.bind(this.skeleton!, new THREE.Matrix4());
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
  }

  /** Converts a clip into a regular three.js AnimationClip for the current skeleton (e.g. for glTF export). */
  toThreeClip(clip: PlayableClip): THREE.AnimationClip {
    if (!this.fitted) throw new Error("No shape applied yet");
    if (isRetargetClip(clip)) {
      const baked = new Retargeter(this.fitted, clip, { inPlace: this.inPlace }).bake(clip.def.fps);
      const tracks: THREE.KeyframeTrack[] = this.fitted.names.map((n, i) => new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, baked.times, baked.rotations[i]));
      tracks.push(new THREE.VectorKeyframeTrack(`${baked.rootBone}.position`, baked.times, baked.rootPositions));
      return new THREE.AnimationClip(clip.def.name, baked.times[baked.times.length - 1], tracks);
    }
    const { times, tracks } = bakeAxisClip(this.fitted, clip);
    const out = [...tracks].map(([bone, values]) => new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values));
    return new THREE.AnimationClip(clip.name, clip.duration, out);
  }

  /** The running clip's action, if any (for seeking or syncing other mixers). */
  get currentAction(): THREE.AnimationAction | undefined {
    return this.action;
  }

  update(dt: number): void {
    this.mixer.update(dt);
    this.updateColliders();
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

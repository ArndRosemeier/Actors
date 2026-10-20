import * as THREE from "three";
import { type ActorRuntime, type ActorShape, type AxisClip, type FittedSkeleton, bakeAxisClip } from "@actors/core";

export interface MaterialFactory {
  (mesh: ActorRuntime["meshes"][number]): THREE.Material;
}

/** Default materials from the pack's material hints. Swap in your own via the constructor. */
export const defaultMaterials: MaterialFactory = ({ def }) => {
  // Proxy garments (socks, ...) are worn over base-mesh garments (tights), so they get a stronger depth bias.
  const layer = def.source.kind === "proxy" ? 2 : 1;
  const color = new THREE.Color(...(def.material.color ?? [0.8, 0.8, 0.8]));
  if (def.material.kind === "skin") {
    return new THREE.MeshPhysicalMaterial({
      color,
      roughness: def.material.roughness ?? 0.55,
      sheen: 0.25,
      sheenRoughness: 0.8,
      sheenColor: new THREE.Color(1, 0.75, 0.7),
      clearcoat: 0.05,
      clearcoatRoughness: 0.6,
    });
  }
  return new THREE.MeshStandardMaterial({
    color,
    roughness: def.material.roughness ?? 0.7,
    side: THREE.DoubleSide,
    // Garments sit very close to the skin; bias them toward the camera so skin doesn't flicker through.
    polygonOffset: def.material.kind === "cloth",
    polygonOffsetFactor: -2 * layer,
    polygonOffsetUnits: -4 * layer,
  });
};

/**
 * three.js view of an ActorRuntime: one SkinnedMesh per pack mesh, all sharing
 * one skeleton. Call `applyShape()` whenever the shape changes; the skeleton
 * is re-fitted and meshes are re-bound in place, so animation keeps playing.
 */
export class ThreeActor {
  readonly object = new THREE.Group();
  readonly meshes = new Map<string, THREE.SkinnedMesh>();
  readonly bones: THREE.Bone[] = [];
  readonly skeleton?: THREE.Skeleton;
  readonly mixer: THREE.AnimationMixer;
  private fitted?: FittedSkeleton;
  private clip?: AxisClip;
  private action?: THREE.AnimationAction;

  constructor(
    readonly runtime: ActorRuntime,
    materials: MaterialFactory = defaultMaterials,
  ) {
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

    for (const data of runtime.meshes) {
      const n = data.map.length;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute("uv", new THREE.BufferAttribute(data.uv, 2));
      if (data.joints && data.weights) {
        g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(data.joints, 4));
        g.setAttribute("skinWeight", new THREE.BufferAttribute(data.weights, 4));
      }
      g.setIndex(new THREE.BufferAttribute(data.indices, 1));
      const mesh = new THREE.SkinnedMesh(g, materials(data));
      mesh.name = data.def.name;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false; // bounds change with morphs and animation
      mesh.visible = !data.def.optional;
      this.object.add(mesh);
      this.meshes.set(data.def.name, mesh);
    }
    this.mixer = new THREE.AnimationMixer(this.object);
  }

  setVisible(name: string, visible: boolean): void {
    const mesh = this.meshes.get(name);
    if (mesh) mesh.visible = visible;
    this.updateHiddenSkin();
  }

  /** Writes a new shape into the GPU buffers and re-binds the skeleton to it. */
  applyShape(shape: ActorShape): void {
    this.lastShape = shape;
    for (const data of this.runtime.meshes) {
      const mesh = this.meshes.get(data.def.name)!;
      const src = data.def.source.kind === "base" ? shape : shape.proxies.get(data.def.source.proxy)!;
      const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      const nor = mesh.geometry.getAttribute("normal") as THREE.BufferAttribute;
      const p = pos.array as Float32Array, nn = nor.array as Float32Array;
      const map = data.map;
      for (let i = 0; i < map.length; i++) {
        const s = map[i] * 3;
        p[i * 3] = src.positions[s];
        p[i * 3 + 1] = src.positions[s + 1];
        p[i * 3 + 2] = src.positions[s + 2];
        nn[i * 3] = src.normals[s];
        nn[i * 3 + 1] = src.normals[s + 1];
        nn[i * 3 + 2] = src.normals[s + 2];
      }
      pos.needsUpdate = true;
      nor.needsUpdate = true;
    }
    this.updateHiddenSkin();
    if (shape.skeleton && this.skeleton) this.rebind(shape.skeleton);
  }

  private lastShape?: ActorShape;

  /** Drops skin triangles hidden under visible garments (e.g. feet under socks) to avoid poke-through. */
  private updateHiddenSkin(): void {
    const hide = new Set<number>();
    for (const data of this.runtime.meshes) {
      if (data.hidesBaseVertices && this.meshes.get(data.def.name)?.visible) for (const v of data.hidesBaseVertices) hide.add(v);
    }
    for (const data of this.runtime.meshes) {
      if (data.def.role !== "body") continue;
      const { indices, map } = data;
      const out = new Uint32Array(indices.length);
      let n = 0;
      for (let t = 0; t < indices.length; t += 3) {
        if (hide.has(map[indices[t]]) && hide.has(map[indices[t + 1]]) && hide.has(map[indices[t + 2]])) continue;
        out[n++] = indices[t];
        out[n++] = indices[t + 1];
        out[n++] = indices[t + 2];
      }
      this.meshes.get(data.def.name)!.geometry.setIndex(new THREE.BufferAttribute(out.slice(0, n), 1));
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
    // Joint positions moved, so rebuild the clip against the new bind pose.
    if (this.clip) this.play(this.clip);
  }

  /** Plays a procedural clip (looping), or stops animation with null. */
  play(clip: AxisClip | null): void {
    const time = this.action?.time ?? 0;
    this.mixer.stopAllAction();
    if (this.action) this.mixer.uncacheClip(this.action.getClip());
    this.action = undefined;
    this.clip = clip ?? undefined;
    if (!clip || !this.fitted) {
      if (this.fitted) this.rebindPoseOnly();
      return;
    }
    this.action = this.mixer.clipAction(this.toThreeClip(clip));
    this.action.play();
    this.action.time = time % clip.duration;
  }

  private rebindPoseOnly(): void {
    const f = this.fitted!;
    f.names.forEach((_, i) => this.bones[i].quaternion.fromArray(f.localRotations[i]));
  }

  /** Converts a procedural clip into a regular three.js AnimationClip for the current bind pose. */
  toThreeClip(clip: AxisClip): THREE.AnimationClip {
    const { times, tracks } = bakeAxisClip(this.fitted!, clip);
    const out = [...tracks].map(([bone, values]) => new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values));
    return new THREE.AnimationClip(clip.name, clip.duration, out);
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }

  /** The lowest point of the current shape (for standing the actor on the ground). */
  groundOffset(): number {
    const p = this.lastShape?.positions;
    const body = this.runtime.meshes.find((m) => m.def.role === "body");
    if (!p || !body) return 0;
    let min = Infinity;
    for (const v of body.map) min = Math.min(min, p[v * 3 + 1]);
    return -min;
  }
}

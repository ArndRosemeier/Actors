/**
 * Node-material twins of ../materials.ts for three's WebGPURenderer (WebGPU and
 * its WebGL 2 fallback): skin, eyes, hair, lashes, garments, wet parts and the
 * generated add-ons, all with dual-quaternion skinning, plus the hem cut and
 * leg colliders. Same looks, same uniforms (ThreeActor writes them), same
 * `userData` contract (`hair`, `tint`, `meanColor`, `alphaShadow`).
 *
 * Every material of a kind builds the same node graph, so all actors share
 * one shader per kind; per-actor values live in uniforms.
 */
import * as THREE from "three";
import { MeshLambertNodeMaterial, MeshPhysicalNodeMaterial, MeshStandardNodeMaterial } from "three/webgpu";
import {
  BRDF_Lambert,
  Fn,
  If,
  TBNViewMatrix,
  attribute,
  clamp,
  diffuseContribution,
  dot,
  exp,
  faceDirection,
  float,
  fract,
  materialColor,
  max,
  mix,
  normalView,
  normalize,
  positionGeometry,
  positionLocal,
  positionView,
  pow,
  property,
  select,
  sin,
  sqrt,
  texture,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from "./tsl";
import type { MeshData, PartMesh } from "@actors/core";
import type { ActorMaterialKit, ThreeActor } from "../index";
import type { ColliderUniforms } from "../colliders";
import type { SkinUniforms } from "../materials";
import { fabricNormalMap, lashAlphaMap, poreNormalMap } from "../procedural";
import { leafTexture, robotMaterialParams, strandTexture } from "../parts";
import { useNodeDqs } from "./dqs";
import { bumpNormal } from "./noise";
import { eyeColor, skinPattern, ss, stubble } from "./patterns";
import type { N } from "./types";

const white = (() => {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
})();
const black = (() => {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  t.needsUpdate = true;
  return t;
})();

type Holder<T> = { value: T };

/** A uniform node that follows a plain `{ value }` holder (numbers are copied each render; colours and vectors are shared objects). */
function follow(h: Holder<number>): N;
function follow<T extends object>(h: Holder<T>): N;
function follow(h: Holder<unknown>): N {
  if (typeof h.value === "number") return uniform(h.value).onRenderUpdate(() => h.value as number);
  return uniform(h.value as never);
}

/** A texture node for a holder's texture (`fallback` if it has none). Set `node.value` to swap it later. */
function textureOf(h: Holder<THREE.Texture | null>, fallback: THREE.Texture): N {
  return texture(h.value ?? fallback);
}

/** Per-actor skin inputs, built once and shared by the actor's skin materials. */
interface SkinNodes {
  u: Record<string, N>;
  maskA: N;
  maskB: N;
  /** Up to four photographic skins and their weights (see blendSkins). */
  layers: N[];
  weights: N;
}

function skinNodes(actor: ThreeActor): SkinNodes {
  const existing = actor.userData.nodeSkin as SkinNodes | undefined;
  if (existing) return existing;
  const s: SkinUniforms = actor.skin;
  const u: Record<string, N> = {};
  for (const [k, h] of Object.entries(s)) if (k !== "uMaskA" && k !== "uMaskB" && k !== "uAlbedo") u[k] = follow(h as Holder<number>);
  const nodes: SkinNodes = {
    u,
    maskA: textureOf(s.uMaskA, black),
    maskB: textureOf(s.uMaskB, black),
    layers: [0, 1, 2, 3].map(() => texture(white)),
    weights: uniform(new THREE.Vector4(1, 0, 0, 0)),
  };
  actor.userData.nodeSkin = nodes;
  return nodes;
}

const skinHash = Fn(([p]: N[]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453))).setLayout({ name: "skin_hash", type: "float", inputs: [{ name: "p", type: "vec2" }] });
const skinNoise = Fn(([p]: N[]) => {
  const i = p.floor().toVar();
  const f = fract(p).toVar();
  const u = f.mul(f).mul(f.mul(-2).add(3)).toVar();
  return mix(mix(skinHash(i), skinHash(i.add(vec2(1, 0))), u.x), mix(skinHash(i.add(vec2(0, 1))), skinHash(i.add(vec2(1, 1))), u.x), u.y);
}).setLayout({ name: "skin_noise", type: "float", inputs: [{ name: "p", type: "vec2" }] });

/** Genital region in local coordinates: s across the cleft, t along it (both -1..1). */
function genitalLocal(box: N, uvS: N): N {
  const c = box.xy.add(box.zw).mul(0.5);
  const h = max(box.zw.sub(box.xy).mul(0.5), vec2(1e-4)).toVar();
  const l = uvS.sub(c).div(h).toVar();
  return select(h.y.greaterThanEqual(h.x), l, l.yx);
}

/** Height field of the vulva: outer labia as two soft ridges, a deep central cleft. */
const vulvaHeight = Fn(([l]: N[]) => {
  const env = ss(1, 0.55, l.y.abs()).mul(ss(1.15, 0.7, l.x.abs()));
  const ridges = exp(pow(l.x.abs().sub(0.32).div(0.2), 2).negate());
  const cleft = exp(pow(l.x.div(0.07), 2).negate()).mul(ss(0.95, 0.5, l.y.add(0.08).abs()));
  return env.mul(ridges.mul(0.5).sub(cleft));
}).setLayout({ name: "vulva_height", type: "float", inputs: [{ name: "l", type: "vec2" }] });

/**
 * Bind-pose position in the pattern space (x, y + ground, -z), passed to the
 * fragment stage. Taken before morphs (the WebGL skin takes it after them):
 * only the face morphs move, by millimetres, so patterns barely notice.
 */
function bindVarying(u: Record<string, N>): N {
  return varying(vec3(positionGeometry.x, positionGeometry.y.add(u.uBind.x), positionGeometry.z.negate()), "v_actorBind");
}

/** Wrapped, per-channel diffuse: light bleeds further around the terminator in red (cheap subsurface scattering). */
function useWrappedDiffuse(mat: MeshPhysicalNodeMaterial, sss: N): void {
  const base = (mat.setupLightingModel as (builder: N) => N).bind(mat);
  mat.setupLightingModel = ((builder: N) => {
    const model = base(builder) as N;
    const direct = model.direct.bind(model);
    model.direct = (inputs: N, b: N) => {
      const { lightDirection, lightColor, reflectedLight } = inputs;
      const ndl = normalView.dot(lightDirection);
      const wrap = vec3(0.5, 0.22, 0.14).mul(sss);
      const wrapped = clamp(ndl.add(wrap).div(wrap.add(1)), 0, 1);
      const extra = wrapped.sub(ndl.clamp(0, 1)).mul(lightColor);
      reflectedLight.directDiffuse.addAssign(extra.mul(BRDF_Lambert({ diffuseColor: diffuseContribution })));
      direct(inputs, b);
    };
    return model;
  }) as never;
}

/** Skin (see createSkinMaterial): region tints, photo skins, stubble, race pattern, pores, wrapped diffuse. */
export function createNodeSkinMaterial(actor: ThreeActor): MeshPhysicalNodeMaterial {
  const nodes = skinNodes(actor);
  const { u } = nodes;
  const mat = new MeshPhysicalNodeMaterial({
    color: 0xffffff,
    roughness: 0.48,
    sheen: 0.3,
    sheenRoughness: 0.6,
    sheenColor: new THREE.Color(0.9, 0.6, 0.55),
    specularIntensity: 0.6,
  });
  // The colour pass computes the pattern once and leaves its bump, roughness and glow in
  // properties for the normal, roughness and emissive slots (built after the colour).
  const spHeight = property("float", "actor_sp_height");
  const spRough = property("float", "actor_sp_rough");
  const spEmit = property("vec3", "actor_sp_emit");
  const uvS = uv();
  const bind = bindVarying(u);
  mat.colorNode = Fn(() => {
    const mA = nodes.maskA.sample(uvS).toVar();
    const mB = nodes.maskB.sample(uvS).toVar();
    const tone = u.uTone.mul(skinNoise(uvS.mul(60)).mul(0.08).add(skinNoise(uvS.mul(400)).mul(0.04)).add(0.95)).toVar();
    tone.assign(mix(tone, tone.mul(u.uLip), mA.r));
    tone.assign(mix(tone, tone.mul(u.uAreola), mA.g));
    tone.assign(mix(tone, mix(tone, vec3(0.95, 0.82, 0.78), 0.6), mA.b));
    tone.assign(mix(tone, tone.mul(vec3(0.93, 0.82, 0.82)), mA.a.mul(0.6)));
    tone.assign(mix(tone, tone.mul(vec3(0.86, 0.66, 0.64)), mB.r.mul(0.7)));
    tone.assign(mix(tone, tone.mul(vec3(0.94, 0.88, 0.86)), mB.g.mul(0.6)));
    tone.assign(mix(tone, tone.mul(vec3(1.02, 0.9, 0.88)), mB.b.mul(0.5)));
    // Photographic skin already carries lips, areolae, nails and mottling.
    const w = nodes.weights;
    const photo = nodes.layers[0].sample(uvS).rgb.mul(w.x)
      .add(nodes.layers[1].sample(uvS).rgb.mul(w.y))
      .add(nodes.layers[2].sample(uvS).rgb.mul(w.z))
      .add(nodes.layers[3].sample(uvS).rgb.mul(w.w));
    tone.assign(mix(tone, photo.mul(u.uAlbedoTint), u.uAlbedoMix));
    const browMask = ss(0.02, 0.3, mB.a);
    tone.assign(mix(tone, u.uBrowColor, browMask.mul(u.uBrowDensity)));
    const stubbled = stubble(tone, mA.r, bind, u.uFace, u.uStubble, u.uStubbleColor);
    const pattern = skinPattern(stubbled, mA.r, mA.b, bind, { pattern: u.uPattern, accent: u.uAccent, bindInfo: u.uBind });
    spHeight.assign(pattern.height);
    spRough.assign(pattern.rough);
    spEmit.assign(pattern.emit);
    // Vulva: deeper, redder inner tissue in the cleft.
    const gl = genitalLocal(u.uGenitalBox, uvS).toVar();
    const inner = exp(pow(gl.x.div(0.11), 2).negate()).mul(ss(0.95, 0.5, gl.y.add(0.08).abs())).mul(mB.r).mul(u.uFemale);
    return vec4(mix(pattern.color, pattern.color.mul(vec3(0.62, 0.36, 0.36)), inner), 1);
  })();
  // Pores (fewer on lips, nails and brows), vulva relief, pattern bumps.
  mat.normalNode = Fn(() => {
    const mA = nodes.maskA.sample(uvS);
    const mB = nodes.maskB.sample(uvS).toVar();
    const pore = texture(poreNormalMap(), uvS.mul(48)).xyz.mul(2).sub(1).toVar();
    const scale = float(1).sub(max(mA.r, mA.b).mul(0.7)).mul(0.35);
    const mapN = vec3(pore.xy.mul(scale), pore.z).toVar();
    If(u.uFemale.greaterThan(0).and(mB.r.greaterThan(0.01)), () => {
      const gl = genitalLocal(u.uGenitalBox, uvS).toVar();
      const e = 0.02;
      const dx = vulvaHeight(gl.add(vec2(e, 0))).sub(vulvaHeight(gl.sub(vec2(e, 0))));
      const dy = vulvaHeight(gl.add(vec2(0, e))).sub(vulvaHeight(gl.sub(vec2(0, e))));
      const g = vec2(dx, dy).div(2 * e).mul(0.35).mul(u.uFemale).mul(mB.r).toVar();
      const h = u.uGenitalBox.zw.sub(u.uGenitalBox.xy).mul(0.5);
      mapN.assign(vec3(mapN.xy.sub(select(h.y.greaterThanEqual(h.x), g, g.yx)), mapN.z));
    });
    const n = normalize(TBNViewMatrix.mul(mapN)).toVar();
    If(spHeight.notEqual(0), () => {
      n.assign(bumpNormal(positionView, n, spHeight, faceDirection));
    });
    return n;
  })();
  mat.roughnessNode = select(spRough.greaterThanEqual(0), spRough, float(0.48));
  mat.emissiveNode = spEmit;
  useWrappedDiffuse(mat, u.uSSS);
  return useNodeDqs(mat);
}

/** Eyes (see createEyeMaterial): iris colour shift, pupil shapes, iris glow, wet clear coat. */
export function createNodeEyeMaterial(map: THREE.Texture | null, actor: ThreeActor): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial({ map, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.02, ior: 1.376 });
  if (map) {
    const e = actor.eye;
    const glow = property("vec3", "actor_eye_emit");
    mat.colorNode = Fn(() => {
      const { color, emit } = eyeColor(map, uv(), { hue: follow(e.uIrisHue), sat: follow(e.uIrisSat), light: follow(e.uIrisLight), pupil: follow(e.uPupil) });
      glow.assign(emit);
      return vec4(color, 1);
    })();
    mat.emissiveNode = glow;
  }
  return useNodeDqs(mat);
}

/** Recolours the material's colour (color x map) to `tint`, keeping its brightness pattern; mix 0 = own colour. */
function tinted(tint: N, mixNode: N, meanLum: N, maxGain: number): N {
  const base = materialColor;
  const lum = dot(base.rgb, vec3(0.2126, 0.7152, 0.0722));
  return vec4(mix(base.rgb, tint.mul(clamp(lum.div(meanLum), 0, maxGain)), mixNode), base.a);
}

/** Garment (see createClothMaterial), recolourable through `userData.tint`. */
export function createNodeClothMaterial(
  color: THREE.Color,
  roughness: number,
  fabric: string,
  layer: number,
  map: THREE.Texture | null = null,
  normal: THREE.Texture | null = null,
  meanLum = 0.2,
): MeshStandardNodeMaterial {
  let normalMap = normal;
  if (!normalMap) {
    normalMap = fabricNormalMap(fabric).clone();
    normalMap.repeat.set(24, 24);
  }
  const mat = new MeshStandardNodeMaterial({
    color: map ? new THREE.Color(1, 1, 1) : color,
    map,
    roughness,
    normalMap,
    normalScale: normal ? new THREE.Vector2(1, 1) : new THREE.Vector2(0.6, 0.6),
    alphaTest: map ? 0.5 : 0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2 * layer,
    polygonOffsetUnits: -4 * layer,
  });
  const tint = { uTint: uniform(new THREE.Color(1, 1, 1)), uTintMix: uniform(0), uTintMeanLum: uniform(Math.max(0.01, meanLum)) };
  mat.userData.tint = tint;
  mat.colorNode = tinted(tint.uTint, tint.uTintMix, tint.uTintMeanLum, 3);
  return useNodeDqs(mat);
}

/** Cuts away fragments where the `clipValue` attribute is below 0 (smooth garment hems). */
export function useNodeClip<T extends THREE.Material>(material: T): T {
  (material as unknown as { maskNode: N }).maskNode = attribute("clipValue", "float").greaterThanEqual(0);
  return material;
}

/** Pushes a skirt-like garment out of the leg capsules after skinning (see colliders.ts). */
export function useNodeColliders<T extends THREE.Material>(material: T, c: ColliderUniforms): T {
  const capA = c.uCapA.value.map((v) => uniform(v));
  const capB = c.uCapB.value.map((v) => uniform(v));
  const center = uniform(c.uCenter.value);
  (material as unknown as { positionNode: N }).positionNode = Fn(() => {
    const p = vec3(positionLocal).toVar();
    const out = p.sub(center).mul(vec3(1, 0, 1)).toVar();
    const n = select(out.length().greaterThan(1e-4), normalize(out), vec3(0, 0, 1)).toVar();
    for (let i = 0; i < capA.length; i++) {
      const a = capA[i].xyz, r = capA[i].w;
      If(r.greaterThan(0), () => {
        const ab = capB[i].sub(a).toVar();
        const len = max(ab.length(), 1e-5).toVar();
        const axis = ab.div(len).toVar();
        const h = clamp(dot(p.sub(a), axis), 0, len);
        const d = p.sub(a.add(axis.mul(h))).toVar();
        const dist = d.length().toVar();
        const soft = r.mul(1.6).toVar();
        If(dist.lessThan(soft), () => {
          // Monotonic remap [0, soft] -> [r, soft]: stacked cloth layers keep their order.
          const target = r.add(soft.sub(r).mul(dist.div(soft)));
          const m = n.sub(axis.mul(dot(n, axis))).toVar();
          const ml = m.length().toVar();
          If(ml.greaterThanEqual(1e-3), () => {
            m.divAssign(ml);
            const dm = dot(d, m).toVar();
            const s = dm.negate().add(sqrt(max(dm.mul(dm).sub(dist.mul(dist)).add(target.mul(target)), 0)));
            p.addAssign(m.mul(s.min(0.3)));
          });
        });
      });
    }
    return p;
  })();
  return material;
}

/** Eyelashes: Lambert (no specular highlights on thin dark hairs). */
export function createNodeLashMaterial(color: THREE.Color): MeshLambertNodeMaterial {
  return useNodeDqs(new MeshLambertNodeMaterial({ color, alphaMap: lashAlphaMap(), transparent: true, depthWrite: false, side: THREE.DoubleSide }));
}

/** Hair cards and eyebrows (see createHairMaterial), recolourable through `userData.hair`. */
export function createNodeHairMaterial(map: THREE.Texture | null, blended = false): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial({
    map,
    ...(blended ? { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 } : { alphaTest: 0.35, alphaToCoverage: true }),
    side: THREE.DoubleSide,
    roughness: 0.55,
    sheen: 0.6,
    sheenRoughness: 0.35,
    sheenColor: new THREE.Color(0.35, 0.3, 0.25),
    specularIntensity: 0.35,
  });
  const hair = { uHairTint: uniform(new THREE.Color(1, 1, 1)), uHairMix: uniform(0), uHairMeanLum: uniform(0.2) };
  mat.userData.hair = hair;
  mat.userData.alphaShadow = !blended;
  mat.colorNode = tinted(hair.uHairTint, hair.uHairMix, hair.uHairMeanLum, 2.5);
  return useNodeDqs(mat);
}

export function createNodeWetMaterial(color: THREE.Color, roughness: number): MeshPhysicalNodeMaterial {
  return useNodeDqs(new MeshPhysicalNodeMaterial({ color, roughness, clearcoat: 0.6, clearcoatRoughness: 0.2 }));
}

/** Material for a generated add-on (see createPartMaterial). */
export function createNodePartMaterial(part: PartMesh, actor: ThreeActor): THREE.Material {
  const color = new THREE.Color().setRGB(...(part.color ?? [0.3, 0.2, 0.12]), THREE.SRGBColorSpace);
  const robot = robotMaterialParams(part.kind);
  if (robot) {
    const m = useNodeDqs(new MeshPhysicalNodeMaterial(robot));
    if (part.kind === "glow") m.userData.emissiveTint = true;
    return m;
  }
  switch (part.kind) {
    case "skin":
      return createNodeSkinMaterial(actor);
    case "fin": {
      const m = createNodeSkinMaterial(actor);
      m.side = THREE.DoubleSide;
      return m;
    }
    case "hair":
    case "leaf": {
      const m = useNodeDqs(
        new MeshPhysicalNodeMaterial({
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
      m.userData.alphaShadow = true;
      return m;
    }
    case "fur":
      return useNodeDqs(new MeshStandardNodeMaterial({ color, vertexColors: true, roughness: 0.9 }));
    case "tusk":
      return useNodeDqs(new MeshPhysicalNodeMaterial({ color, vertexColors: true, roughness: 0.35, clearcoat: 0.4, clearcoatRoughness: 0.3 }));
    default:
      return useNodeDqs(new MeshPhysicalNodeMaterial({ color, vertexColors: true, roughness: 0.45, clearcoat: 0.25, clearcoatRoughness: 0.4 }));
  }
}

/** Crowd-level merged mesh (see createCrowdMaterial): garment vertex colours, skin tone or photo skin where `crowdSkin` is 1. Linear skinning. */
export function createNodeCrowdMaterial(actor: ThreeActor): MeshStandardNodeMaterial {
  const nodes = skinNodes(actor);
  const { u } = nodes;
  const mat = new MeshStandardNodeMaterial({ roughness: 0.7, metalness: 0 });
  const uvS = uv();
  const w = nodes.weights;
  const photo = nodes.layers[0].sample(uvS).rgb.mul(w.x)
    .add(nodes.layers[1].sample(uvS).rgb.mul(w.y))
    .add(nodes.layers[2].sample(uvS).rgb.mul(w.z))
    .add(nodes.layers[3].sample(uvS).rgb.mul(w.w));
  const skin = mix(u.uTone, photo.mul(u.uAlbedoTint), u.uAlbedoMix);
  mat.colorNode = vec4(mix(attribute("color", "vec3"), skin, attribute("crowdSkin", "float")), 1);
  // Hems: cut where the interpolated clip value is below 0.
  (mat as unknown as { maskNode: N }).maskNode = attribute("crowdClip", "float").greaterThanEqual(0);
  return mat;
}

/** Node materials for a pack mesh, from the pack's material hints (the twin of `defaultMaterials`). */
export function nodeMeshMaterial(data: MeshData, actor: ThreeActor): THREE.Material {
  const { def } = data;
  const color = new THREE.Color(...(def.material.color ?? [0.8, 0.8, 0.8]));
  const tex = (key: "color" | "normal" | "maskA" | "maskB", srgb = false) => {
    const file = def.textures?.[key];
    return file ? actor.texture(file, srgb) : null;
  };
  switch (def.material.kind) {
    case "skin": {
      actor.skin.uMaskA.value ??= tex("maskA");
      actor.skin.uMaskB.value ??= tex("maskB");
      return createNodeSkinMaterial(actor);
    }
    case "eye":
      return createNodeEyeMaterial(tex("color", true), actor);
    case "teeth":
      return createNodeWetMaterial(new THREE.Color(0.92, 0.89, 0.8), 0.25);
    case "mouth":
      return createNodeWetMaterial(new THREE.Color(0.75, 0.38, 0.38), 0.4);
    case "hair":
      if (def.textures?.color) {
        const mat = createNodeHairMaterial(tex("color", true), def.tags?.includes("brows"));
        mat.userData.meanColor = new THREE.Color().setRGB(...(def.material.color ?? [0.3, 0.2, 0.1]), THREE.SRGBColorSpace);
        return mat;
      }
      return createNodeLashMaterial(new THREE.Color(0.05, 0.035, 0.03));
    case "cloth": {
      const fabric = def.tags?.find((t) => t.startsWith("fabric:"))?.slice(7) ?? "smooth";
      const layer = (def.source.kind === "proxy" ? 2 : 1) + (def.inflate ?? 0) * 100;
      const mean = def.textures?.color ? new THREE.Color().setRGB(...(def.material.color ?? [0.5, 0.5, 0.5]), THREE.SRGBColorSpace) : color;
      const meanLum = 0.2126 * mean.r + 0.7152 * mean.g + 0.0722 * mean.b;
      let mat: THREE.Material = createNodeClothMaterial(color, def.material.roughness ?? 0.7, fabric, layer, tex("color", true), tex("normal"), meanLum);
      if (data.clip) mat = useNodeClip(mat);
      const blended = def.source.kind === "proxy" && actor.runtime.manifest.proxies.find((p) => p.name === (def.source as { proxy: string }).proxy)?.legBlend;
      return blended ? useNodeColliders(mat, actor.colliders) : mat;
    }
    default:
      return useNodeDqs(new MeshStandardNodeMaterial({ color, roughness: def.material.roughness ?? 0.6 }));
  }
}

/**
 * The kit for three's WebGPURenderer: `new ThreeActor(runtime, nodeMaterials)`
 * or `Character.load({ ..., materials: nodeMaterials })`. Works on both of the
 * renderer's backends (WebGPU, and WebGL 2 with `forceWebGL`).
 */
export const nodeMaterials: ActorMaterialKit = {
  mesh: nodeMeshMaterial,
  part: createNodePartMaterial,
  depth: () => null,
  crowd: createNodeCrowdMaterial,
  blendSkins(actor, layers) {
    const nodes = skinNodes(actor);
    for (let i = 0; i < 4; i++) nodes.layers[i].value = layers[i]?.texture ?? white;
    nodes.weights.value.set(layers[0]?.weight ?? 0, layers[1]?.weight ?? 0, layers[2]?.weight ?? 0, layers[3]?.weight ?? 0);
  },
};

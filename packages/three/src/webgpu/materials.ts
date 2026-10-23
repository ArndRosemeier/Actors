/**
 * Node-material twins of ../materials.ts for three's WebGPURenderer (WebGPU and
 * its WebGL 2 fallback): skin, eyes, hair, lashes, garments, wet parts and the
 * generated add-ons, all with dual-quaternion skinning, plus the hem cut and
 * leg colliders. Same looks, same uniforms (ThreeActor writes them), same
 * `userData` contract (`hair`, `tint`, `meanColor`, `alphaShadow`).
 *
 * Every material of a kind uses one node graph, built once (three keys a
 * shader by its nodes, so a graph per material would be a shader per
 * material): all actors share one shader per kind. Each material's own values
 * (an actor's skin, a garment's tint) are inputs the graph reads at each draw
 * (`input`, `inputTexture`, `feed`).
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
import { MAX_COLLIDERS, type ColliderUniforms } from "../colliders";
import { garmentLayer } from "../layers";
import { createSkinUniforms, type SkinUniforms } from "../materials";
import { fabricNormalMap, lashAlphaMap, poreNormalMap } from "../procedural";
import { type ScreenTexturePool, useScreenMaterial } from "../screens";
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

/** A material's own values for its kind's shared graph, by input name (read at each draw). */
type Inputs = Record<string, () => unknown>;

/** Gives `mat` its values for the shared graph's inputs (see `input`). Returns `mat`. */
function feed<T extends THREE.Material>(mat: T, inputs: Inputs): T {
  mat.userData.actorInputs = { ...(mat.userData.actorInputs as Inputs | undefined), ...inputs };
  return mat;
}

function read(frame: { material?: THREE.Material | null }, name: string): unknown {
  return (frame.material?.userData.actorInputs as Inputs | undefined)?.[name]?.();
}

/**
 * A uniform of a shared graph: at each draw it takes the drawn material's value
 * `name` (`feed`). `initial` gives its type. (Another pass's own material, a
 * shadow's, has none: the uniform keeps its last value, which that pass does not use.)
 */
function input(name: string, initial: unknown): N {
  return uniform(initial as never).onObjectUpdate((frame: { material?: THREE.Material | null }) => read(frame, name));
}

/** A texture of a shared graph, sampled at `at` (default uv) and mip `level` (default auto): the drawn material's texture `name`, else `fallback`. */
function inputTexture(name: string, fallback: THREE.Texture, at?: N, level?: N | number): N {
  const node = texture(fallback, at, level as N | undefined).onObjectUpdate((frame: { material?: THREE.Material | null }) => read(frame, name) ?? fallback);
  // three merges texture uniforms by their texture's uuid at build time, which would fold
  // inputs that start on the same fallback (the skin's four layers) into one slot.
  (node as unknown as { getUniformHash: () => string }).getUniformHash = () => `actorInput:${name}`;
  return node;
}

/** `make` once, on first use (graphs are built when the first material of a kind is). */
function once<T>(make: () => T): () => T {
  let made: T | undefined;
  return () => (made ??= make());
}

/** Per-actor photographic skins and their weights (see blendSkins). */
interface SkinLayers {
  layers: THREE.Texture[];
  weights: THREE.Vector4;
}

function skinLayers(actor: ThreeActor): SkinLayers {
  const existing = actor.userData.nodeSkin as SkinLayers | undefined;
  if (existing) return existing;
  const layers: SkinLayers = { layers: [white, white, white, white], weights: new THREE.Vector4(1, 0, 0, 0) };
  actor.userData.nodeSkin = layers;
  return layers;
}

/** The skin's uniforms that are values (not textures), by name. */
const SKIN_VALUES = Object.keys(createSkinUniforms()).filter((k) => k !== "uMaskA" && k !== "uMaskB" && k !== "uAlbedo") as (keyof SkinUniforms)[];

/** An actor's skin inputs for a skin material (see `skinGraph`). */
function skinInputs(actor: ThreeActor): Inputs {
  const s = actor.skin, l = skinLayers(actor);
  const inputs: Inputs = {
    "skin.maskA": () => s.uMaskA.value ?? black,
    "skin.maskB": () => s.uMaskB.value ?? black,
    "skin.weights": () => l.weights,
  };
  for (const k of SKIN_VALUES) inputs[`skin.${k}`] = () => s[k].value;
  for (let i = 0; i < 4; i++) inputs[`skin.layer${i}`] = () => l.layers[i];
  return inputs;
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

/**
 * The skin's shared graph (see createSkinMaterial): region tints, photo skins,
 * stubble, race pattern, pores. The colour pass computes the pattern once and
 * leaves its bump, roughness and glow in properties for the normal, roughness
 * and emissive slots (built after the colour).
 */
const skinGraph = once(() => {
  const u: Record<string, N> = {};
  const template = createSkinUniforms();
  for (const k of SKIN_VALUES) {
    const v = template[k].value as unknown;
    u[k] = input(`skin.${k}`, typeof v === "number" ? v : (v as THREE.Color | THREE.Vector4).clone());
  }
  const spHeight = property("float", "actor_sp_height");
  const spRough = property("float", "actor_sp_rough");
  const spEmit = property("vec3", "actor_sp_emit");
  const uvS = uv();
  const bind = bindVarying(u);
  const maskA = () => inputTexture("skin.maskA", black, uvS);
  const maskB = () => inputTexture("skin.maskB", black, uvS);
  const weights = input("skin.weights", new THREE.Vector4(1, 0, 0, 0));
  const color = Fn(() => {
    const mA = maskA().toVar();
    const mB = maskB().toVar();
    const tone = u.uTone.mul(skinNoise(uvS.mul(60)).mul(0.08).add(skinNoise(uvS.mul(400)).mul(0.04)).add(0.95)).toVar();
    tone.assign(mix(tone, tone.mul(u.uLip), mA.r));
    tone.assign(mix(tone, tone.mul(u.uAreola), mA.g));
    tone.assign(mix(tone, mix(tone, vec3(0.95, 0.82, 0.78), 0.6), mA.b));
    tone.assign(mix(tone, tone.mul(vec3(0.93, 0.82, 0.82)), mA.a.mul(0.6)));
    tone.assign(mix(tone, tone.mul(vec3(0.86, 0.66, 0.64)), mB.r.mul(0.7)));
    tone.assign(mix(tone, tone.mul(vec3(0.94, 0.88, 0.86)), mB.g.mul(0.6)));
    tone.assign(mix(tone, tone.mul(vec3(1.02, 0.9, 0.88)), mB.b.mul(0.5)));
    // Photographic skin already carries lips, areolae, nails and mottling.
    const layer = (i: number) => inputTexture(`skin.layer${i}`, white, uvS).rgb;
    const photo = layer(0).mul(weights.x).add(layer(1).mul(weights.y)).add(layer(2).mul(weights.z)).add(layer(3).mul(weights.w));
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
  const normal = Fn(() => {
    const mA = maskA();
    const mB = maskB().toVar();
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
  return { color, normal, rough: select(spRough.greaterThanEqual(0), spRough, float(0.48)), emit: spEmit, sss: u.uSSS };
});

/** Skin (see createSkinMaterial): region tints, photo skins, stubble, race pattern, pores, wrapped diffuse. */
export function createNodeSkinMaterial(actor: ThreeActor): MeshPhysicalNodeMaterial {
  const g = skinGraph();
  const mat = new MeshPhysicalNodeMaterial({
    color: 0xffffff,
    roughness: 0.48,
    sheen: 0.3,
    sheenRoughness: 0.6,
    sheenColor: new THREE.Color(0.9, 0.6, 0.55),
    specularIntensity: 0.6,
  });
  mat.colorNode = g.color;
  mat.normalNode = g.normal;
  mat.roughnessNode = g.rough;
  mat.emissiveNode = g.emit;
  useWrappedDiffuse(mat, g.sss);
  return useNodeDqs(feed(mat, skinInputs(actor)));
}

/** The eye's shared graph (see createEyeMaterial): iris colour shift, pupil shapes, iris glow. */
const eyeGraph = once(() => {
  const glow = property("vec3", "actor_eye_emit");
  const color = Fn(() => {
    const { color: c, emit } = eyeColor((at: N) => inputTexture("eye.map", white, at), uv(), {
      hue: input("eye.hue", -1),
      sat: input("eye.sat", 1),
      light: input("eye.light", 1),
      pupil: input("eye.pupil", new THREE.Vector4(0, 0.5, 0, 0)),
    });
    glow.assign(emit);
    return vec4(c, 1);
  })();
  return { color, emit: glow };
});

/** Eyes (see createEyeMaterial): iris colour shift, pupil shapes, iris glow, wet clear coat. */
export function createNodeEyeMaterial(map: THREE.Texture | null, actor: ThreeActor): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial({ map, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.02, ior: 1.376 });
  if (map) {
    const e = actor.eye, g = eyeGraph();
    mat.colorNode = g.color;
    mat.emissiveNode = g.emit;
    feed(mat, { "eye.map": () => map, "eye.hue": () => e.uIrisHue.value, "eye.sat": () => e.uIrisSat.value, "eye.light": () => e.uIrisLight.value, "eye.pupil": () => e.uPupil.value });
  }
  return useNodeDqs(mat);
}

/** Recolours the material's colour (color x map) to `tint`, keeping its brightness pattern; mix 0 = own colour. */
function tinted(tint: N, mixNode: N, meanLum: N, maxGain: number): N {
  const base = materialColor;
  const lum = dot(base.rgb, vec3(0.2126, 0.7152, 0.0722));
  return vec4(mix(base.rgb, tint.mul(clamp(lum.div(meanLum), 0, maxGain)), mixNode), base.a);
}

/** A garment's colour, recoloured to its tint (shared graph). */
const clothColor = once(() => tinted(input("tint.color", new THREE.Color(1, 1, 1)), input("tint.mix", 0), input("tint.meanLum", 0.2), 3));

/** A garment's cut-out: its colour texture's alpha at full resolution (shared graph). */
const clothCutout = once(() => inputTexture("cloth.map", white, undefined, 0).a);

/** Hair's colour, recoloured to its tint (shared graph). */
const hairColor = once(() => tinted(input("hair.color", new THREE.Color(1, 1, 1)), input("hair.mix", 0), input("hair.meanLum", 0.2), 2.5));

/** Garment (see createClothMaterial), recolourable through `userData.tint`. */
export function createNodeClothMaterial(
  color: THREE.Color,
  roughness: number,
  fabric: string,
  layer: number,
  map: THREE.Texture | null = null,
  normal: THREE.Texture | null = null,
  meanLum = 0.2,
  screenTextures?: ScreenTexturePool | null,
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
  const tint = { uTint: { value: new THREE.Color(1, 1, 1) }, uTintMix: { value: 0 }, uTintMeanLum: { value: Math.max(0.01, meanLum) } };
  mat.userData.tint = tint;
  mat.colorNode = clothColor();
  // Cut-outs from the texture's full-resolution alpha (see createClothMaterial: mip levels punched holes along seams).
  if (map) mat.opacityNode = clothCutout();
  if (fabric === "screen") useScreenMaterial(mat, color, screenTextures);
  return useNodeDqs(feed(mat, { "tint.color": () => tint.uTint.value, "tint.mix": () => tint.uTintMix.value, "tint.meanLum": () => tint.uTintMeanLum.value, "cloth.map": () => map }));
}

const clipMask = once(() => attribute("clipValue", "float").greaterThanEqual(0));

/** Cuts away fragments where the `clipValue` attribute is below 0 (smooth garment hems). */
export function useNodeClip<T extends THREE.Material>(material: T): T {
  (material as unknown as { maskNode: N }).maskNode = clipMask();
  return material;
}

/** The leg colliders' shared graph (see useNodeColliders). */
const collidersGraph = once(() => {
  const capA = Array.from({ length: MAX_COLLIDERS }, (_, i) => input(`cap.a${i}`, new THREE.Vector4()));
  const capB = Array.from({ length: MAX_COLLIDERS }, (_, i) => input(`cap.b${i}`, new THREE.Vector3()));
  const center = input("cap.center", new THREE.Vector3());
  return Fn(() => {
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
});

/** Pushes a skirt-like garment out of the leg capsules after skinning (see colliders.ts). */
export function useNodeColliders<T extends THREE.Material>(material: T, c: ColliderUniforms): T {
  (material as unknown as { positionNode: N }).positionNode = collidersGraph();
  const inputs: Inputs = { "cap.center": () => c.uCenter.value };
  for (let i = 0; i < MAX_COLLIDERS; i++) {
    inputs[`cap.a${i}`] = () => c.uCapA.value[i];
    inputs[`cap.b${i}`] = () => c.uCapB.value[i];
  }
  return feed(material, inputs);
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
  const hair = { uHairTint: { value: new THREE.Color(1, 1, 1) }, uHairMix: { value: 0 }, uHairMeanLum: { value: 0.2 } };
  mat.userData.hair = hair;
  mat.userData.alphaShadow = !blended;
  mat.colorNode = hairColor();
  return useNodeDqs(feed(mat, { "hair.color": () => hair.uHairTint.value, "hair.mix": () => hair.uHairMix.value, "hair.meanLum": () => hair.uHairMeanLum.value }));
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

/** The crowd material's shared graph (see createNodeCrowdMaterial). */
const crowdGraph = once(() => {
  const uvS = uv();
  const w = input("skin.weights", new THREE.Vector4(1, 0, 0, 0));
  const layer = (i: number) => inputTexture(`skin.layer${i}`, white, uvS).rgb;
  const photo = layer(0).mul(w.x).add(layer(1).mul(w.y)).add(layer(2).mul(w.z)).add(layer(3).mul(w.w));
  const skin = mix(input("skin.uTone", new THREE.Color()), photo.mul(input("skin.uAlbedoTint", new THREE.Color())), input("skin.uAlbedoMix", 0));
  return {
    color: vec4(mix(attribute("color", "vec3"), skin, attribute("crowdSkin", "float")), 1),
    // Hems: cut where the interpolated clip value is below 0.
    mask: attribute("crowdClip", "float").greaterThanEqual(0),
  };
});

/** Crowd-level merged mesh (see createCrowdMaterial): garment vertex colours, skin tone or photo skin where `crowdSkin` is 1. Linear skinning. */
export function createNodeCrowdMaterial(actor: ThreeActor): MeshStandardNodeMaterial {
  const g = crowdGraph();
  const mat = new MeshStandardNodeMaterial({ roughness: 0.7, metalness: 0 });
  mat.colorNode = g.color;
  (mat as unknown as { maskNode: N }).maskNode = g.mask;
  return feed(mat, skinInputs(actor));
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
      const layer = garmentLayer(def);
      const mean = def.textures?.color ? new THREE.Color().setRGB(...(def.material.color ?? [0.5, 0.5, 0.5]), THREE.SRGBColorSpace) : color;
      const meanLum = 0.2126 * mean.r + 0.7152 * mean.g + 0.0722 * mean.b;
      let mat: THREE.Material = createNodeClothMaterial(color, def.material.roughness ?? 0.7, fabric, layer, tex("color", true), tex("normal"), meanLum, actor.screenTextures);
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
  attributeMorphs: true,
  mesh: nodeMeshMaterial,
  part: createNodePartMaterial,
  depth: () => null,
  crowd: createNodeCrowdMaterial,
  blendSkins(actor, layers) {
    const nodes = skinLayers(actor);
    for (let i = 0; i < 4; i++) nodes.layers[i] = layers[i]?.texture ?? white;
    nodes.weights.set(layers[0]?.weight ?? 0, layers[1]?.weight ?? 0, layers[2]?.weight ?? 0, layers[3]?.weight ?? 0);
  },
};

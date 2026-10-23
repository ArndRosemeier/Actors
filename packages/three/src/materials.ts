import * as THREE from "three";
import { useDualQuaternionSkinning } from "./dqs";
import { GLSL_BIND_VERTEX, GLSL_EYE, GLSL_NOISE, GLSL_PATTERN, GLSL_STUBBLE } from "./racepatterns";
import { fabricNormalMap, lashAlphaMap, poreNormalMap } from "./procedural";
import { type ScreenTexturePool, useScreenMaterial } from "./screens";

/**
 * Skin: physically based base + region tints from masks (lips, areolae,
 * nails, eyelids, genitals, ears, brows), pore-level normal detail, wrapped
 * per-channel diffuse as a cheap subsurface-scattering approximation, and
 * procedural vulva detail in the genital region (adult-only actors).
 */
export interface SkinUniforms {
  uTone: { value: THREE.Color };
  uMaskA: { value: THREE.Texture | null };
  uMaskB: { value: THREE.Texture | null };
  uLip: { value: THREE.Color };
  uAreola: { value: THREE.Color };
  uBrowColor: { value: THREE.Color };
  uBrowDensity: { value: number };
  uGenitalBox: { value: THREE.Vector4 };
  uFemale: { value: number };
  uSSS: { value: number };
  /** Photographic albedo (body UV layout). Used when uAlbedoMix > 0. */
  uAlbedo: { value: THREE.Texture | null };
  /** 0 = procedural tone + region tints, 1 = photographic albedo. */
  uAlbedoMix: { value: number };
  /** Per-channel factor on the photographic albedo (recolours it, e.g. to an orc's green; linear, white = unchanged). */
  uAlbedoTint: { value: THREE.Color };
  /** Race skin pattern: x id (see SKIN_PATTERNS), y strength 0..1, z seed, w glow. */
  uPattern: { value: THREE.Vector4 };
  /** Pattern colour (linear). */
  uAccent: { value: THREE.Color };
  /** x ground offset, y body scale, z/w head joint height and depth (pattern space, see racepatterns.ts). */
  uBind: { value: THREE.Vector4 };
  /** Eye midpoint in pattern space (vBind) and eye distance (w); w = 0 disables face-space painting. */
  uFace: { value: THREE.Vector4 };
  /** Painted stubble: x density 0..1, y beard region (0 full .. 4 chinstrap), z seed. */
  uStubble: { value: THREE.Vector4 };
  /** Stubble colour (linear). */
  uStubbleColor: { value: THREE.Color };
}

export function createSkinUniforms(): SkinUniforms {
  return {
    uTone: { value: new THREE.Color(0.8, 0.6, 0.5) },
    uMaskA: { value: null },
    uMaskB: { value: null },
    uLip: { value: new THREE.Color(1.0, 0.62, 0.62) },
    uAreola: { value: new THREE.Color(0.78, 0.58, 0.52) },
    uBrowColor: { value: new THREE.Color(0.03, 0.02, 0.012) },
    uBrowDensity: { value: 0.92 },
    uGenitalBox: { value: new THREE.Vector4(0, 0, 0, 0) },
    uFemale: { value: 0 },
    uSSS: { value: 1 },
    uAlbedo: { value: null },
    uAlbedoMix: { value: 0 },
    uAlbedoTint: { value: new THREE.Color(1, 1, 1) },
    uPattern: { value: new THREE.Vector4(0, 0, 0, 0) },
    uAccent: { value: new THREE.Color(0.2, 0.15, 0.1) },
    uBind: { value: new THREE.Vector4(0.85, 1, 1.55, 0) },
    uFace: { value: new THREE.Vector4(0, 0, 0, 0) },
    uStubble: { value: new THREE.Vector4(0, 0, 0, 0) },
    uStubbleColor: { value: new THREE.Color(0.03, 0.02, 0.015) },
  };
}

const SKIN_FRAG_PARS = /* glsl */ `
uniform vec3 uTone;
uniform sampler2D uMaskA;
uniform sampler2D uMaskB;
uniform vec3 uLip;
uniform vec3 uAreola;
uniform vec3 uBrowColor;
uniform float uBrowDensity;
uniform vec4 uGenitalBox;
uniform float uFemale;
uniform float uSSS;
uniform sampler2D uAlbedo;
uniform float uAlbedoMix;
uniform vec3 uAlbedoTint;
uniform vec4 uPattern;
uniform vec3 uAccent;
uniform vec4 uBind;
uniform vec4 uFace;
uniform vec4 uStubble;
uniform vec3 uStubbleColor;
varying vec2 vSkinUv;
varying vec3 vBind;
${GLSL_NOISE}
${GLSL_PATTERN}
${GLSL_STUBBLE}

float skinHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float skinNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( skinHash( i ), skinHash( i + vec2( 1, 0 ) ), u.x ), mix( skinHash( i + vec2( 0, 1 ) ), skinHash( i + vec2( 1, 1 ) ), u.x ), u.y );
}
// Genital region in local coordinates: s across the cleft, t along it (both -1..1).
vec2 genitalLocal() {
  vec2 c = 0.5 * ( uGenitalBox.xy + uGenitalBox.zw );
  vec2 h = max( 0.5 * ( uGenitalBox.zw - uGenitalBox.xy ), vec2( 1e-4 ) );
  vec2 l = ( vSkinUv - c ) / h;
  return ( h.y >= h.x ) ? l : l.yx;
}
// Height field of the vulva: outer labia as two soft ridges, a deep central cleft.
float vulvaHeight( vec2 l ) {
  float env = smoothstep( 1.0, 0.55, abs( l.y ) ) * smoothstep( 1.15, 0.7, abs( l.x ) );
  float ridges = exp( -pow( ( abs( l.x ) - 0.32 ) / 0.2, 2.0 ) );
  float cleft = exp( -pow( l.x / 0.07, 2.0 ) ) * smoothstep( 0.95, 0.5, abs( l.y + 0.08 ) );
  return env * ( 0.5 * ridges - cleft );
}
`;

const SKIN_ALBEDO = /* glsl */ `
vec4 mA = texture2D( uMaskA, vSkinUv );
vec4 mB = texture2D( uMaskB, vSkinUv );
vec3 tone = uTone;
// Large, soft colour variation (blotchiness) and fine mottling.
tone *= 0.95 + 0.08 * skinNoise( vSkinUv * 60.0 ) + 0.04 * skinNoise( vSkinUv * 400.0 );
tone = mix( tone, tone * uLip, mA.r );
tone = mix( tone, tone * uAreola, mA.g );
tone = mix( tone, mix( tone, vec3( 0.95, 0.82, 0.78 ), 0.6 ), mA.b );
tone = mix( tone, tone * vec3( 0.93, 0.82, 0.82 ), mA.a * 0.6 );
tone = mix( tone, tone * vec3( 0.86, 0.66, 0.64 ), mB.r * 0.7 );
tone = mix( tone, tone * vec3( 0.94, 0.88, 0.86 ), mB.g * 0.6 );
tone = mix( tone, tone * vec3( 1.02, 0.9, 0.88 ), mB.b * 0.5 );
// Photographic skin already carries lips, areolae, nails and mottling.
if ( uAlbedoMix > 0.0 ) tone = mix( tone, texture2D( uAlbedo, vSkinUv ).rgb * uAlbedoTint, uAlbedoMix );
float browHair = smoothstep( 0.3, 0.7, skinNoise( vSkinUv * vec2( 3000.0, 900.0 ) ) );
float browMask = smoothstep( 0.02, 0.3, mB.a );
tone = mix( tone, uBrowColor, browMask * uBrowDensity );
tone = stubble( tone, mA.r );
// Fantasy-race pattern (scales, bark, veins...).
if ( uPattern.x > 0.5 ) tone = skinPattern( tone, mA.r, mA.b );
// Vulva: deeper, redder inner tissue in the cleft.
vec2 gl = genitalLocal();
float inner = exp( -pow( gl.x / 0.11, 2.0 ) ) * smoothstep( 0.95, 0.5, abs( gl.y + 0.08 ) ) * mB.r * uFemale;
tone = mix( tone, tone * vec3( 0.62, 0.36, 0.36 ), inner );
diffuseColor.rgb *= tone;
`;

const SKIN_NORMAL = /* glsl */ `
vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
mapN.xy *= normalScale;
// Fewer visible pores on lips, nails and brows.
{
  vec4 nA = texture2D( uMaskA, vSkinUv );
  mapN.xy *= 1.0 - 0.7 * max( nA.r, nA.b );
}
if ( uFemale > 0.0 ) {
  vec2 l = genitalLocal();
  float region = texture2D( uMaskB, vSkinUv ).r;
  if ( region > 0.01 ) {
    vec2 e = vec2( 0.02, 0.0 );
    float dx = vulvaHeight( l + e.xy ) - vulvaHeight( l - e.xy );
    float dy = vulvaHeight( l + e.yx ) - vulvaHeight( l - e.yx );
    vec2 g = vec2( dx, dy ) / ( 2.0 * e.x ) * 0.35 * uFemale * region;
    vec2 h = 0.5 * ( uGenitalBox.zw - uGenitalBox.xy );
    mapN.xy -= ( h.y >= h.x ) ? g : g.yx;
  }
}
normal = normalize( tbn * mapN );
if ( sp_height != 0.0 ) normal = h_bumpNormal( -vViewPosition, normal, sp_height, gl_FrontFacing ? 1.0 : -1.0 );
`;

const SKIN_IRRADIANCE = /* glsl */ `
float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
vec3 irradiance = dotNL * directLight.color;
// Wrapped, per-channel diffuse: light bleeds further around the terminator in red (subsurface scattering approximation).
// Diffuse only: fed to the specular and sheen lobes, the wrap lit edges facing away from the sun,
// where those lobes peak, and they showed as red sparks along sunlit silhouettes.
float skinNdl = dot( geometryNormal, directLight.direction );
vec3 skinWrap = vec3( 0.5, 0.22, 0.14 ) * uSSS;
vec3 skinIrradiance = clamp( ( vec3( skinNdl ) + skinWrap ) / ( 1.0 + skinWrap ), 0.0, 1.0 ) * directLight.color;
`;

const SKIN_DIRECT_DIFFUSE = /reflectedLight\.directDiffuse \+= irradiance \* BRDF_Lambert\(/;

export function createSkinMaterial(uniforms: SkinUniforms): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.48,
    normalMap: poreNormalMap(),
    normalScale: new THREE.Vector2(0.35, 0.35),
    sheen: 0.3,
    sheenRoughness: 0.6,
    sheenColor: new THREE.Color(0.9, 0.6, 0.55),
    specularIntensity: 0.6,
  });
  mat.normalMap!.repeat.set(48, 48);
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vSkinUv;\nvarying vec3 vBind;\nuniform vec4 uBind;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvSkinUv = uv;")
      .replace("#include <morphtarget_vertex>", `#include <morphtarget_vertex>\n${GLSL_BIND_VERTEX}`);
    const physical = THREE.ShaderChunk.lights_physical_pars_fragment.replace(
      /float dotNL = saturate\( dot\( geometryNormal, directLight\.direction \) \);\s*vec3 irradiance = dotNL \* directLight\.color;/,
      SKIN_IRRADIANCE,
    ).replace(SKIN_DIRECT_DIFFUSE, "reflectedLight.directDiffuse += skinIrradiance * BRDF_Lambert(");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${SKIN_FRAG_PARS}`)
      .replace("#include <lights_physical_pars_fragment>", physical)
      .replace("#include <map_fragment>", `#include <map_fragment>\n${SKIN_ALBEDO}`)
      .replace("#include <normal_fragment_maps>", SKIN_NORMAL)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nif ( sp_rough >= 0.0 ) roughnessFactor = sp_rough;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += sp_emit;");
  };
  mat.customProgramCacheKey = () => "actors-skin";
  return useDualQuaternionSkinning(mat);
}

/** Eyes: iris texture with adjustable iris colour (hue/saturation shift of saturated pixels), wet clear coat. */
export interface EyeUniforms {
  uIrisHue: { value: number };
  uIrisSat: { value: number };
  uIrisLight: { value: number };
  /** x pupil shape (see PUPILS), y dilation 0..1, z iris glow. */
  uPupil: { value: THREE.Vector4 };
}

export function createEyeMaterial(map: THREE.Texture | null, uniforms: EyeUniforms): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({ map, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.02, ior: 1.376 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uIrisHue; uniform float uIrisSat; uniform float uIrisLight; uniform vec4 uPupil;
vec3 eyeRgb2hsv( vec3 c ) {
  vec4 K = vec4( 0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0 );
  vec4 p = mix( vec4( c.bg, K.wz ), vec4( c.gb, K.xy ), step( c.b, c.g ) );
  vec4 q = mix( vec4( p.xyw, c.r ), vec4( c.r, p.yzx ), step( p.x, c.r ) );
  float d = q.x - min( q.w, q.y );
  return vec3( abs( q.z + ( q.w - q.y ) / ( 6.0 * d + 1e-10 ) ), d / ( q.x + 1e-10 ), q.x );
}
vec3 eyeHsv2rgb( vec3 c ) {
  vec3 p = abs( fract( c.xxx + vec3( 1.0, 2.0 / 3.0, 1.0 / 3.0 ) ) * 6.0 - 3.0 );
  return c.z * mix( vec3( 1.0 ), clamp( p - 1.0, 0.0, 1.0 ), c.y );
}
// Iris colour: hue/saturation/lightness shift of the saturated (iris) pixels.
vec3 eyeShift( vec3 c ) {
  vec3 hsv = eyeRgb2hsv( c );
  float iris = smoothstep( 0.18, 0.4, hsv.y );
  vec3 shifted = eyeHsv2rgb( vec3( uIrisHue, clamp( hsv.y * uIrisSat, 0.0, 1.0 ), clamp( hsv.z * uIrisLight, 0.0, 1.0 ) ) );
  return mix( c, shifted, iris * step( 0.0, uIrisHue ) );
}`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
diffuseColor.rgb = eyeShift( diffuseColor.rgb );
${GLSL_EYE}`,
      )
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += ey_emit;");
  };
  mat.customProgramCacheKey = () => "actors-eye";
  return useDualQuaternionSkinning(mat);
}

export const IRIS_PRESETS: Record<string, { hue: number; sat: number; light: number }> = {
  brown: { hue: 0.075, sat: 0.85, light: 0.95 },
  hazel: { hue: 0.12, sat: 0.9, light: 1.4 },
  green: { hue: 0.3, sat: 0.9, light: 1.3 },
  blue: { hue: 0.58, sat: 1.0, light: 1.6 },
  gray: { hue: 0.58, sat: 0.25, light: 1.6 },
};

/**
 * Cuts away fragments where the interpolated `clipValue` attribute is below 0
 * (smooth garment hems). The geometry needs a `clipValue` float attribute.
 */
export function useClipAttribute<T extends THREE.Material>(material: T): T {
  const previous = material.onBeforeCompile.bind(material);
  const prevKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float clipValue;\nvarying float vClipValue;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvClipValue = clipValue;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vClipValue;")
      .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\nif ( vClipValue < 0.0 ) discard;");
  };
  material.customProgramCacheKey = () => `${prevKey()}|clip`;
  return material;
}

/** Uniforms of a recolourable garment material (see createClothMaterial and ThreeActor.setGarmentColor). */
export interface ClothTintUniforms {
  uTint: { value: THREE.Color };
  uTintMix: { value: number };
  /** Mean luminance (linear) of the garment's own colour or texture. */
  uTintMeanLum: { value: number };
}

/**
 * Garment material. `uTint`/`uTintMix` (in `userData.tint`) recolour it: the
 * texture's brightness pattern (folds, seams, weave) is kept and scaled so its
 * mean matches the chosen colour, the way hair is recoloured.
 */
export function createClothMaterial(
  color: THREE.Color,
  roughness: number,
  fabric: string,
  layer: number,
  map: THREE.Texture | null = null,
  normal: THREE.Texture | null = null,
  meanLum = 0.2,
  screenTextures?: ScreenTexturePool | null,
): THREE.MeshStandardMaterial {
  let normalMap = normal;
  if (!normalMap) {
    normalMap = fabricNormalMap(fabric).clone();
    normalMap.repeat.set(24, 24);
  }
  const mat = new THREE.MeshStandardMaterial({
    color: map ? new THREE.Color(1, 1, 1) : color,
    map,
    roughness,
    normalMap,
    normalScale: normal ? new THREE.Vector2(1, 1) : new THREE.Vector2(0.6, 0.6),
    // Textured garments can have transparent parts (lace, fishnet); others stay fully opaque.
    alphaTest: map ? 0.5 : 0,
    side: THREE.DoubleSide,
    // Garments sit very close to the skin; bias them toward the camera so skin doesn't flicker through.
    polygonOffset: true,
    polygonOffsetFactor: -2 * layer,
    polygonOffsetUnits: -4 * layer,
  });
  const uniforms: ClothTintUniforms = { uTint: { value: new THREE.Color(1, 1, 1) }, uTintMix: { value: 0 }, uTintMeanLum: { value: Math.max(0.01, meanLum) } };
  mat.userData.tint = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uTint;\nuniform float uTintMix;\nuniform float uTintMeanLum;")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
float clothLum = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
diffuseColor.rgb = mix( diffuseColor.rgb, uTint * clamp( clothLum / uTintMeanLum, 0.0, 3.0 ), uTintMix );`,
      )
      // Cut-outs (lace, fishnet) from the texture's full-resolution alpha: smaller mip levels blur the
      // transparent space around UV islands into the cloth and punched holes along every seam from afar.
      .replace("#include <alphatest_fragment>", "#if defined( USE_ALPHATEST ) && defined( USE_MAP )\nif ( textureLod( map, vMapUv, 0.0 ).a < alphaTest ) discard;\n#else\n#include <alphatest_fragment>\n#endif");
  };
  mat.customProgramCacheKey = () => "actors-cloth";
  if (fabric === "screen") useScreenMaterial(mat, color, screenTextures);
  return useDualQuaternionSkinning(mat);
}

export function createLashMaterial(color: THREE.Color): THREE.MeshLambertMaterial {
  // Lambert: no specular, so thin dark hairs never catch white highlights.
  const mat = new THREE.MeshLambertMaterial({
    color,
    alphaMap: lashAlphaMap(),
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  return useDualQuaternionSkinning(mat);
}

/**
 * Hair cards (MakeHuman hair proxies): alpha-tested texture with alpha to
 * coverage for soft edges under MSAA, two-sided, slight sheen. `uHairTint`
 * and `uHairMix` recolour it: the texture's brightness pattern is kept and
 * scaled so its mean matches the chosen colour (see ThreeActor.setHairColor).
 */
export function createHairMaterial(map: THREE.Texture | null, blended = false): THREE.MeshPhysicalMaterial {
  // Blended mode suits soft, flat strands on the skin (eyebrows); cards with volume use alpha to coverage.
  const mat = new THREE.MeshPhysicalMaterial({
    map,
    ...(blended ? { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 } : { alphaTest: 0.35, alphaToCoverage: true }),
    side: THREE.DoubleSide,
    roughness: 0.55,
    sheen: 0.6,
    sheenRoughness: 0.35,
    sheenColor: new THREE.Color(0.35, 0.3, 0.25),
    specularIntensity: 0.35,
  });
  const uniforms = { uHairTint: { value: new THREE.Color(1, 1, 1) }, uHairMix: { value: 0 }, uHairMeanLum: { value: 0.2 } };
  mat.userData.hair = uniforms;
  mat.userData.alphaShadow = !blended;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uHairTint;\nuniform float uHairMix;\nuniform float uHairMeanLum;")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
float hairLum = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
diffuseColor.rgb = mix( diffuseColor.rgb, uHairTint * clamp( hairLum / uHairMeanLum, 0.0, 2.5 ), uHairMix );`,
      );
  };
  mat.customProgramCacheKey = () => "actors-hair";
  return useDualQuaternionSkinning(mat);
}

/** Shadow-map material for alpha-tested hair cards. */
export function createAlphaDepthMaterial(map: THREE.Texture | null): THREE.MeshDepthMaterial {
  return useDualQuaternionSkinning(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.35 }));
}

export function createWetMaterial(color: THREE.Color, roughness: number): THREE.MeshPhysicalMaterial {
  return useDualQuaternionSkinning(new THREE.MeshPhysicalMaterial({ color, roughness, clearcoat: 0.6, clearcoatRoughness: 0.2 }));
}

/** Shadow-map material with the same dual-quaternion skinning (so shadows match the mesh). */
export function createDepthMaterial(): THREE.MeshDepthMaterial {
  return useDualQuaternionSkinning(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));
}

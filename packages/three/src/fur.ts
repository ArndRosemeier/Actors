import * as THREE from "three";
import { createDepthMaterial } from "./materials";
import { useDualQuaternionSkinning } from "./dqs";
import type { ActorMaterialKit, ThreeActor } from "./index";
import { webglMaterials } from "./index";

/**
 * Fur for animal packs (material kind "fur"), WebGL.
 *
 * The body is drawn once with the coat colours and then again as a stack of
 * shells (Lengyel et al. 2001 "Real-time fur over arbitrary surfaces"): each
 * shell is the skinned body pushed out along its normal and combed along the
 * pack's `furFlow` direction, with strands cut out of it by 3D cell noise on
 * the base-pack position (`coatPos`), so strands stay put while the actor moves
 * and changes shape. Coat colours and markings come from the per-vertex region
 * data the importer writes (`coatA`..`coatD`, see tools/import-animals).
 */

type RGB = [number, number, number];

/** Coat settings (the fields of @actors/animal's DogCoat). Colours in sRGB 0..1, amounts 0..1. */
export interface FurCoat {
  base: RGB;
  second: RGB;
  tan: RGB;
  white: RGB;
  saddle: number;
  mask: number;
  points: number;
  belly: number;
  bib: number;
  socks: number;
  blaze: number;
  tailTip: number;
  spots: number;
  spotSize: number;
  shade: number;
  /** Light mask: cream muzzle sides, cheeks and lower jaw (wolf colouring). */
  paleMask?: number;
  /** Dark guard hair tips over a lighter undercoat (wolf grey, sable). */
  agouti?: number;
  /** Lower legs in the tan colour (fawn legs of wolves and wolfdogs). */
  tanLegs?: number;
  /** Guard hair length in meters. */
  length: number;
  fluff: number;
}

export interface FurUniforms {
  [name: string]: THREE.IUniform;
  uBase: THREE.IUniform<THREE.Color>;
  uSecond: THREE.IUniform<THREE.Color>;
  uTan: THREE.IUniform<THREE.Color>;
  uWhite: THREE.IUniform<THREE.Color>;
  /** saddle, mask, points, belly */
  uMarkA: THREE.IUniform<THREE.Vector4>;
  /** bib, socks, blaze, tail tip */
  uMarkB: THREE.IUniform<THREE.Vector4>;
  /** spots, spot size, shade, unused */
  uMarkC: THREE.IUniform<THREE.Vector4>;
  /** pale mask, agouti, tan legs, unused */
  uMarkD: THREE.IUniform<THREE.Vector4>;
  /** length (m), fluff, strand spacing (m), actor scale */
  uFur: THREE.IUniform<THREE.Vector4>;
  /** Iris colour of the animal eye material. */
  uIris: THREE.IUniform<THREE.Color>;
}

export function createFurUniforms(): FurUniforms {
  return {
    uBase: { value: new THREE.Color(0.55, 0.38, 0.22) },
    uSecond: { value: new THREE.Color(0.05, 0.04, 0.03) },
    uTan: { value: new THREE.Color(0.6, 0.35, 0.15) },
    uWhite: { value: new THREE.Color(0.92, 0.9, 0.86) },
    uMarkA: { value: new THREE.Vector4() },
    uMarkB: { value: new THREE.Vector4() },
    uMarkC: { value: new THREE.Vector4(0, 1, 0.3, 0) },
    uMarkD: { value: new THREE.Vector4() },
    uFur: { value: new THREE.Vector4(0.012, 0.2, 0.0019, 1) },
    uIris: { value: new THREE.Color().setRGB(0.32, 0.18, 0.06, THREE.SRGBColorSpace) },
  };
}

/** Copies coat settings into the uniforms. `scale`: the actor's overall size, so fur keeps its length on big and small animals. */
export function setFurCoat(u: FurUniforms, coat: FurCoat, scale = 1): void {
  u.uBase.value.setRGB(...coat.base, THREE.SRGBColorSpace);
  u.uSecond.value.setRGB(...coat.second, THREE.SRGBColorSpace);
  u.uTan.value.setRGB(...coat.tan, THREE.SRGBColorSpace);
  u.uWhite.value.setRGB(...coat.white, THREE.SRGBColorSpace);
  u.uMarkA.value.set(coat.saddle, coat.mask, coat.points, coat.belly);
  u.uMarkB.value.set(coat.bib, coat.socks, coat.blaze, coat.tailTip);
  u.uMarkC.value.set(coat.spots, coat.spotSize, coat.shade, 0);
  u.uMarkD.value.set(coat.paleMask ?? 0, coat.agouti ?? 0, coat.tanLegs ?? 0, 0);
  // The shape's size scales the whole body (fur included); divide it out so fur length is in meters.
  u.uFur.value.set(coat.length / scale, coat.fluff, 0.0019, scale);
}

const GLSL_VERT_PARS = /* glsl */ `
attribute vec4 coatA; attribute vec4 coatB; attribute vec4 coatC; attribute vec4 coatD; attribute vec4 coatE;
attribute vec3 coatPos; attribute vec3 furFlow;
varying vec4 vCoatA; varying vec4 vCoatB; varying vec4 vCoatC; varying vec4 vCoatD; varying vec4 vCoatE;
varying vec3 vCoatPos; varying vec3 vFlow; varying float vShell;
uniform vec4 uFur;
#ifdef FUR_SHELL
attribute float furShell;
#endif
`;

const GLSL_VERT_MAIN = /* glsl */ `
vCoatA = coatA; vCoatB = coatB; vCoatC = coatC; vCoatD = coatD; vCoatE = coatE; vCoatPos = coatPos; vFlow = furFlow; vShell = 0.0;
#ifdef FUR_SHELL
{
  vShell = furShell;
  vec3 fl = furFlow;
  #ifdef USE_SKINNING
    fl = ( bindMatrixInverse * vec4( dqsRotate( dqR, ( bindMatrix * vec4( fl, 0.0 ) ).xyz ), 0.0 ) ).xyz;
  #endif
  vec3 nrm = normalize( objectNormal );
  vec3 comb = fl - nrm * dot( fl, nrm );
  float len = uFur.x * coatB.y;
  float h = furShell;
  // Out along the normal (more for fluffy coats), combed along the flow, sagging a little.
  transformed += nrm * len * h * ( 0.3 + 0.7 * uFur.y ) + comb * len * h * ( 1.0 - 0.55 * uFur.y ) - vec3( 0.0, 1.0, 0.0 ) * len * h * h * 0.3;
}
#endif
`;

const GLSL_FRAG_PARS = /* glsl */ `
varying vec4 vCoatA; varying vec4 vCoatB; varying vec4 vCoatC; varying vec4 vCoatD; varying vec4 vCoatE;
varying vec3 vCoatPos; varying vec3 vFlow; varying float vShell;
uniform vec3 uBase; uniform vec3 uSecond; uniform vec3 uTan; uniform vec3 uWhite;
uniform vec4 uMarkA; uniform vec4 uMarkB; uniform vec4 uMarkC; uniform vec4 uMarkD; uniform vec4 uFur;
vec3 furHash( vec3 p ) {
  p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) );
  p += dot( p, p.yxz + 33.33 );
  return fract( ( p.xxy + p.yxx ) * p.zyx );
}
float furNoise( vec3 p ) {
  vec3 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  float a = furHash( i ).x, b = furHash( i + vec3( 1, 0, 0 ) ).x, c = furHash( i + vec3( 0, 1, 0 ) ).x, d = furHash( i + vec3( 1, 1, 0 ) ).x;
  float e = furHash( i + vec3( 0, 0, 1 ) ).x, g = furHash( i + vec3( 1, 0, 1 ) ).x, h = furHash( i + vec3( 0, 1, 1 ) ).x, k = furHash( i + vec3( 1, 1, 1 ) ).x;
  return mix( mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y ), mix( mix( e, g, f.x ), mix( h, k, f.x ), f.y ), f.z );
}
/** Locks of hair: noise stretched along the fur's direction (about 4 mm across, 3 cm along). */
float furStreak( vec3 p ) {
  vec3 f = normalize( vFlow + vec3( 1e-5 ) );
  vec3 q = p - f * dot( p, f ) * 0.86;
  return 0.6 * furNoise( q * 230.0 ) + 0.4 * furNoise( q * 520.0 + 3.0 );
}
float furFbm( vec3 p ) { return 0.6 * furNoise( p ) + 0.3 * furNoise( p * 2.1 + 7.0 ) + 0.1 * furNoise( p * 4.3 + 13.0 ); }
// Round spots: distance to the nearest random point in a jittered grid.
float furSpots( vec3 p ) {
  vec3 c = floor( p );
  float best = 1.0;
  for ( int x = -1; x <= 1; x++ ) for ( int y = -1; y <= 1; y++ ) for ( int z = -1; z <= 1; z++ ) {
    vec3 cell = c + vec3( x, y, z );
    vec3 r = furHash( cell );
    float radius = 0.22 + 0.2 * r.z;
    best = min( best, length( p - cell - 0.15 - 0.7 * r ) / radius );
  }
  return 1.0 - smoothstep( 0.85, 1.0, best );
}
/** Coat colour from the region data and the markings. */
vec3 furCoat() {
  float legT = vCoatA.x, headW = vCoatA.y, muzzleT = vCoatA.z, tailT = vCoatA.w;
  float ear = vCoatB.x, brow = vCoatB.z, bib = vCoatB.w;
  float back = vCoatD.x, under = vCoatD.y, mask = vCoatD.z, blaze = vCoatD.w;
  vec3 p = vCoatPos;
  float n = furFbm( p * 22.0 ) - 0.5;
  vec3 col = uBase;
  // Lighter underside and inner legs; a slightly darker topline (agouti shading).
  col = mix( col, mix( col, uWhite, 0.5 ), smoothstep( 0.2, 0.8, under ) * uMarkC.z );
  col *= 1.0 - 0.25 * uMarkC.z * smoothstep( 0.6, 1.0, back );
  // Saddle (blanket) and mask in the second colour; ears go dark with them.
  // (Agouti coats have a soft-edged saddle that fades into the sides.)
  float sw = mix( 0.08, 0.3, uMarkD.y );
  col = mix( col, uSecond, smoothstep( 0.5 - sw, 0.5 + sw, back * ( 0.35 + 0.75 * uMarkA.x ) + n * 0.35 ) * step( 0.01, uMarkA.x ) * ( 1.0 - headW ) );
  col = mix( col, uSecond, smoothstep( 0.35, 0.6, mask + n * 0.25 ) * uMarkA.y );
  col = mix( col, uSecond, smoothstep( 0.3, 0.6, ear ) * max( uMarkA.y, uMarkA.x * 0.85 ) );
  // Tan points: brows, cheeks and muzzle, lower legs, chest.
  float pts = max( max( brow * 1.6, mask * 0.9 * ( 1.0 - smoothstep( 0.2, 0.6, vCoatD.w * 3.0 ) ) ), max( ( 1.0 - legT ) * 1.1, bib * 0.55 ) );
  col = mix( col, uTan, smoothstep( 0.45, 0.6, pts + n * 0.15 ) * uMarkA.z );
  // Agouti: banded hairs with dark tips give a grizzled, streaky look, strongest on the back.
  {
    float where = ( 1.0 - vCoatD.y ) * ( 0.3 + 0.7 * vCoatD.x ) * ( 1.0 - vCoatE.x ) * ( 1.0 - 0.6 * ( 1.0 - vCoatA.x ) );
    col = mix( col, uSecond * 0.75, smoothstep( 0.42, 0.72, furStreak( p + 0.37 ) ) * where * uMarkD.y * 0.6 );
  }
  // Light (wolf) mask: muzzle sides, cheeks and lower jaw; the bridge of the nose keeps the base colour.
  float pale = smoothstep( 0.3, 0.7, vCoatE.x + n * 0.25 );
  col = mix( col, uWhite, pale * uMarkD.x );
  // Tan lower legs.
  col = mix( col, uTan, smoothstep( 1.0, 0.7, legT + n * 0.15 ) * uMarkD.z );
  // Spots.
  float spot = furSpots( p / ( 0.034 * max( uMarkC.y, 0.2 ) ) ) * uMarkC.x * ( 1.0 - vCoatC.x );
  col = mix( col, uSecond, spot );
  // White markings.
  float white = smoothstep( 0.5, 0.65, under + n * 0.25 ) * uMarkA.w;
  white = max( white, smoothstep( 0.35, 0.6, bib + n * 0.2 ) * uMarkB.x );
  white = max( white, ( 1.0 - smoothstep( uMarkB.y * 0.92 - 0.1, uMarkB.y * 0.92, legT + n * 0.1 ) ) * step( 0.01, uMarkB.y ) );
  white = max( white, smoothstep( 0.25, 0.5, blaze * 1.4 * uMarkB.z + muzzleT * uMarkB.z * 0.6 * step( 0.5, uMarkB.z ) + n * 0.1 ) * step( 0.01, uMarkB.z ) );
  white = max( white, smoothstep( 1.0 - 0.3 * uMarkB.w, 1.0 - 0.24 * uMarkB.w, tailT ) * step( 0.01, uMarkB.w ) );
  col = mix( col, uWhite, white );
  // Bare skin: nose leather, lips, pads, eye rims.
  col = mix( col, vec3( 0.025, 0.02, 0.02 ), clamp( vCoatC.x + vCoatC.y + vCoatC.z + vCoatC.w, 0.0, 1.0 ) );
  // Clumps of lighter and darker hair (larger than single strands, so they read from afar).
  return col * ( 0.86 + 0.28 * furStreak( p ) );
}
#ifdef FUR_SHELL
/** Average strand coverage at shell height h (what the strands below cover when too small to resolve). */
float furMeanCover( float h ) {
  float m = 0.785 * pow( max( 0.0, 1.0 - h / 0.78 ), 2.0 );
  return 1.0 - ( 1.0 - m ) * ( 1.0 - m );
}
/** Strand coverage at this shell height: tapered strands of random length on two offset grids. */
float furStrands() {
  vec3 p = vCoatPos / uFur.z;
  float cov = 0.0;
  for ( int k = 0; k < 2; k++ ) {
    vec3 q = p + float( k ) * 0.5;
    vec3 c = floor( q ), r = furHash( c + float( k ) * 31.0 );
    float tip = 0.55 + 0.45 * r.y;
    float radius = 0.5 * ( 1.0 - vShell / tip );
    float d = length( fract( q ) - 0.25 - 0.5 * r );
    cov = max( cov, smoothstep( radius, radius - 0.12, d ) * step( vShell, tip ) );
  }
  // Strands thinner than a pixel blend into their average coverage (no sparkle at a distance).
  float px = length( fwidth( p ) );
  return mix( cov, furMeanCover( vShell ), smoothstep( 0.5, 2.0, px ) );
}
#endif
`;

const GLSL_FRAG_MAIN = /* glsl */ `
#include <color_fragment>
diffuseColor.rgb = furCoat();
float furBare = clamp( vCoatC.x + vCoatC.y + vCoatC.z + vCoatC.w, 0.0, 1.0 );
#ifdef FUR_SHELL
  diffuseColor.a = furStrands() * ( 1.0 - furBare ) * step( 0.0005, uFur.x * vCoatB.y );
  // Darker near the skin (strands shade each other).
  diffuseColor.rgb *= mix( 0.72, 1.06, vShell );
  // Agouti: dark guard hair tips, strongest along the back, faint on the underside and legs.
  {
    float tipBand = smoothstep( 0.45, 0.8, vShell ) * smoothstep( 0.3, 0.6, furStreak( vCoatPos + 0.37 ) );
    float where = ( 1.0 - vCoatD.y ) * ( 0.35 + 0.65 * vCoatD.x ) * ( 1.0 - 0.7 * vCoatD.z );
    diffuseColor.rgb = mix( diffuseColor.rgb, uSecond * 0.6, tipBand * where * uMarkD.y * 0.75 );
  }
#else
  diffuseColor.rgb *= mix( uFur.x > 0.002 ? 0.75 : 0.9, 1.0, furBare );
#endif
`;

function patchFur<T extends THREE.Material>(material: T, shell: boolean, uniforms: FurUniforms): T {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${GLSL_VERT_PARS}`)
      .replace("#include <project_vertex>", `${GLSL_VERT_MAIN}\n#include <project_vertex>`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${GLSL_FRAG_PARS}`)
      .replace("#include <color_fragment>", GLSL_FRAG_MAIN)
      // No sheen on bare skin (nose, lips, pads); wet nose and lips.
      .replace("#include <lights_physical_fragment>", "#include <lights_physical_fragment>\n#ifdef USE_SHEEN\nmaterial.sheenColor *= 1.0 - furBare;\n#endif\nmaterial.roughness = mix( material.roughness, 0.45, vCoatC.x );")
      // Hair scatters light instead of mirroring it: damp the specular except on the nose.
      .replace("#include <aomap_fragment>", "#include <aomap_fragment>\nreflectedLight.directSpecular *= mix( 0.15, 1.0, vCoatC.x );\nreflectedLight.indirectSpecular *= mix( 0.15, 1.0, vCoatC.x );");
  };
  if (shell) material.defines = { ...material.defines, FUR_SHELL: "" };
  material.customProgramCacheKey = () => (shell ? "actors-fur-shell" : "actors-fur");
  // DQS like the other actor materials; the shell code also uses its rotation for the flow.
  return useDualQuaternionSkinning(material);
}

/** The body under the fur: coat colours, a soft sheen. */
export function createFurMaterial(uniforms: FurUniforms): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({ roughness: 0.85, sheen: 0.6, sheenRoughness: 0.7, sheenColor: new THREE.Color(0.6, 0.55, 0.5) });
  mat.userData.fur = true;
  return patchFur(mat, false, uniforms);
}

/** One draw for all shells (instanced by the `furShell` height). */
export function createFurShellMaterial(uniforms: FurUniforms): THREE.MeshStandardMaterial {
  // Blended (inner shells first, as instanced), so thin strands fade instead of flickering.
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, envMapIntensity: 0.7, transparent: true, depthWrite: false, alphaTest: 0.01 });
  return patchFur(mat, true, uniforms);
}

/**
 * Animal eye on a UV sphere whose v runs from the front pole: dark pupil, a
 * large iris (`uIris`) and a little sclera at the edge, under a wet clear coat.
 */
export function createAnimalEyeMaterial(uniforms: FurUniforms): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({ roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03, ior: 1.376 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uIris = uniforms.uIris;
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vEyeUv;").replace("#include <uv_vertex>", "#include <uv_vertex>\nvEyeUv = uv;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vEyeUv; uniform vec3 uIris;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  float r = vEyeUv.y;
  float rays = 0.85 + 0.15 * sin( vEyeUv.x * 6.2831 * 23.0 ) * sin( vEyeUv.x * 6.2831 * 7.0 + r * 40.0 );
  vec3 iris = uIris * rays * mix( 1.3, 0.6, smoothstep( 0.1, 0.34, r ) );
  vec3 c = mix( vec3( 0.005 ), iris, smoothstep( 0.09, 0.11, r ) );
  // A dark limbal ring, then the little sclera dogs show, mostly brown.
  c = mix( c, vec3( 0.03, 0.02, 0.015 ), smoothstep( 0.33, 0.37, r ) );
  c = mix( c, vec3( 0.2, 0.12, 0.08 ), smoothstep( 0.45, 0.55, r ) );
  diffuseColor.rgb = c;
}`,
      );
  };
  mat.customProgramCacheKey = () => "actors-animal-eye";
  return useDualQuaternionSkinning(mat);
}

/**
 * Material kit for animal packs: fur bodies and animal eyes, everything else
 * as in `webglMaterials`. Pass it to `ThreeActor`, then `addFurShells`.
 */
export function animalMaterials(uniforms: FurUniforms): ActorMaterialKit {
  return {
    ...webglMaterials,
    mesh(data, actor) {
      const { kind } = data.def.material;
      if (kind === "fur") return createFurMaterial(uniforms);
      if (kind === "eye" && data.def.tags?.includes("animal")) return createAnimalEyeMaterial(uniforms);
      return webglMaterials.mesh(data, actor);
    },
    depth(material, clip) {
      return material.userData.fur ? createDepthMaterial() : webglMaterials.depth(material, clip);
    },
  };
}

export interface FurShells {
  /** The shell mesh (one instanced draw). */
  readonly mesh: THREE.SkinnedMesh;
  /** Number of shells drawn (0 hides the fur). */
  count: number;
  dispose(): void;
}

/**
 * Adds fur shells over the actor's fur meshes. The shells share the body's
 * vertex buffers, so shape changes need nothing extra; skeleton, bind pose and
 * index (detail level, hidden parts) are picked up from the body every frame.
 * Shells are only drawn at the full detail level.
 */
export function addFurShells(actor: ThreeActor, uniforms: FurUniforms, shells = 16): FurShells[] {
  const out: FurShells[] = [];
  for (const body of actor.meshes.values()) {
    if (!(body.material as THREE.Material).userData.fur) continue;
    const g = new THREE.InstancedBufferGeometry();
    for (const [name, attr] of Object.entries(body.geometry.attributes)) g.setAttribute(name, attr);
    g.setIndex(body.geometry.index);
    const heights = new Float32Array(shells).map((_, i) => (i + 1) / shells);
    g.setAttribute("furShell", new THREE.InstancedBufferAttribute(heights, 1));
    g.instanceCount = shells;
    const mesh = new THREE.SkinnedMesh(g, createFurShellMaterial(uniforms));
    mesh.name = `${body.name}:fur`;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    if (body.skeleton) mesh.bind(body.skeleton, body.bindMatrix);
    const state: FurShells = {
      mesh,
      count: shells,
      dispose() {
        mesh.removeFromParent();
        g.dispose();
        (mesh.material as THREE.Material).dispose();
      },
    };
    mesh.onBeforeRender = () => {
      mesh.skeleton = body.skeleton;
      mesh.bindMatrix.copy(body.bindMatrix);
      mesh.bindMatrixInverse.copy(body.bindMatrixInverse);
      if (g.index !== body.geometry.index) g.setIndex(body.geometry.index);
      let shown = body.visible && actor.lod === 0;
      for (let o: THREE.Object3D | null = body; o && shown; o = o.parent) shown = o.visible;
      g.instanceCount = shown ? Math.min(state.count, shells) : 0;
    };
    body.parent?.add(mesh);
    out.push(state);
  }
  return out;
}

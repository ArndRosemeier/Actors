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
  // Deer markings (packs with the coatF channel; see tools/import-animals/src/deercoat.ts).
  /** White spots in rows along the back and flanks (sika, fallow, axis). */
  dapple?: number;
  /** Spot spacing (1: about 4 cm). */
  dappleSize?: number;
  /** Dark stripe along the spine. */
  dorsal?: number;
  /** White rump patch around the tail. */
  rump?: number;
  /** Black border above the rump patch and down the tail. */
  rumpBorder?: number;
  /** Head and neck in the tan colour (greyer than the body). */
  headTone?: number;
  /** Pale hair inside the ears. */
  innerEar?: number;
  /** White tufts over the metatarsal glands (outside of the hind cannons). */
  glands?: number;
  // Cat markings (packs whose coatF holds tabby stripe coordinates; see tools/import-animals/src/cat.ts).
  /** Tabby stripes in the second colour. */
  tabby?: number;
  /** Tortoiseshell patches in the tan colour. */
  patches?: number;
  /** 0: round pupil .. 1: narrow vertical slit. */
  pupil?: number;
  // Horse markings (packs whose coatE.z marks the mane and tail hair; see tools/import-animals/src/horsecoat.ts).
  /** Mane and tail in the `tan` colour. */
  maneTail?: number;
  /** Lower legs in the `second` colour (black points of bays and buckskins). */
  darkLegs?: number;
  /** Dapples: round patches of lighter coat (`white`). */
  dapples?: number;
  /** Nose leather colour without nostril detail (default near black; `noseColor` draws the detailed nose instead). */
  nose?: RGB;
  /** Strand spacing in metres (default 1.9 mm times `grain`). */
  strand?: number;
  /** Guard hair length in meters. */
  length: number;
  fluff: number;
  /** Pale ring around the eyes. */
  eyeRing?: number;
  /** White guard hair tips (silver-grey frosting). */
  frost?: number;
  /** Squirrel tail: hairs banded dark with white tips. */
  tailFrost?: number;
  /** Long hair tufts on the ear tips. */
  earTufts?: number;
  /** Size of strands and locks relative to a dog's (1); small animals have finer fur. */
  grain?: number;
  /** Eye colour (sRGB). */
  iris?: RGB;
  /** Nose leather colour (sRGB); when set, the nose also gets nostrils and a philtrum (packs with `coatF`). */
  noseColor?: RGB;
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
  /** spots, spot size, shade, metatarsal gland tufts */
  uMarkC: THREE.IUniform<THREE.Vector4>;
  /** pale mask, agouti, tan legs, unused */
  uMarkD: THREE.IUniform<THREE.Vector4>;
  /** eye ring, frost, tail frost, ear tufts */
  uMarkE: THREE.IUniform<THREE.Vector4>;
  /** Fur grain (pattern scale relative to a dog's). */
  uGrain: THREE.IUniform<number>;
  /** Nose leather colour (linear) and whether nose detail is on (w). */
  uNose: THREE.IUniform<THREE.Vector4>;
  /** deer: dapple, dapple size, dorsal stripe, rump patch */
  uMarkF: THREE.IUniform<THREE.Vector4>;
  /** deer: rump border, head tone, eye ring, inner ear */
  uMarkG: THREE.IUniform<THREE.Vector4>;
  /** cat: tabby, tortoiseshell patches, inner ear, pupil slit */
  uMarkH: THREE.IUniform<THREE.Vector4>;
  /** horse: mane and tail, dark legs, dapples, face marking */
  uMarkI: THREE.IUniform<THREE.Vector4>;
  /** Plain nose leather colour (linear). */
  uLeather: THREE.IUniform<THREE.Color>;
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
    uMarkE: { value: new THREE.Vector4() },
    uGrain: { value: 1 },
    uNose: { value: new THREE.Vector4() },
    uMarkF: { value: new THREE.Vector4(0, 1, 0, 0) },
    uMarkG: { value: new THREE.Vector4() },
    uMarkH: { value: new THREE.Vector4() },
    uMarkI: { value: new THREE.Vector4() },
    uLeather: { value: new THREE.Color(0.025, 0.02, 0.02) },
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
  // Horse packs draw their face marking themselves (a stripe down the face, not the dog's blaze).
  const horse = coat.maneTail !== undefined;
  u.uMarkB.value.set(coat.bib, coat.socks, horse ? 0 : coat.blaze, coat.tailTip);
  u.uMarkI.value.set(coat.maneTail ?? 0, coat.darkLegs ?? 0, coat.dapples ?? 0, horse ? coat.blaze : 0);
  u.uMarkC.value.set(coat.spots, coat.spotSize, coat.shade, coat.glands ?? 0);
  u.uMarkD.value.set(coat.paleMask ?? 0, coat.agouti ?? 0, coat.tanLegs ?? 0, 0);
  // Deer packs keep their eye ring in another channel (coatB.z, where dog packs have the brow).
  const deer = coat.dapple !== undefined;
  u.uMarkE.value.set(deer ? 0 : (coat.eyeRing ?? 0), coat.frost ?? 0, coat.tailFrost ?? 0, coat.earTufts ?? 0);
  u.uMarkF.value.set(coat.dapple ?? 0, coat.dappleSize ?? 1, coat.dorsal ?? 0, coat.rump ?? 0);
  u.uMarkG.value.set(coat.rumpBorder ?? 0, coat.headTone ?? 0, deer ? (coat.eyeRing ?? 0) : 0, deer ? (coat.innerEar ?? 0) : 0);
  u.uMarkH.value.set(coat.tabby ?? 0, coat.patches ?? 0, deer ? 0 : (coat.innerEar ?? 0), coat.pupil ?? 0);
  if (coat.nose) u.uLeather.value.setRGB(...coat.nose, THREE.SRGBColorSpace);
  else u.uLeather.value.setRGB(0.025, 0.02, 0.02);
  const grain = coat.grain ?? 1;
  u.uGrain.value = grain;
  if (coat.iris) u.uIris.value.setRGB(...coat.iris, THREE.SRGBColorSpace);
  if (coat.noseColor) {
    const c = new THREE.Color().setRGB(...coat.noseColor, THREE.SRGBColorSpace);
    u.uNose.value.set(c.r, c.g, c.b, 1);
  } else u.uNose.value.set(0, 0, 0, 0);
  // The shape's size scales the whole body (fur included); divide it out so fur length is in meters.
  u.uFur.value.set(coat.length / scale, coat.fluff, coat.strand ?? 0.0019 * grain, scale);
}

const GLSL_VERT_PARS = /* glsl */ `
attribute vec4 coatA; attribute vec4 coatB; attribute vec4 coatC; attribute vec4 coatD; attribute vec4 coatE; attribute vec4 coatF;
attribute vec3 coatPos; attribute vec3 furFlow;
varying vec4 vCoatA; varying vec4 vCoatB; varying vec4 vCoatC; varying vec4 vCoatD; varying vec4 vCoatE; varying vec4 vCoatF;
varying vec3 vCoatPos; varying vec3 vFlow; varying float vShell;
uniform vec4 uFur; uniform vec4 uMarkE;
#ifdef FUR_SHELL
attribute float furShell;
#endif
`;

const GLSL_VERT_MAIN = /* glsl */ `
vCoatA = coatA; vCoatB = coatB; vCoatC = coatC; vCoatD = coatD; vCoatE = coatE; vCoatF = coatF; vCoatPos = coatPos; vFlow = furFlow; vShell = 0.0;
#ifdef FUR_SHELL
{
  vShell = furShell;
  vec3 fl = furFlow;
  #ifdef USE_SKINNING
    fl = ( bindMatrixInverse * vec4( dqsRotate( dqR, ( bindMatrix * vec4( fl, 0.0 ) ).xyz ), 0.0 ) ).xyz;
  #endif
  vec3 nrm = normalize( objectNormal );
  vec3 comb = fl - nrm * dot( fl, nrm );
  // Ear tufts: long hair toward the ear tips.
  float len = uFur.x * coatB.y * ( 1.0 + uMarkE.w * 5.0 * smoothstep( 0.55, 0.95, coatE.w ) );
  float h = furShell;
  // Out along the normal (more for fluffy coats), combed along the flow, sagging a little.
  transformed += nrm * len * h * ( 0.3 + 0.7 * uFur.y ) + comb * len * h * ( 1.0 - 0.55 * uFur.y ) - vec3( 0.0, 1.0, 0.0 ) * len * h * h * 0.3;
}
#endif
`;

const GLSL_FRAG_PARS = /* glsl */ `
varying vec4 vCoatA; varying vec4 vCoatB; varying vec4 vCoatC; varying vec4 vCoatD; varying vec4 vCoatE; varying vec4 vCoatF;
varying vec3 vCoatPos; varying vec3 vFlow; varying float vShell;
uniform vec4 uNose;
uniform vec3 uBase; uniform vec3 uSecond; uniform vec3 uTan; uniform vec3 uWhite;
uniform vec4 uMarkA; uniform vec4 uMarkB; uniform vec4 uMarkC; uniform vec4 uMarkD; uniform vec4 uMarkE; uniform vec4 uMarkF; uniform vec4 uMarkG; uniform vec4 uMarkH; uniform vec4 uMarkI; uniform vec4 uFur; uniform vec3 uLeather;
uniform float uGrain;
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
/** Bare nose pad (packs with nose coordinates, when the coat sets a nose colour), seen from in front of the nose. */
float furNosePad() {
  if ( uNose.w < 0.5 ) return 0.0;
  vec2 q = vCoatF.xy - vec2( 0.0, 0.0008 );
  float ell = length( q / vec2( 0.0105, 0.0085 ) );
  return ( 1.0 - smoothstep( 0.85, 1.0, ell ) ) * smoothstep( -0.011, -0.006, vCoatF.z );
}
/**
 * Deer spots in rows: q = (distance along the spine, distance down from it) in spot spacings.
 * Alternate rows are offset by half a spot; each spot is jittered, sized and sometimes missing.
 */
float deerSpots( vec2 q ) {
  vec2 c = floor( q );
  float best = 9.0;
  for ( int x = -1; x <= 1; x++ ) for ( int y = -1; y <= 1; y++ ) {
    vec2 cell = c + vec2( x, y );
    vec3 r = furHash( vec3( cell, 17.0 ) );
    if ( r.z < 0.1 ) continue;
    vec2 ctr = cell + vec2( 0.2 + 0.6 * r.x + 0.5 * mod( cell.y, 2.0 ), 0.25 + 0.5 * r.y );
    // Sizes vary (many small dabs, some larger); a little longer along the body than across, ragged edges.
    float radius = 0.12 + 0.2 * r.z * r.z;
    float d = length( ( q - ctr ) * vec2( 0.68, 1.0 ) ) / radius + ( furNoise( vec3( q * 7.0, r.x * 9.0 ) ) - 0.5 ) * 0.45;
    best = min( best, d );
  }
  return 1.0 - smoothstep( 0.55, 1.1, best );
}
/** Blend that looks linear to the eye (the coat is mixed in linear colour, where light marks swamp dark coats). */
vec3 furMixP( vec3 a, vec3 b, float t ) {
  vec3 m = mix( sqrt( max( a, 0.0 ) ), sqrt( max( b, 0.0 ) ), clamp( t, 0.0, 1.0 ) );
  return m * m;
}
/** Deer markings over the coat colour (all amounts 0 for dogs and squirrels; on deer packs coatF holds the body coordinates). */
vec3 deerCoat( vec3 col, float n ) {
  float rump = vCoatF.x, along = vCoatF.y, fromSpine = vCoatF.z, spotty = vCoatF.w;
  // Head and neck greyer than the body (fading out over the withers).
  float neckTone = max( vCoatA.y, smoothstep( 0.42, 0.2, along ) * ( 1.0 - vCoatD.y ) );
  col = furMixP( col, uTan, neckTone * uMarkG.y * ( 1.0 - vCoatE.x ) );
  // Dark stripe along the spine from the withers to the tail.
  float stripe = smoothstep( 0.014, 0.006, fromSpine + n * 0.006 ) * smoothstep( 0.3, 0.38, along ) * ( 1.0 - vCoatA.y );
  col = mix( col, mix( col, uSecond, 0.85 ), stripe * uMarkF.z );
  // Spots in rows parallel to the spine, starting beside the stripe.
  float spacing = 0.034 * max( uMarkF.y, 0.3 );
  // Spots soften towards the belly (lower rows are fainter and smaller in the photo).
  float lower = smoothstep( 0.27, 0.15, fromSpine );
  float sp = deerSpots( vec2( along, fromSpine - 0.012 ) / spacing + n * 0.35 ) * smoothstep( 0.008, 0.02, fromSpine ) * spotty * mix( 0.45, 1.0, lower );
  // A broken pale line low on the flank, where the spots run together.
  float line = smoothstep( 1.0, 0.0, abs( fromSpine - 0.255 ) / 0.011 + furNoise( vCoatPos * 45.0 ) * 1.4 - 0.4 ) * spotty * smoothstep( 0.5, 0.58, along ) * smoothstep( 0.95, 0.85, along );
  col = furMixP( col, uWhite, clamp( max( sp, line * 0.5 ), 0.0, 1.0 ) * uMarkF.x * 0.85 );
  // Pale eye ring and inner ears; white tufts over the metatarsal glands.
  col = furMixP( col, uWhite, smoothstep( 0.2, 0.7, vCoatB.z ) * uMarkG.z );
  // Inside the ears: dark skin under streaks of pale hair.
  vec3 innerEar = furMixP( uSecond, uWhite, 0.24 + 0.22 * smoothstep( 0.35, 0.8, furStreak( vCoatPos * 1.6 + 1.7 ) ) );
  col = furMixP( col, innerEar, smoothstep( 0.15, 0.6, vCoatE.y + n * 0.2 ) * uMarkG.w );
  col = furMixP( col, uWhite, smoothstep( 0.2, 0.6, vCoatE.z ) * uMarkC.w );
  // Rump patch, its black border above and the dark middle of the tail's outer face.
  col = mix( col, uWhite, smoothstep( 0.3, 0.6, rump + n * 0.2 ) * uMarkF.w );
  col = mix( col, uSecond * 0.6, clamp( smoothstep( 0.25, 0.6, vCoatD.w + n * 0.2 ) + smoothstep( 0.3, 0.6, vCoatE.w ), 0.0, 1.0 ) * uMarkG.x );
  return col;
}
/**
 * Horse colours over the coat (all amounts 0 for other animals): mane and tail
 * in their own colour, black points on the lower legs, and dapples. On horse
 * packs coatE.z is the long hair (mane, forelock, tail), coatD.w the midline of the face.
 */
vec3 horseCoat( vec3 col, float n ) {
  float hair = smoothstep( 0.3, 0.7, vCoatE.z );
  // Dapples: rounded patches of lighter coat on the body, fading on the head and lower legs.
  float dp = furSpots( vCoatPos / 0.08 + n * 0.7 ) * ( 1.0 - 0.7 * vCoatA.y ) * smoothstep( 0.7, 0.95, vCoatA.x ) * ( 1.0 - hair );
  col = furMixP( col, uWhite, dp * uMarkI.z * 0.8 );
  col = mix( col, uSecond, smoothstep( 0.97, 0.78, vCoatA.x + n * 0.12 ) * uMarkI.y );
  // Mane and tail hair: streaky, lighter and darker locks.
  vec3 mane = uTan * ( 0.75 + 0.5 * furStreak( vCoatPos * 0.6 + 2.1 ) );
  col = mix( col, mane, hair * uMarkI.x );
  return col;
}
/** Dark band of a stripe pattern: s in stripe periods, dark around whole numbers, about a third of the period wide. */
float furStripe( float s, float width ) {
  float d = abs( fract( s + 0.5 ) - 0.5 );
  float aa = max( fwidth( s ), 0.04 );
  return smoothstep( width + aa, width - aa, d );
}
/**
 * Mackerel tabby: bars down the sides, rings on the lower legs and the tail,
 * lines across the forehead, and a dark line along the spine. The stripe
 * coordinates (coatF on cat packs) come from the importer; noise makes the stripes wavy and broken.
 */
float furTabby( vec3 p ) {
  float legW = vCoatF.w, headW = vCoatA.y, tailT = vCoatA.w;
  float tailW = smoothstep( 0.0, 0.06, tailT );
  float trunkW = max( 0.0, 1.0 - legW - headW - tailW );
  float warp = ( furFbm( p * 30.0 ) - 0.5 ) * 1.4;
  float broken = smoothstep( 0.3, 0.55, furFbm( p * 48.0 + 11.0 ) );
  float t = trunkW * furStripe( vCoatF.x + warp, 0.25 ) * mix( 0.45, 1.0, broken );
  t += legW * furStripe( vCoatF.y + warp * 0.4, 0.15 ) * 0.75;
  t += headW * furStripe( vCoatF.z + warp * 0.25, 0.16 );
  t += tailW * furStripe( tailT * 8.0 + warp * 0.3, 0.2 );
  // Lighter belly: the stripes fade into spots there.
  t *= vCoatE.z * ( 1.0 - 0.8 * smoothstep( 0.45, 0.95, vCoatD.y ) );
  // The dark line along the spine.
  t = max( t, smoothstep( 0.93, 0.995, vCoatD.x + warp * 0.05 ) * ( trunkW + tailW ) );
  return clamp( t, 0.0, 1.0 );
}
/** Coat colour from the region data and the markings. */
vec3 furCoat() {
  float legT = vCoatA.x, headW = vCoatA.y, muzzleT = vCoatA.z, tailT = vCoatA.w;
  float ear = vCoatB.x, brow = vCoatB.z, bib = vCoatB.w;
  float back = vCoatD.x, mask = vCoatD.z, blaze = vCoatD.w;
  // (A frosted squirrel tail has no pale underside: its colour comes from the banded hairs.)
  float under = vCoatD.y * ( 1.0 - vCoatE.z * step( 0.01, uMarkE.z ) );
  vec3 p = vCoatPos / uGrain;
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
  col = deerCoat( col, n );
  col = horseCoat( col, n );
  // Cats: tortoiseshell patches (tan), then tabby stripes (darker red inside the patches), light inner ears.
  if ( uMarkH.x + uMarkH.y + uMarkH.z > 0.0 ) {
    float tortie = smoothstep( 0.6, 0.68, furFbm( p * 7.0 + 5.3 ) + n * 0.15 + 0.06 * vCoatD.x ) * uMarkH.y * ( 1.0 - headW * 0.5 ) * ( 1.0 - vCoatD.y );
    col = mix( col, uTan, tortie );
    col = mix( col, mix( uSecond, uTan * 0.45, tortie ), furTabby( p ) * uMarkH.x );
    col = mix( col, uWhite, smoothstep( 0.2, 0.6, vCoatE.y ) * uMarkH.z );
  }
  // Spots.
  float spot = furSpots( p / ( 0.034 * max( uMarkC.y, 0.2 ) ) ) * uMarkC.x * ( 1.0 - vCoatC.x );
  col = mix( col, uSecond, spot );
  // White markings.
  float white = smoothstep( 0.5, 0.65, under + n * 0.25 ) * uMarkA.w;
  white = max( white, smoothstep( 0.35, 0.6, bib + n * 0.2 ) * uMarkB.x );
  white = max( white, ( 1.0 - smoothstep( uMarkB.y * 0.92 - 0.1, uMarkB.y * 0.92, legT + n * 0.1 ) ) * step( 0.01, uMarkB.y ) );
  white = max( white, smoothstep( 0.25, 0.5, blaze * 1.4 * uMarkB.z + muzzleT * uMarkB.z * 0.6 * step( 0.5, uMarkB.z ) + n * 0.1 ) * step( 0.01, uMarkB.z ) );
  white = max( white, smoothstep( 1.0 - 0.3 * uMarkB.w, 1.0 - 0.24 * uMarkB.w, tailT ) * step( 0.01, uMarkB.w ) );
  // Horse face marking: wider down the face's midline as the amount grows (strip, blaze, bald face).
  white = max( white, smoothstep( 1.0 - uMarkI.w, 1.06 - uMarkI.w, vCoatD.w + n * 0.08 ) * step( 0.01, uMarkI.w ) * ( 1.0 - smoothstep( 0.3, 0.6, vCoatE.z ) ) );
  col = mix( col, uWhite, white );
  // Frosted (grizzled) coats: salt-and-pepper flecks of light and dark hair tips, big enough to read from afar.
  {
    float fleck = furStreak( p * 0.9 + 2.3 );
    float where = ( 1.0 - under ) * ( 1.0 - vCoatE.y ) * ( 1.0 - vCoatC.x );
    col = mix( col, mix( uWhite, uBase, 0.25 ), smoothstep( 0.5, 0.68, fleck ) * where * uMarkE.y * 0.75 );
    col = mix( col, uSecond, smoothstep( 0.4, 0.26, fleck ) * where * uMarkE.y * uMarkD.y * 0.7 );
  }
  // Squirrel tail: the dark band of the hairs shows through near the skin.
  col = mix( col, uSecond * 0.8, vCoatE.z * uMarkE.z * 0.2 );
  // Pale eye ring.
  col = mix( col, uWhite * 0.96, smoothstep( 0.25, 0.6, vCoatE.y + n * 0.15 ) * uMarkE.x );
  // Bare skin: nose leather, lips, pads, eye rims.
  vec3 bare = vec3( 0.025, 0.02, 0.02 );
  float pad = furNosePad();
  float bareW = clamp( max( vCoatC.x + vCoatC.y + vCoatC.z + vCoatC.w, pad ), 0.0, 1.0 );
  // Plain nose leather colour (cats); the detailed nose below replaces it.
  bare = mix( bare, uLeather, clamp( vCoatC.x / max( bareW, 1e-3 ), 0.0, 1.0 ) );
  if ( uNose.w > 0.5 ) {
    // Nose leather seen from the front (vCoatF.xy: side, up; dog-sized meters): a pebbled pad,
    // comma-shaped nostrils curving out and down, and the philtrum splitting the lip below.
    vec2 q = vCoatF.xy;
    vec3 leather = uNose.rgb * ( 0.8 + 0.4 * furNoise( vCoatPos / uGrain * 2600.0 ) );
    // A little darker toward the edge of the pad.
    leather *= mix( 1.0, 0.7, smoothstep( 0.006, 0.014, length( q * vec2( 0.8, 1.0 ) ) ) );
    float nostril = 0.0;
    for ( int k = 0; k < 2; k++ ) {
      float s = k == 0 ? 1.0 : -1.0;
      vec2 r = q - vec2( s * 0.0062, -0.0012 );
      float a = s * 0.75;
      r = vec2( cos( a ) * r.x - sin( a ) * r.y, sin( a ) * r.x + cos( a ) * r.y );
      // Curve the slit: shift it sideways by its height squared.
      r.x += 120.0 * r.y * r.y * s;
      nostril = max( nostril, 1.0 - smoothstep( 0.75, 1.05, length( r / vec2( 0.0016, 0.0042 ) ) ) );
    }
    float philtrum = ( 1.0 - smoothstep( 0.0006, 0.0014, abs( q.x ) ) ) * smoothstep( -0.0035, -0.0065, q.y );
    leather = mix( leather, vec3( 0.02, 0.012, 0.01 ), max( nostril, philtrum ) );
    float noseW = max( smoothstep( 0.0, 0.6, vCoatC.x ), pad );
    // Lips in a darker shade of the leather rather than black.
    bare = mix( bare, uNose.rgb * 0.22, clamp( vCoatC.y / max( bareW, 1e-3 ), 0.0, 1.0 ) );
    bare = mix( bare, leather, clamp( noseW / max( bareW, 1e-3 ), 0.0, 1.0 ) );
  }
  col = mix( col, bare, bareW );
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
  // Fine-furred small animals: long hair grows in thicker locks (a squirrel's tail plume).
  vec3 p = vCoatPos / ( uFur.z * mix( 1.0, max( vCoatB.y, 1.0 ), 0.6 * step( uGrain, 0.99 ) ) );
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
float furBare = clamp( max( vCoatC.x + vCoatC.y + vCoatC.z + vCoatC.w, furNosePad() ), 0.0, 1.0 );
#ifdef FUR_SHELL
  diffuseColor.a = furStrands() * ( 1.0 - furBare ) * step( 0.0005, uFur.x * vCoatB.y );
  // Darker near the skin (strands shade each other).
  diffuseColor.rgb *= mix( 0.72, 1.06, vShell );
  // Agouti: dark guard hair tips, strongest along the back, faint on the underside and legs.
  {
    float tipBand = smoothstep( 0.45, 0.8, vShell ) * smoothstep( 0.3, 0.6, furStreak( vCoatPos / uGrain + 0.37 ) );
    float where = ( 1.0 - vCoatD.y ) * ( 0.35 + 0.65 * vCoatD.x ) * ( 1.0 - 0.7 * vCoatD.z ) * ( 1.0 - vCoatE.z * step( 0.01, uMarkE.z ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, uSecond * 0.6, tipBand * where * uMarkD.y * 0.75 );
  }
  // Frost: white tips on some guard hairs, silvering the coat (not on the white underside).
  {
    float tipBand = smoothstep( 0.62, 0.9, vShell ) * smoothstep( 0.45, 0.7, furStreak( vCoatPos / uGrain + 1.91 ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, uWhite, tipBand * ( 1.0 - vCoatD.y ) * ( 1.0 - vCoatE.y ) * uMarkE.y * 0.8 );
  }
  // Squirrel tail: each hair brown at the root, then a dark band, then a white tip, so the plume
  // shows a dark inner zone and a white fringe.
  {
    float t = vCoatE.z * uMarkE.z;
    float band = smoothstep( 0.1, 0.2, vShell ) * ( 1.0 - smoothstep( 0.3, 0.4, vShell ) );
    float tipW = smoothstep( 0.34, 0.48, vShell );
    diffuseColor.rgb = mix( diffuseColor.rgb, uSecond * 0.7, band * t * 0.6 );
    diffuseColor.rgb = mix( diffuseColor.rgb, uWhite, tipW * t * ( 0.7 + 0.3 * furStreak( vCoatPos / uGrain + 4.2 ) ) );
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
      // No sheen on bare skin (nose, lips, pads); wet nose and lips. The sheen takes the coat colour, so dark coats
      // (a bay horse) don't turn pale where the shells thin out.
      .replace("#include <lights_physical_fragment>", "#include <lights_physical_fragment>\n#ifdef USE_SHEEN\nmaterial.sheenColor *= ( 1.0 - furBare ) * clamp( diffuseColor.rgb * 2.5, 0.0, 1.0 );\n#endif\nmaterial.roughness = mix( material.roughness, 0.45, vCoatC.x );")
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
    shader.uniforms.uMarkH = uniforms.uMarkH;
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vEyeUv;").replace("#include <uv_vertex>", "#include <uv_vertex>\nvEyeUv = uv;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vEyeUv; uniform vec3 uIris; uniform vec4 uMarkH;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  float r = vEyeUv.y;
  float slit = uMarkH.w;
  float rays = 0.85 + 0.15 * sin( vEyeUv.x * 6.2831 * 23.0 ) * sin( vEyeUv.x * 6.2831 * 7.0 + r * 40.0 );
  // Cats' irises fill the whole visible eye.
  float edge = mix( 0.34, 0.44, slit );
  vec3 iris = uIris * rays * mix( 1.3, 0.6, smoothstep( 0.1, edge, r ) );
  // Pupil: round, or an upright ellipse narrowing to a slit (u runs around the eye from its horizontal axis).
  float a = vEyeUv.x * 6.2831;
  float pupil = length( vec2( cos( a ) * r / mix( 0.1, 0.022, slit ), sin( a ) * r / mix( 0.1, 0.2, slit ) ) );
  vec3 c = mix( vec3( 0.005 ), iris, smoothstep( 0.9, 1.1, pupil ) );
  // A dark limbal ring, then the little sclera dogs show, mostly brown.
  c = mix( c, vec3( 0.03, 0.02, 0.015 ), smoothstep( edge - 0.01, edge + 0.03, r ) );
  c = mix( c, vec3( 0.2, 0.12, 0.08 ), smoothstep( edge + 0.11, edge + 0.21, r ) );
  diffuseColor.rgb = c;
}`,
      );
  };
  mat.customProgramCacheKey = () => "actors-animal-eye";
  return useDualQuaternionSkinning(mat);
}

/** Tack (saddle, bridle, stirrups): leather, or steel for `metal`. Colours are linear. */
export function createTackMaterial(color: [number, number, number] = [0.2, 0.1, 0.05], roughness = 0.5, metal = false): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(...color), roughness, metalness: metal ? 0.9 : 0 });
  return useDualQuaternionSkinning(mat);
}

/** Whiskers: thin, slightly glossy hairs. */
export function createWhiskerMaterial(color: [number, number, number] = [0.86, 0.84, 0.8]): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(...color, THREE.SRGBColorSpace), roughness: 0.35 });
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
      if (data.def.tags?.includes("whiskers")) return createWhiskerMaterial(data.def.material.color);
      if (data.def.tags?.includes("tack") && kind === "other") return createTackMaterial(data.def.material.color, data.def.material.roughness, data.def.tags.includes("metal"));
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

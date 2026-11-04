import * as THREE from "three";

export const MAX_COLLIDERS = 4;

/** Leg capsules (model space) that skirt-like garments are pushed out of. */
export interface ColliderUniforms {
  uCapA: { value: THREE.Vector4[] }; // xyz = segment start, w = radius
  uCapB: { value: THREE.Vector3[] }; // segment end
  /** Body centre line (the garment is pushed away from it, horizontally). */
  uCenter: { value: THREE.Vector3 };
  /**
   * Cloth motion (see ClothSway): x, z = how far the loose cloth hangs tilted, in radians, in model
   * space; y = how far it lags behind the hips' turn, in radians. All 0: the cloth hangs as skinned.
   */
  uSway: { value: THREE.Vector3 };
  /** Where the loose cloth hangs from: between the hip joints, in model space. */
  uPivot: { value: THREE.Vector3 };
}

export function createColliderUniforms(): ColliderUniforms {
  return {
    uCapA: { value: Array.from({ length: MAX_COLLIDERS }, () => new THREE.Vector4(0, -100, 0, 0)) },
    uCapB: { value: Array.from({ length: MAX_COLLIDERS }, () => new THREE.Vector3(0, -100, 0)) },
    uCenter: { value: new THREE.Vector3() },
    uSway: { value: new THREE.Vector3() },
    uPivot: { value: new THREE.Vector3() },
  };
}

const PARS = /* glsl */ `
uniform vec4 uCapA[ ${MAX_COLLIDERS} ];
uniform vec3 uCapB[ ${MAX_COLLIDERS} ];
uniform vec3 uCenter;
uniform vec3 uSway;
uniform vec3 uPivot;
`;

// Cloth motion before the legs push it out: cloth below the hips swings like a pendulum hung
// there (further out the lower it hangs, rising a little as it swings) and lags the hips' turn.
const SWAY = /* glsl */ `
vec2 swayO = vec2( 0.0 );
vec3 swayFrom = transformed;
{
  float hang = uPivot.y - transformed.y;
  if ( hang > 0.0 && ( uSway.x != 0.0 || uSway.y != 0.0 || uSway.z != 0.0 ) ) {
    float tw = uSway.y * smoothstep( 0.0, 0.6, hang );
    vec2 r = transformed.xz - uPivot.xz;
    float c = cos( tw ), s = sin( tw );
    transformed.xz = uPivot.xz + vec2( c * r.x + s * r.y, c * r.y - s * r.x );
    // Cloth bends as it swings: the hem goes further than a stiff pendulum would.
    vec2 o = uSway.xz * hang * ( 0.6 + 0.4 * min( hang / 0.6, 1.0 ) );
    // Cloth against a leg stays with it, unless the swing carries it away from the leg: else the
    // cloth beside the leg would swing off and bare it.
    float free_ = 1.0;
    vec3 dir = vec3( o.x, 0.0, o.y ) / max( length( o ), 1e-6 );
    for ( int i = 0; i < ${MAX_COLLIDERS}; i ++ ) {
      float r = uCapA[ i ].w;
      if ( r <= 0.0 ) continue;
      vec3 a = uCapA[ i ].xyz, ab = uCapB[ i ] - a;
      float len = max( length( ab ), 1e-5 );
      vec3 axis = ab / len;
      vec3 rel = transformed - ( a + axis * clamp( dot( transformed - a, axis ), 0.0, len ) );
      float along = dot( rel, dir );
      float lat = length( rel - dir * along - axis * dot( rel - dir * along, axis ) );
      free_ = min( free_, max( smoothstep( -0.5 * r, 1.5 * r, along ), smoothstep( r, 2.5 * r, lat ) ) );
    }
    o *= free_;
    transformed.xz += o;
    swayO = o;
    transformed.y += dot( o, o ) / ( 2.0 * hang );
  }
}
`;

// After skinning: a vertex inside a leg capsule is moved outward, away from the
// body's centre line (horizontally), until it sits on the capsule. Moving every
// vertex the same way (rather than away from each leg) keeps the cloth whole
// where both legs are close. On a level leg (seated) that direction runs along
// the thigh, so there the cloth is moved up instead, onto the lap. A soft band lets the cloth tent over the leg.
const PUSH = /* glsl */ `
{
  vec3 out_ = transformed - uCenter;
  out_.y = 0.0;
  vec3 n = length( out_ ) > 1e-4 ? normalize( out_ ) : vec3( 0.0, 0.0, 1.0 );
  for ( int i = 0; i < ${MAX_COLLIDERS}; i ++ ) {
    vec3 a = uCapA[ i ].xyz, b = uCapB[ i ];
    float r = uCapA[ i ].w;
    if ( r <= 0.0 ) continue;
    vec3 ab = b - a;
    float len = max( length( ab ), 1e-5 );
    vec3 axis = ab / len;
    float h = clamp( dot( transformed - a, axis ), 0.0, len );
    // Cloth swung across a leg stops behind it: a swing can carry it further than the leg is
    // thick, so testing where it ends up alone would let it pass straight through.
    vec3 sw = vec3( swayO.x, 0.0, swayO.y );
    sw -= axis * dot( sw, axis );
    if ( dot( sw, sw ) > 1e-8 ) {
      vec3 dir = normalize( sw );
      vec3 c0 = a + axis * clamp( dot( swayFrom - a, axis ), 0.0, len );
      vec3 rel0 = swayFrom - c0;
      float along0 = dot( rel0, dir );
      vec3 lat = rel0 - dir * along0;
      lat -= axis * dot( lat, axis );
      float l = length( lat );
      if ( along0 < 0.0 && l < r ) {
        // Only cloth that started behind the leg, and back by no more than it swung.
        float stop = -sqrt( r * r - l * l );
        float along = dot( transformed - c0, dir );
        if ( along0 <= stop && along > stop ) transformed -= dir * min( along - stop, length( sw ) );
      }
      h = clamp( dot( transformed - a, axis ), 0.0, len );
    }
    vec3 d = transformed - ( a + axis * h ); // offset from the axis
    float dist = length( d );
    float soft = r * 1.6;
    if ( dist >= soft ) continue;
    // Monotonic remap [0, soft] -> [r, soft]: stacked cloth layers keep their order.
    float target = r + ( soft - r ) * ( dist / soft );
    // Walk along n (projected off the axis) until the offset reaches target: |d + s m| = target.
    // Away from the centre line on an upright leg; up on a level one (a seated lap: the centre line
    // points along the thigh there, and the cloth, skinned between the legs, belongs on top).
    vec3 side = n - axis * dot( n, axis );
    vec3 up = vec3( 0.0, 1.0, 0.0 ) - axis * axis.y;
    vec3 m = mix( side, up, smoothstep( 0.3, 0.8, 1.0 - abs( axis.y ) ) );
    // Cloth swung into a leg stops at it: back the way it swung, so it stays in front of the leg
    // (or behind it) instead of sliding round to the side and baring it.
    vec3 back = vec3( -swayO.x, 0.0, -swayO.y );
    back -= axis * dot( back, axis );
    float bl = length( back );
    if ( bl > 1e-4 ) m = mix( m, back / bl, smoothstep( 0.005, 0.03, length( swayO ) ) );
    float ml = length( m );
    if ( ml < 1e-3 ) continue;
    m /= ml;
    float dm = dot( d, m );
    float s = -dm + sqrt( max( dm * dm - dist * dist + target * target, 0.0 ) );
    transformed += m * min( s, 0.3 );
  }
}
`;

/** Adds cloth motion and leg-capsule collision to a skinned garment material (call after DQS). */
export function useColliders<T extends THREE.Material>(material: T, uniforms: ColliderUniforms): T {
  const previous = material.onBeforeCompile.bind(material);
  const prevKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${PARS}`)
      .replace("#include <project_vertex>", `${SWAY}\n${PUSH}\n#include <project_vertex>`);
  };
  material.customProgramCacheKey = () => `${prevKey()}|colliders`;
  return material;
}

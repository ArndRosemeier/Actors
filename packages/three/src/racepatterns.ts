/**
 * Fantasy-race skin patterns and eye shapes (ported from Norgo's shaders,
 * same author): scales, bark, spots, stripes, tattoos, glowing veins,
 * crystals and freckles, evaluated in 3D bind-pose space so they have no UV
 * seams and stick to the skin while it moves; slit, goat and no pupils and
 * glowing irises for the eye material.
 */

/** Pattern ids (uPattern.x). */
export const SKIN_PATTERNS = { none: 0, freckles: 1, scales: 2, bark: 3, spots: 4, tattoos: 5, veins: 6, stripes: 7, crystals: 8 } as const;
export type SkinPatternId = keyof typeof SKIN_PATTERNS;

/** Pupil shapes (uPupil.x). */
export const PUPILS = { round: 0, slit: 1, goat: 2, none: 3 } as const;
export type PupilId = keyof typeof PUPILS;

/** Hashing, value noise, fbm and Voronoi cells (prefixed h_ to avoid clashes with three.js chunks). */
export const GLSL_NOISE = /* glsl */ `
float h_hash13( vec3 p ) {
  p = fract( p * 0.1031 );
  p += dot( p, p.zyx + 31.32 );
  return fract( ( p.x + p.y ) * p.z );
}
vec3 h_hash33( vec3 p ) {
  p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) );
  p += dot( p, p.yxz + 33.33 );
  return fract( ( p.xxy + p.yxx ) * p.zyx );
}
float h_hash12( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float h_noise3( vec3 p ) {
  vec3 i = floor( p ), f = fract( p );
  vec3 u = f * f * ( 3.0 - 2.0 * f );
  float a = h_hash13( i ), b = h_hash13( i + vec3( 1, 0, 0 ) ), c = h_hash13( i + vec3( 0, 1, 0 ) ), d = h_hash13( i + vec3( 1, 1, 0 ) );
  float e = h_hash13( i + vec3( 0, 0, 1 ) ), f1 = h_hash13( i + vec3( 1, 0, 1 ) ), g = h_hash13( i + vec3( 0, 1, 1 ) ), h = h_hash13( i + vec3( 1, 1, 1 ) );
  return mix( mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y ), mix( mix( e, f1, u.x ), mix( g, h, u.x ), u.y ), u.z );
}
float h_noise2( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( h_hash12( i ), h_hash12( i + vec2( 1, 0 ) ), u.x ), mix( h_hash12( i + vec2( 0, 1 ) ), h_hash12( i + vec2( 1, 1 ) ), u.x ), u.y );
}
float h_fbm3( vec3 p ) {
  float s = 0.0, a = 0.5;
  for ( int i = 0; i < 4; i++ ) { s += a * h_noise3( p ); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
// Voronoi: x = F1 distance, y = F2 distance, z = cell id hash.
vec3 h_voronoi3( vec3 p ) {
  vec3 i = floor( p ), f = fract( p );
  float d1 = 8.0, d2 = 8.0, id = 0.0;
  for ( int z = -1; z <= 1; z++ ) for ( int y = -1; y <= 1; y++ ) for ( int x = -1; x <= 1; x++ ) {
    vec3 g = vec3( float( x ), float( y ), float( z ) );
    vec3 o = h_hash33( i + g );
    vec3 r = g + o - f;
    float d = dot( r, r );
    if ( d < d1 ) { d2 = d1; d1 = d; id = h_hash13( i + g + 7.7 ); } else if ( d < d2 ) { d2 = d; }
  }
  return vec3( sqrt( d1 ), sqrt( d2 ), id );
}
// Normal from a height field (meters) by screen-space derivatives.
vec3 h_bumpNormal( vec3 surfPos, vec3 n, float h, float faceDir ) {
  vec3 sx = dFdx( surfPos ), sy = dFdy( surfPos );
  vec3 r1 = cross( sy, n ), r2 = cross( n, sx );
  float det = dot( sx, r1 ) * faceDir;
  vec3 grad = sign( det ) * ( dFdx( h ) * r1 + dFdy( h ) * r2 );
  return normalize( abs( det ) * n - grad );
}
`;

/**
 * Skin pattern. Needs: varying vec3 vBind (bind-pose position, meters, feet at
 * y = 0, +Z = back), uniforms uPattern (id, strength, seed, glow), uAccent
 * (linear) and uBind (x = ground offset, y = body scale, z/w = head joint
 * height and depth in vBind space).
 * `skinPattern( c, lips, nails )` returns the new colour and sets sp_height,
 * sp_rough (-1 = unchanged) and sp_emit.
 */
export const GLSL_PATTERN = /* glsl */ `
float sp_height = 0.0;
float sp_rough = -1.0;
vec3 sp_emit = vec3( 0.0 );
vec3 skinPattern( vec3 c, float lips, float nails ) {
  float pid = uPattern.x, ps = uPattern.y, seed = uPattern.z;
  if ( pid < 0.5 || ps <= 0.0 ) return c;
  vec3 acc = uAccent;
  // Patterns are sized for a 1.7 m body; scaled races keep the same look.
  vec3 b = vBind / max( 0.3, uBind.y );
  vec3 hp = vec3( 0.0, uBind.zw ) / max( 0.3, uBind.y );
  // Face: above the head joint, in front of it (-Z).
  float faceZone = smoothstep( hp.y - 0.02, hp.y + 0.04, b.y ) * smoothstep( 0.0, -0.05, b.z - hp.z );
  if ( pid < 1.5 ) {
    // Freckles: dense on the face, patches elsewhere.
    vec3 v = h_voronoi3( b * 260.0 + seed * 13.0 );
    float zone = max( faceZone, smoothstep( 0.55, 0.8, h_noise3( b * 3.0 ) ) * 0.6 );
    float fr = ( 1.0 - smoothstep( 0.12, 0.3, v.x ) ) * step( 0.45, v.z ) * zone;
    c = mix( c, c * vec3( 0.78, 0.6, 0.48 ), fr * ps );
  } else if ( pid < 2.5 ) {
    // Scales: Voronoi plates, finer on the face, lighter on the belly, none on lips and nails.
    float sc = mix( 48.0, 95.0, faceZone );
    vec3 v = h_voronoi3( b * sc + seed * 5.0 );
    float aa = 1.0 - smoothstep( 0.08, 0.35, length( fwidth( b * sc ) ) );
    float edge = mix( 0.75, smoothstep( 0.0, 0.18, v.y - v.x ), aa );
    float dome = ( 1.0 - v.x ) * aa;
    float mask = ps * ( 1.0 - lips ) * ( 1.0 - nails );
    vec3 plate = mix( acc, c, 0.45 + 0.45 * mix( 0.5, v.z, aa ) );
    float belly = smoothstep( 0.0, -0.06, b.z ) * smoothstep( 0.6, 1.2, b.y ) * ( 1.0 - smoothstep( 1.35, 1.5, b.y ) ) * ( 1.0 - faceZone );
    plate = mix( plate, mix( c, acc, 0.5 ) * 1.15, belly * 0.6 );
    c = mix( c, mix( plate * 0.55, plate, edge ), mask );
    sp_height += mask * ( dome * 0.0009 + edge * 0.0004 );
    sp_rough = mix( 0.48, 0.32 + 0.2 * v.z, mask );
  } else if ( pid < 3.5 ) {
    // Bark: vertical ridged furrows warped by noise, knots, moss in the grooves.
    vec3 q = b * vec3( 28.0, 6.0, 28.0 ) + seed * 3.0;
    float warp = h_fbm3( q * 0.5 ) * 2.0;
    float ridge = abs( sin( ( b.x * 70.0 + b.z * 55.0 ) + warp * 3.0 + h_noise3( q ) * 2.0 ) );
    float groove = 1.0 - smoothstep( 0.0, 0.35, ridge );
    float m = ps * ( 1.0 - faceZone * 0.55 ) * ( 1.0 - lips );
    float knots = smoothstep( 0.75, 0.9, h_noise3( b * 12.0 + 4.0 ) );
    c = mix( c, acc, m * max( groove * 0.85, knots * 0.5 ) );
    float moss = smoothstep( 0.55, 0.75, h_fbm3( b * 9.0 + 9.0 ) ) * groove;
    c = mix( c, vec3( 0.013, 0.033, 0.005 ), m * moss * 0.6 );
    sp_height += m * ( ridge * 0.0016 - knots * 0.001 );
    sp_rough = mix( 0.48, 0.82, m );
  } else if ( pid < 4.5 ) {
    // Spots: irregular blotches.
    float sp = smoothstep( 0.55, 0.62, h_fbm3( b * 7.0 + seed * 11.0 ) );
    c = mix( c, mix( c, acc, 0.75 ), sp * ps * ( 1.0 - lips ) );
  } else if ( pid < 5.5 ) {
    // Tattoos: crisp tribal bands.
    float bands = abs( sin( b.y * 34.0 + h_fbm3( b * 5.0 + seed ) * 6.0 ) );
    float zone = smoothstep( 0.35, 0.6, h_noise3( b * 2.2 + seed * 2.0 ) ) * ( 1.0 - lips );
    float ink = ( 1.0 - smoothstep( 0.15, 0.22, bands ) ) * zone;
    c = mix( c, c * mix( vec3( 0.03, 0.04, 0.08 ), acc * 0.6, 0.3 ), ink * ps );
  } else if ( pid < 6.5 ) {
    // Veins: branching lines that glow.
    float v1 = abs( h_fbm3( b * 14.0 + seed ) - 0.5 );
    float v2 = abs( h_fbm3( b * 31.0 + seed * 2.0 ) - 0.5 );
    float vein = ( 1.0 - smoothstep( 0.0, 0.025, v1 ) ) + 0.5 * ( 1.0 - smoothstep( 0.0, 0.018, v2 ) );
    vein *= ps * ( 1.0 - lips ) * ( 0.6 + 0.4 * ( 1.0 - faceZone * 0.5 ) );
    c = mix( c, acc * 0.7, clamp( vein, 0.0, 1.0 ) * 0.7 );
    sp_emit += acc * vein * uPattern.w * 0.8;
    sp_height += vein * 0.0002;
  } else if ( pid < 7.5 ) {
    // Stripes: warped bands around the body.
    float s = sin( b.y * 26.0 + h_fbm3( b * 4.0 + seed ) * 7.0 + b.x * 4.0 );
    float st = smoothstep( 0.55, 0.75, s ) * smoothstep( 0.3, 0.6, h_noise3( b * 3.0 + 2.0 ) );
    c = mix( c, acc, st * ps * ( 1.0 - lips ) * ( 1.0 - faceZone * 0.4 ) );
  } else {
    // Crystals: faceted mineral patches with glints.
    vec3 v = h_voronoi3( b * 60.0 + seed * 3.0 );
    float patchM = smoothstep( 0.58, 0.68, h_fbm3( b * 5.0 + seed * 8.0 ) ) * ps * ( 1.0 - lips );
    c = mix( c, acc * ( 0.6 + 0.4 * v.z ), patchM );
    sp_height += patchM * ( 0.0012 * ( 1.0 - v.x ) + 0.0006 * v.z );
    sp_rough = mix( 0.48, 0.18, patchM );
    sp_emit += acc * patchM * uPattern.w * 0.3;
  }
  return c;
}
`;

/** Vertex snippet (after morphtarget_vertex): bind-pose position in Norgo's pattern space. */
export const GLSL_BIND_VERTEX = /* glsl */ `vBind = vec3( transformed.x, transformed.y + uBind.x, -transformed.z );`;

/**
 * Eye: replaces the texture's round pupil with the chosen shape and lets the
 * iris glow. Needs uniforms uPupil (x shape, y dilation 0..1, z glow) and the
 * eye texture layout of MakeHuman's eyes (two eyes in one atlas).
 * Sets ey_emit; expects diffuseColor and vMapUv.
 */
export const GLSL_EYE = /* glsl */ `
vec3 ey_emit = vec3( 0.0 );
{
  // Iris centres of the two eyes in the atlas and the iris radius (UV units).
  vec2 c0 = vec2( 0.7025, 0.6971 ), c1 = vec2( 0.2866, 0.2850 );
  vec2 cc = distance( vMapUv, c0 ) < distance( vMapUv, c1 ) ? c0 : c1;
  const float IRIS = 0.115;
  vec2 q = ( vMapUv - cc ) / IRIS;
  float r = length( q );
  float iris = 1.0 - smoothstep( 0.92, 1.0, r );
  if ( uPupil.x > 0.5 ) {
    // Paint the photo's round pupil over with iris colour from the ring outside it.
    vec2 ring = cc + ( r > 1e-3 ? q / r : vec2( 1.0, 0.0 ) ) * IRIS * 0.62;
    vec3 irisCol = texture2D( map, ring ).rgb;
    float oldPupil = 1.0 - smoothstep( 0.36, 0.5, r );
    diffuseColor.rgb = mix( diffuseColor.rgb, eyeShift( irisCol ), oldPupil );
    float pr = 0.32 + uPupil.y * 0.15;
    float pupil = 0.0;
    if ( uPupil.x < 1.5 ) pupil = 1.0 - smoothstep( 0.9, 1.05, length( vec2( q.x / ( pr * 0.28 ), q.y / ( pr * 2.2 ) ) ) );
    else if ( uPupil.x < 2.5 ) pupil = ( 1.0 - smoothstep( 0.9, 1.05, abs( q.x ) / ( pr * 1.7 ) ) ) * ( 1.0 - smoothstep( 0.9, 1.05, abs( q.y ) / ( pr * 0.45 ) ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.006 ), pupil * iris );
    ey_emit = diffuseColor.rgb * iris * ( 1.0 - pupil ) * uPupil.z * 2.5;
  } else {
    float pupil = 1.0 - smoothstep( 0.36, 0.5, r );
    ey_emit = diffuseColor.rgb * iris * ( 1.0 - pupil ) * uPupil.z * 2.5;
  }
}
`;

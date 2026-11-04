import * as THREE from "three";
import type { SkinUniforms } from "./materials";
import { useDualQuaternionSkinning } from "./dqs";

const white = (() => {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
})();

/**
 * Material of a crowd-level merged mesh (body, garments and hair in one draw call):
 * garments and hair take their vertex colour, skin (attribute `crowdSkin` = 1) the
 * actor's skin tone or blended photo skin; hems are cut per pixel where
 * `crowdClip` < 0, hair cards where their texture (`hairMaps[crowdHair - 1]`) is
 * transparent. Linear skinning, no extras.
 */
export function createCrowdMaterial(skin: SkinUniforms, hairMaps: readonly (THREE.Texture | null)[] = []): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    // Read at every draw: the actor swaps its hair maps when it rebuilds the crowd mesh.
    shader.uniforms.uHair0 = { get value() { return hairMaps[0] ?? white; } };
    shader.uniforms.uHair1 = { get value() { return hairMaps[1] ?? white; } };
    shader.uniforms.uTone = skin.uTone;
    shader.uniforms.uAlbedo = skin.uAlbedo;
    shader.uniforms.uAlbedoMix = skin.uAlbedoMix;
    shader.uniforms.uAlbedoTint = skin.uAlbedoTint;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float crowdSkin;\nattribute float crowdClip;\nattribute float crowdHair;\nvarying float vCrowdSkin;\nvarying float vCrowdClip;\nvarying float vCrowdHair;\nvarying vec2 vCrowdUv;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCrowdSkin = crowdSkin;\nvCrowdClip = crowdClip;\nvCrowdHair = crowdHair;\nvCrowdUv = uv;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec3 uTone;\nuniform sampler2D uAlbedo;\nuniform float uAlbedoMix;\nuniform vec3 uAlbedoTint;\nuniform sampler2D uHair0;\nuniform sampler2D uHair1;\nvarying float vCrowdSkin;\nvarying float vCrowdClip;\nvarying float vCrowdHair;\nvarying vec2 vCrowdUv;",
      )
      .replace(
        "#include <color_fragment>",
        "#include <color_fragment>\nif ( vCrowdClip < 0.0 ) discard;\nif ( vCrowdHair > 0.5 && ( vCrowdHair < 1.5 ? texture2D( uHair0, vCrowdUv ).a : texture2D( uHair1, vCrowdUv ).a ) < 0.35 ) discard;\n{\n  vec3 skinCol = uTone;\n  if ( uAlbedoMix > 0.0 ) skinCol = mix( skinCol, texture2D( uAlbedo, vCrowdUv ).rgb * uAlbedoTint, uAlbedoMix );\n  diffuseColor.rgb = mix( diffuseColor.rgb, skinCol, vCrowdSkin );\n}",
      );
  };
  mat.customProgramCacheKey = () => "actors-crowd";
  return mat;
}

/**
 * Material of a merged outfit (all garments of a detail level in one draw, see
 * `ThreeActor.mergeOutfitFrom`): colour from the outfit's texture atlas, recoloured per vertex
 * the way a garment's tint recolours it (`outfitTint` rgb + mix, `outfitInfo` x = the texture's
 * mean brightness), roughness and metalness per vertex (`outfitInfo` z, w), hems cut where
 * `outfitInfo` y < 0, lace and fishnet cut by the atlas alpha. Two-sided, dual-quaternion skinned.
 */
export function createOutfitMaterial(atlas: THREE.Texture): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ map: atlas, roughness: 1, metalness: 1, alphaTest: 0.5, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 outfitTint;\nattribute vec4 outfitInfo;\nvarying vec4 vOutfitTint;\nvarying vec4 vOutfitInfo;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvOutfitTint = outfitTint;\nvOutfitInfo = outfitInfo;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec4 vOutfitTint;\nvarying vec4 vOutfitInfo;\nfloat tintGain( float g ) { return g > 1.0 ? 1.0 + 0.5 * ( g - 1.0 ) / ( g - 0.5 ) : g; }",
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
if ( vOutfitInfo.y < 0.0 ) discard;
float clothLum = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
diffuseColor.rgb = mix( diffuseColor.rgb, vOutfitTint.rgb * tintGain( clothLum / max( vOutfitInfo.x, 0.01 ) ), vOutfitTint.a );`,
      )
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor *= vOutfitInfo.z;")
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor *= vOutfitInfo.w;")
      .replace("#include <alphatest_fragment>", "if ( textureLod( map, vMapUv, 0.0 ).a < alphaTest ) discard;");
  };
  mat.customProgramCacheKey = () => "actors-outfit";
  return useDualQuaternionSkinning(mat);
}

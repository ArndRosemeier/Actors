import * as THREE from "three";
import type { SkinUniforms } from "./materials";

/**
 * Material of a crowd-level merged mesh (body + garments in one draw call):
 * garments take their vertex colour, skin (attribute `crowdSkin` = 1) the
 * actor's skin tone or blended photo skin; hems are cut per pixel where
 * `crowdClip` < 0. Linear skinning, no extras.
 */
export function createCrowdMaterial(skin: SkinUniforms): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTone = skin.uTone;
    shader.uniforms.uAlbedo = skin.uAlbedo;
    shader.uniforms.uAlbedoMix = skin.uAlbedoMix;
    shader.uniforms.uAlbedoTint = skin.uAlbedoTint;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float crowdSkin;\nattribute float crowdClip;\nvarying float vCrowdSkin;\nvarying float vCrowdClip;\nvarying vec2 vCrowdUv;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCrowdSkin = crowdSkin;\nvCrowdClip = crowdClip;\nvCrowdUv = uv;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec3 uTone;\nuniform sampler2D uAlbedo;\nuniform float uAlbedoMix;\nuniform vec3 uAlbedoTint;\nvarying float vCrowdSkin;\nvarying float vCrowdClip;\nvarying vec2 vCrowdUv;",
      )
      .replace(
        "#include <color_fragment>",
        "#include <color_fragment>\nif ( vCrowdClip < 0.0 ) discard;\n{\n  vec3 skinCol = uTone;\n  if ( uAlbedoMix > 0.0 ) skinCol = mix( skinCol, texture2D( uAlbedo, vCrowdUv ).rgb * uAlbedoTint, uAlbedoMix );\n  diffuseColor.rgb = mix( diffuseColor.rgb, skinCol, vCrowdSkin );\n}",
      );
  };
  mat.customProgramCacheKey = () => "actors-crowd";
  return mat;
}

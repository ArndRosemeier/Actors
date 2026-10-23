import type { MessagePortLike } from "@actors/core";
import { Character, type CharacterPatch } from "./character";
import { CharacterEditor, type EditorOptions } from "./editor";
import { CharacterStage, type StageOptions } from "./stage";

export interface GeneratorOptions extends StageOptions, EditorOptions {
  /** URL of the pack's manifest.json. */
  pack: string;
  /** Element for the 3D view. */
  view: HTMLElement;
  /** Element for the control panel; omit for a view without controls. */
  panel?: HTMLElement;
  /** Optional Web Worker running `@actors/human/worker`. */
  worker?: MessagePortLike;
  config?: CharacterPatch;
}

export interface CharacterGenerator {
  character: Character;
  stage: CharacterStage;
  editor?: CharacterEditor;
  dispose(): void;
}

/**
 * The whole generator in one call: a stage in `view`, a character on it and,
 * if `panel` is given, the editor panel.
 *
 * ```ts
 * const { character } = await createCharacterGenerator({ pack: "/packs/human/manifest.json", view, panel });
 * await character.wear("casual");
 * await character.play("walk");
 * ```
 */
export async function createCharacterGenerator(options: GeneratorOptions): Promise<CharacterGenerator> {
  const stage = await CharacterStage.create(options.view, options);
  const character = await Character.load({ pack: options.pack, renderer: stage.renderer, materials: stage.materials, screenTextures: stage.screenTextures, worker: options.worker, config: options.config });
  const remove = stage.add(character);
  character.lodCamera = stage.camera;
  // Keep very small or very tall characters (goblins, giantkin) in frame.
  let framed = 1.7;
  const reframe = (h: number) => {
    if (h > 0 && Math.abs(Math.log(h / framed)) > Math.log(1.2)) stage.frame((framed = h));
  };
  reframe(character.height);
  const stopFraming = character.onShape(reframe);
  const editor = options.panel ? new CharacterEditor(character, options.panel, options) : undefined;
  return {
    character,
    stage,
    editor,
    dispose() {
      editor?.dispose();
      stopFraming();
      remove();
      character.dispose();
      stage.dispose();
    },
  };
}

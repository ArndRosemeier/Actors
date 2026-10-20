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
  const stage = new CharacterStage(options.view, options);
  const character = await Character.load({ pack: options.pack, renderer: stage.renderer, worker: options.worker, config: options.config });
  const remove = stage.add(character);
  const editor = options.panel ? new CharacterEditor(character, options.panel, options) : undefined;
  return {
    character,
    stage,
    editor,
    dispose() {
      editor?.dispose();
      remove();
      character.dispose();
      stage.dispose();
    },
  };
}

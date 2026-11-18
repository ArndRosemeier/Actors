import type { HumanParams } from "@actors/human";
import { CrowdFigures, type CrowdFiguresOptions, type CrowdMan, type CrowdPiece, type PlayableClip, crowdPieces } from "@actors/three";
import type { Character, CharacterPatch } from "./character";

/** One kind of crowd figure: a build in an outfit (see `buildCrowdFigures`). */
export interface CrowdKindSpec {
  id: string;
  /** Its build (a key of `CrowdSpec.builds`): kinds on the same build share its baked clips. */
  build: string;
  /** The look baked in: outfit, garment colours, skin. Its hair is not used: hairstyles are `options`. */
  look: CharacterPatch;
  /** Garments (hats) and hairstyles each man may wear or not, by catalog id (see `CrowdLook.show`). */
  options?: string[];
  /** Up to three groups of garment ids each man recolours (`CrowdLook.tints`). */
  tints?: string[][];
  /** Most men of this kind. Default 64. */
  max?: number;
  /** Casts the sun's shadow. Default true. */
  castShadow?: boolean;
}

/** What `buildCrowdFigures` bakes. */
export interface CrowdSpec extends Omit<CrowdFiguresOptions, "capacity"> {
  /** Body sliders of each build, by name (gender, age, height, weight, muscle, proportions...). */
  builds: Record<string, Partial<HumanParams>>;
  kinds: CrowdKindSpec[];
  /** Clips (catalog animation ids) every build bakes; men play them by these ids. */
  clips: string[];
  /** Of `clips`, those that play once and hold their last frame. */
  once?: string[];
  /** Instance rows (default: the kinds' `max` summed). */
  capacity?: number;
}

/**
 * Bakes crowd figures with `character` as the workbench: for each build, its clips; for each kind,
 * the crowd level's merged mesh in that outfit (coat tails and skirts merged too), plus each
 * optional hat or hairstyle on its own. The character is dressed back as it was afterwards; it
 * must be able to draw the crowd level (see `CharacterOptions.levels`).
 *
 * ```ts
 * const figures = await buildCrowdFigures(character, {
 *   material: createNodeCrowdFigureMaterial,
 *   builds: { lean: { gender: 1, muscle: 0.6, weight: 0.35 }, stocky: { gender: 1, muscle: 0.75, weight: 0.6 } },
 *   kinds: [{ id: "seaman-lean", build: "lean", look: { outfit: [...] }, options: ["navy-round-hat", "hair-short02"], tints: [["navy-slops"]] }],
 *   clips: ["idle", "walk"],
 * });
 * scene.add(figures.object);
 * const man = figures.add("seaman-lean", { skin: "#a87a5a", show: ["navy-round-hat"], tints: ["#c9c1ab"] });
 * man.matrix.compose(position, turn, new THREE.Vector3(1.02, 1.02, 1.02));
 * figures.play(man, "walk", { time: 0.4 });
 * // every frame: figures.update(dt);
 * ```
 */
export async function buildCrowdFigures(character: Character, spec: CrowdSpec): Promise<CrowdFigures> {
  const actor = character.actor;
  const merge = actor.lods.findIndex((l) => l.merge);
  if (merge < 0) throw new Error("buildCrowdFigures: the pack has no merging (crowd) level");
  if (!actor.levels.includes(merge)) throw new Error("buildCrowdFigures: the workbench character cannot draw the crowd level (see CharacterOptions.levels)");
  const saved = character.config, savedLod = character.lodMode, savedSkirts = actor.crowdSkirts;
  const hairIds = new Set(character.catalog.hair.map((h) => h.id));
  const figures = new CrowdFigures({ ...spec, capacity: spec.capacity ?? spec.kinds.reduce((s, k) => s + (k.max ?? 64), 0) });
  const clips: Record<string, PlayableClip> = {};
  for (const id of spec.clips) clips[id] = await character.loadClip(id);
  try {
    actor.crowdSkirts = true;
    character.setLod(merge);
    for (const [build, body] of Object.entries(spec.builds)) {
      const kinds = spec.kinds.filter((k) => k.build === build);
      for (const [i, kind] of kinds.entries()) {
        const base: CharacterPatch = { ...kind.look, body: { ...kind.look.body, ...body }, hair: null, animation: null };
        const outfit = base.outfit ?? [];
        await character.set(base);
        if (i === 0) figures.addBuild(build, actor, clips, { once: spec.once });
        const pieces: CrowdPiece[] = crowdPieces(actor);
        for (const option of kind.options ?? []) {
          // Each option on its own over the base outfit (a hat left on could hide the next hairstyle).
          await character.set(hairIds.has(option) ? { hair: option, outfit } : { hair: null, outfit: [...outfit, option] });
          pieces.push(...crowdPieces(actor).filter((p) => p.name === option));
        }
        figures.addKind(kind.id, build, pieces, { options: kind.options, tints: kind.tints, max: kind.max, castShadow: kind.castShadow });
      }
    }
  } finally {
    actor.crowdSkirts = savedSkirts;
    await character.set(saved);
    character.setLod(savedLod);
  }
  return figures;
}

/**
 * Hands a crowd man over to a full character (the man fades out over `fade` seconds; the character
 * shows at once): the character plays the man's clip from the same time, so both stand in the same
 * pose. Place the character where the man stands first (`man.matrix`, in his kind mesh's frame).
 */
export async function crowdToCharacter(figures: CrowdFigures, man: CrowdMan, character: Character, fade = 0.3): Promise<void> {
  const playing = man.playing;
  if (playing) {
    await character.play(playing.clip);
    const action = character.actor.currentAction;
    if (action) action.time = playing.time;
  }
  figures.fade(man, 0, fade);
}

/**
 * Hands a full character back to its crowd man: the man takes the character's clip and time when
 * he has that clip baked, else its pose as it is now (`CrowdFigures.pose`), and fades in over `fade`
 * seconds. Hide the character once the fade is done.
 */
export function characterToCrowd(figures: CrowdFigures, man: CrowdMan, character: Character, fade = 0.3): void {
  const clip = character.config.animation;
  const action = character.actor.currentAction;
  if (clip && action && figures.clipsOf(man.kind).includes(clip)) figures.play(man, clip, { time: action.time });
  else figures.pose(man, character.actor);
  figures.fade(man, 0);
  figures.fade(man, 1, fade);
}

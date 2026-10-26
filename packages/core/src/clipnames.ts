/**
 * Picking a clip for a common motion by its name, for animals whose clips come from a pack with its own
 * naming (the animal library: "WalkFast_F", "G0_Walk", "walk_fwd_01" all mean walk).
 */

/** Common motions that most library animals have under some clip name (see `pickLibraryClip`). */
export type LibraryMotion = "idle" | "walk" | "trot" | "run" | "eat" | "sit" | "lie" | "attack" | "hit" | "death" | "swim" | "fly";

const MOTIONS: Record<LibraryMotion, RegExp> = {
  idle: /idle/i,
  walk: /walk/i,
  trot: /trot|canter/i,
  run: /(^|[^a-zA-Z])run|Run|gallop|Gallop|sprint|Sprint/,
  eat: /(^|[^a-zA-Z])eat|[a-z]Eat|graz|Graz|peck|Peck|food|Food/,
  sit: /sit/i,
  lie: /lie|lay|lying|sleep|rest/i,
  attack: /attack|bite/i,
  hit: /hit|damage/i,
  death: /death|die|dead/i,
  swim: /swim/i,
  fly: /fly|flap|glide/i,
};

/** Words that make a clip a worse plain loop of its motion (transitions, turns, variants). */
const DETOURS: [RegExp, number][] = [
  [/(^|[^a-z])to([^a-z]|$)|[a-z]2[A-Z]|_to_|start|stop|end|begin|transition/i, 6],
  [/turn|_?(90|120|135|180)/i, 5],
  [/(^|[_ -])(l|r|lft|rgt|left|right|bank|fl|fr|bl|br)([_ -]|\d|$)|[a-z](L|R)\d*$/, 4],
  [/back|wound|injur|hit|death|dead|attack|alert|angry|sniff|graz|eat/i, 3],
  [/pose|_3f|additive|takeoff|retrieve|cue/i, 3],
  [/slow|fast|medium|_\d+$|\d$/i, 1],
];

/** A clip name, or a clip with what is known about it (single-frame poses and partial clips are skipped). */
export type ClipLike = string | { name: string; seconds?: number; tracks?: number };

/**
 * The clip that best plays a common motion, e.g. `pickLibraryClip(names, "walk")` -> "WalkFast_F" for the
 * wolf, "G0_Walk" for the horse, "walk" for the goat. It prefers plain forward loops over transitions,
 * turns and variants. Undefined when no clip fits. `clips` are the animal's clips
 * (`libraryAnimal(id).clips` from `@actors/animal/library`; `LibraryAnimal.clipFor` in `@actors/three` does this for you). A guess from the names: check it in the viewer.
 */
export function pickLibraryClip(clips: readonly ClipLike[], motion: LibraryMotion): string | undefined {
  const want = MOTIONS[motion];
  const list = clips.map((c) => (typeof c === "string" ? { name: c } : c));
  // Clips that animate only a few channels are partial (additive layers, face loops, broken exports).
  const most = Math.max(0, ...list.map((c) => c.tracks ?? 0));
  let best: string | undefined, bestScore = Infinity;
  for (const { name, seconds, tracks } of list) {
    if (seconds === 0 || (tracks !== undefined && tracks < 0.25 * most)) continue;
    if (!want.test(name)) continue;
    let score = name.length / 100;
    for (const [re, cost] of DETOURS) if (re.test(name) && !want.test(name.match(re)![0])) score += cost;
    if (/(^|[_ -])(f|fwd|forward)([_ -]|$)|_F$/i.test(name)) score -= 0.5;
    if (score < bestScore) (best = name), (bestScore = score);
  }
  return best;
}

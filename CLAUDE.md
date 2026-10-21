# Actors – notes for Claude

- npm workspaces monorepo, TypeScript, ESM. Inside the repo, packages export `src/index.ts` directly. Other projects install release tarballs built by `scripts/release/build.mjs` (dist JS + .d.ts); see docs/using-actors.md. Keep all package versions equal; bumping them makes CI publish a new GitHub release on main. Don't publish to the public npm registry without Arnd's OK.
- Keep `@actors/core` renderer-free (no `three`, no DOM). Renderer code goes in adapters (`packages/three`).
- Units: meters, +Y up, +Z forward (glTF). Bone rolls follow Blender's convention.
- Adult-only: never lower `ADULT_MIN_AGE` or ship baby/child-only targets.
- Don't copy MakeHuman/MPFB code (AGPL/GPL). Their CC0 *data* is fine; the importer pulls it into `.cache/`.
- Generated packs (`apps/viewer/public/packs/`) are git-ignored; regenerate with `npm run import:human`.
- Checks before pushing: `npm run typecheck && npm test`; for viewer changes also run the smoke test (`apps/viewer/scripts/smoke.mjs`) against `npm run dev` and look at the screenshots.
- If the importer runs while `vite` is serving, restart vite (it can lose the regenerated public files).
- Building or reshaping an animal: read docs/animal-modelling.md first (lessons and traps from the dog).

# Actors – notes for Claude

- npm workspaces monorepo, TypeScript, ESM. Packages export `src/index.ts` directly (no build step yet).
- Keep `@actors/core` renderer-free (no `three`, no DOM). Renderer code goes in adapters (`packages/three`).
- Units: meters, +Y up, +Z forward (glTF). Bone rolls follow Blender's convention.
- Adult-only: never lower `ADULT_MIN_AGE` or ship baby/child-only targets.
- Don't copy MakeHuman/MPFB code (AGPL/GPL). Their CC0 *data* is fine; the importer pulls it into `.cache/`.
- Generated packs (`apps/viewer/public/packs/`) are git-ignored; regenerate with `npm run import:human`.
- Checks before pushing: `npm run typecheck && npm test`; for viewer changes also run the smoke test (`apps/viewer/scripts/smoke.mjs`) against `npm run dev` and look at the screenshots.
- If the importer runs while `vite` is serving, restart vite (it can lose the regenerated public files).

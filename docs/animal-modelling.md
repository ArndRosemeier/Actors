# Modelling animals: lessons from the dog

How the dog in `tools/import-animals` was brought from a lumpy blob to something close to a reference photo of a Czechoslovakian Wolfdog. The architecture is in [architecture.md](architecture.md) (Animals section). This page covers what worked, what didn't, and the traps, so other animals can skip them.

## Workflow that works

1. **Start from one reference photo of one breed or species.** Arnd's feedback on the first dog was that a generic body with 14 breed presets looked worse than the low-poly assets. Focusing on a single photo fixed that. Generalise only after the base looks right.
2. **Measure the photo before modelling.** Put a 50 px grid over it and note the following in pixels:
   - ground line
   - withers or shoulder height
   - top line and under line
   - chest front and buttocks
   - joint heights: elbow, hock, stifle
   - head length and skull-to-muzzle ratio
   - ear height
   - tail reach

   Convert to metres using the shoulder height. Watch for perspective. A front-quarter photo foreshortens body length by about cos(yaw); far legs shift toward the head and look higher.
3. **Look at the coat zones as well as the shapes:**
   - saddle
   - light mask
   - underside
   - leg colour
   - collar stripes
4. **Iterate with side-by-side renders from the photo's camera angle,** not from a default orbit view. The scripts are in the scratch section below.
5. **Check every few steps with silhouettes of the SDF before a full import.** An import takes about 75 s; a sphere-traced side, top and front silhouette of `bodyDistance` takes about 10 s and catches most shape problems.
6. **After every import, restart vite.** Otherwise the regenerated files in `public/` can go missing.

## Rig and stance

- The Mesh2Motion fox rig's rest pose is a fox: low, horizontal neck and a straight tail out behind. **Re-pose the rig before building the body**:
  - `turnChain(rig, bone, axis, angle)` rotates a bone chain about the root bone's head and recomputes rolls.
  - `shiftChain(rig, bone, offset)` moves a chain.
  - Sign convention: rotating about +X by a negative angle lifts a forward-pointing bone and lowers a backward-pointing one.
- Clips are stored as world-space rotation deltas from the source rest pose. Re-posing the rest therefore keeps the animations, but large source motions can misbehave on the new stance. The fox's tail swing pushed a hanging tail between the hind legs, so `clips.ts` keeps only 30 % of the tail's motion relative to the hips (`TAIL_MOTION`).
- Legs must stand under the sides of the chest and hips. Leg bones close to the midline make the leg tops look tucked in from the front.
- Set the tail root below the croup's top line. Otherwise a tail capsule at the root makes the tail rise before it falls.

## Shape

- **Model the coat outline, not the skin.** The body surface is the visible outline minus the shell fur length (`FUR` in dog.ts). A thick coat's plush silhouette is shape, not fur.
- **Use lofts for the big masses.** `loft()` in sdf.ts sweeps superellipse sections along a smooth path. Each section can be deeper below the path than above it, which matches how a side profile is drawn (top line, under line, width).
  - Use lofts for the trunk, neck and skull.
  - Use ellipsoids and round cones for muscle masses, joints, paws, jaw and nose.
  - Smooth-unioned ellipsoids alone look like a balloon animal.
- **Draw the neck as straight lines.** Arnd noticed this at once: the photo has a straight crest and a straight throat line. Compute each neck section's `up` and `down` as its distance to those two lines. Otherwise you get a hump behind the skull and a bump at the throat.
- **Watch for blobs that poke through the top line.** A long thigh ellipsoid stuck above the croup made two bumps. The coat code then also coloured those bumps as "inner leg" (white).
- **Eyes:**
  - Sink them by about 0.7–0.8 of their radius.
  - Carve an almond lid opening (long axis about 1.35 R, height about 0.4 R, slanted).
  - Add a small brow ridge above.
  - Round sockets with half-exposed spheres read as bug eyes.
- **Ears:** a cupped cone (a flattened round cone with a smaller one carved from its front) reads better than a flat plate, and a broad base matters. Tilt the ear bones upright if the source rig leans them back.
- **Mouth:** the slit has to exist so the jaw can open. Make it thin, smooth it a little (the voxel grid makes it jagged), mark the lips black, and keep the fur short along the lips. Otherwise shells from above and below bristle across the line.
- **Proportions to check:**
  - chest depth around 45–50 % of shoulder height
  - body length versus height
  - skull-to-muzzle ratio
  - paw size (ours started as clown shoes)

## Meshing traps

- **Triangle winding:** Surface Nets produced inward-facing triangles. The importer oriented the normals by the SDF gradient but left the winding alone, so the renderer culled the outside and drew the inside of the far side. That alone made the first dog look wrong. `skinBody` now flips the indices whenever it flips the normals. If an animal looks "inside out", or the legs show their inner colour from outside, check this first.
- Taubin smoothing is switched off near carves, ears and the nose so they keep their shape. If a carve comes out jagged, allow a little smoothing near it.
- Lofts are the slowest primitive. The coarse-then-fine nearest-segment search keeps the import at about 75 s. Keep primitive bounds tight.

## Fur and coat

- **Shells must not sparkle.** Strands smaller than a pixel are averaged (`furMeanCover`, faded in by `fwidth`). The shells are alpha-blended from the inside out with depth writes off. Alpha-test shells gave salt-and-pepper noise.
- **Read fur as locks, not single hairs.** At viewing distance you see locks: noise stretched along the flow direction (`furStreak`). Use it for brightness, and for agouti (dark guard-hair tips that give a grizzled look).
- **Calibrate colours against the photo.** Under the stage lights and ACES, albedo renders roughly 1.4× brighter. Pick albedos at about 60–70 % of the photo's sRGB values, and desaturate greys more than you think.
- **Use soft edges for wild colouring.** The saddle edge widens with `agouti`. Hard marking edges look like a domestic piebald.
- **Add a per-vertex mask channel when a marking needs its own region.** The light mask needed one (`coatE`). The mask region from the dark-mask breeds included the eye surroundings and gave the wolf white goggles.
- **Region weights come from part membership.** If a big loft (e.g. the skull) covers a smaller tagged part (muzzle, nose), the small part loses its region. Lips and nose then turned grey. Either let the code accept the covering region or make the small part stick out.

## Tools

These scratch scripts are not committed. Copies are in the thread's scratchpad; recreate them as needed.

- `look.mjs`: Playwright plus SwiftShader. It loads `animals.html`, runs setup JS against `window.__actors` (`setBreed`, `play`, `pose`, `refresh`, `shells`), sets the camera and saves `stage.screenshot()`.
  - Wait for two `requestAnimationFrame`s before the screenshot.
  - Use the canvas, not Playwright element screenshots, which time out.
- `probe.mjs`: evaluates JS in the page to read per-vertex attributes (`coatA`..`coatE`, normals, `coatPos`). Quick for answering "why is this patch white".
- `slice.ts`: sphere-traces `bodyDistance` from the side, top and front into PGM images and overlays the bones and eye centres.
- `cmp.py`: puts the reference and the renders side by side at equal height.
- The photo-matching camera for the wolfdog was about `[-2.5, 0.5, 1.35] → [0, 0.45, 0.08]` (front-left quarter view).

## Lessons from the deer

The deer (`deer.ts`, `deercoat.ts`) followed the workflow above on a side photo of a sika hind, with Quaternius' CC0 low-poly Deer as the blueprint for rig, clips and proportions.

- **Check the blueprint against the photo first.** The low-poly deer's chest depth, head height and neck angle already matched the photo within a few percent, so its rig only needed scaling, raised ears and a hanging tail. Keeping the source proportions keeps the clips clean.
- **Read the source rig's weights, not just its hierarchy.** Quaternius' "IK" bones are the weighted pasterns and hooves, parented to the armature. Re-parented under the cannon bones (where the IK chain ends), they follow the legs in every clip. The unweighted root (`Body`) and the pole targets go.
- **Ellipsoid radii are (u, v, w) of the frame, and `frameFrom(axis)` puts the axis in w.** The long radius goes last. Getting this wrong turned the hams into lobes sticking out backwards.
- **Keep loft paths straight.** A path that follows (top + bottom) / 2 wiggles, and the nearest-section search then jumps on the concave side, leaving seams across the back. Use a straight (or gently inclined) path and put the profile into `up`/`down`. Keep every `down` positive: a path above the under line gives negative depths and a bulge.
- **Details smaller than the voxel size come out jagged.** A 2 mm lip groove at 3 mm cells looked like a torn slit. Draw such lines in the coat instead.
- **Coat colours mix in linear space,** so 30 % white over a dark chestnut looks almost white after tone mapping. The deer markings use `furMixP` (a mix in √ space) so amounts read as they should; dog-era amounts (belly, bib, pale mask) need low values on dark coats.
- **Pattern coordinates need care.** Distances to the nearest point of a spine polyline are constant in wedges around its ends and corners, which smeared spots into rings. Spots use z along the body and the in-plane distance to the spine line at the vertex's own z instead.
- **Flat loft end caps show.** End a loft in a small section buried under another part (the deer's trunk ends under the tail root).

## Applying this to other animals

- Mesh2Motion's rig and clips also fit cats and foxes. Re-pose the rig toward the species' natural stance (cats: lower head, tail up and curved; squirrels need a different rig).
- Keep the per-vertex coat channels generic (regions, back, underside, masks). Species-specific patterns (stripes, rosettes) can be shader functions driven by `coatPos` and the flow.
- Small animals need shorter fur and a finer strand spacing (`uFur.z`), or strands become blobs.
- Check every existing preset or animation after a stance change. A screenshot sheet from `apps/viewer/scripts/animals.mjs` is the quickest check.

# Drones

Futuristic drones generated from building blocks (`@actors/drone`, three.js adapter `ThreeDrone` in `@actors/three`, viewer page `drones.html`). They are not part of the character creator; they use their own small rigid rig instead of a skeleton.

```ts
import { designDrone, buildDrone, generateDrone } from "@actors/drone";
import { ThreeDrone } from "@actors/three";

const spec = designDrone({ seed: 42, archetype: "courier", palette: "medical" }); // plain JSON
const drone = new ThreeDrone(buildDrone(spec));
scene.add(drone.object);
drone.play("hover"); // call drone.update(dt) every frame
```

## How a drone is made

1. **`designDrone(config)`** picks every block from a seed. Each block has its own random stream (`Rng.fork`), so changing the palette, the role's tools or `armed` does not reshuffle the hull or the propulsion.
2. **`DroneSpec`** is the result: plain JSON with one hull and lists of blocks, each with its own numbers. Edit any block and rebuild; the viewer's "Copy spec JSON" gives you one to start from.
3. **`buildDrone(spec)`** turns a spec into nodes (a rigid hierarchy), meshes per node and material slot, glow points and baked clips. Parts are placed by casting rays at the hull, so every block fits every hull.

`config` options: `seed`, `archetype` (role), `hull`, `propulsion`, `count`, `palette` (key or full palette), `size` (meters), `detail`, `wear`, `tools` (default on) and `armed` (default **off**: weapons are optional).

## Blocks

| Block | Variants |
|---|---|
| Hull | pod (superellipsoid from boxy to faceted), wedge (lofted, drooping nose), disc (saucer), orb (core with armour shells and a band), frame (core box with cover and battery tray), manta (flying wing with a raised fuselage); options: canopy, spine, belt, armour plates, vents, greebles |
| Propulsion | ducted fans (duct, stators, hub, 3–9 blades), open rotors (coaxial, guards), tilting jet nacelles (intake fan, nozzle, plume), anti-grav rings (1–3 gyro rings plus a field beam), ion thrusters under the hull; layouts radial, lateral pairs, under; arms as struts, booms or wings; vectoring tilts the units in cruise; optional RCS jets |
| Sensors | eye (gimballed lens), camera turret, spinning lidar, scanner bar with a moving dot, radar dish, camera array |
| Tools | claws (two 3-joint arms with grippers), spotlight (beam), cargo crate on a winch, scanner ring with a beam, telescopic probe |
| Weapons (opt-in) | twin cannons with recoil, gatling, laser with charging coils, missile pods; muzzle flashes |
| Antennae, fins, gear | whip (blinking tip), blade, mast; tail fins, wings, canards; skids or folding legs |
| Lights | red/green position lights, tail light, strobes, underglow, glowing panel seams |
| Palettes | 12 schemes (corporate, military, patrol, stealth, industrial, medical, explorer, chrome, racing, desert, arctic, neon): plating colours, gloss, metalness, glow, glass and panel-line strength; `wear` adds grime |

Roles (`ARCHETYPES`: scout, courier, sentinel, surveyor, worker, interceptor, heavy lifter, manta) only weight these choices and set a size range; any block can still be combined with any other.

## Clips

Every clip loops over 4 s (whole numbers of rotor turns and sways): `hover`, `cruise` (pitch or vectored thrust, longer plumes, banking), `scan` (sensors and spotlight sweep), `land` (on its gear, rotors idling, beams off), `work` (with claws or cargo: arms reach and grip, the crate is lowered) and `attack` (armed only). Clips are node TRS tracks, so they play in an `AnimationMixer` and export to glTF; blinking lights use step interpolation.

## three.js adapter

`ThreeDrone` builds one material per slot from the palette: plating with procedural panel lines, per-panel tint, grime and optional glowing seams (shader patch on `MeshStandardMaterial`/`MeshPhysicalMaterial`, panel size scales with the drone), hazard stripes, emissive lenses and lights, additive plumes and beams, translucent rotor discs, and halo sprites on glow points. It takes the drone data structurally, so `@actors/three` does not depend on `@actors/drone`. WebGL only for now (no node materials for WebGPU).

## Why procedural

The CC0 sci-fi kits we know (Quaternius, Kenney) are fixed low-poly meshes with one look each; they cannot follow continuous parameters or be recombined part by part. Like the robots, drones are generated from our own primitives (rounded boxes, superellipsoids, lathes, lofts, plates).

## Screenshots

`node apps/viewer/scripts/drones.mjs [url] [outDir]` against `npm run dev` (gallery, armed gallery, two seeds per role, each clip; `SHOTS=gallery,role-scout` and `SEEDS=11,12` pick).

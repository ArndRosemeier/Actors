export * from "./spec";
export * from "./build";
export * from "./geom";
export { Rng, type V3, type Q4 } from "./math";

import { buildDrone, type DroneModel } from "./build";
import { type DroneConfig, designDrone } from "./spec";

/** Designs and builds a drone in one call: `generateDrone({ seed: 42, archetype: "courier" })`. */
export const generateDrone = (config: DroneConfig = {}): DroneModel => buildDrone(designDrone(config));

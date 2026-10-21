/**
 * Drone building blocks and the seeded designer that picks them.
 *
 * A drone is a `DroneSpec`: one hull plus lists of blocks (propulsion units,
 * sensors, tools, optional weapons, antennae, fins, gear, lights) and a
 * palette, each with its own numbers. `designDrone(config)` fills a spec from
 * a seed and a few high-level choices; `buildDrone(spec)` turns any spec into
 * meshes, nodes and clips. Specs are plain JSON, so a design can be saved,
 * edited block by block and rebuilt.
 */
import { Rng, clamp } from "./math";

export type RGB = [number, number, number];

export type HullKind = "pod" | "wedge" | "disc" | "orb" | "frame" | "manta";
export type PropKind = "ducted" | "rotor" | "jet" | "ring" | "ion";
export type SensorKind = "eye" | "turret" | "lidar" | "bar" | "dish" | "array";
export type ToolKind = "claws" | "spotlight" | "cargo" | "scanner" | "probe";
export type WeaponKind = "cannons" | "missiles" | "laser" | "gatling";
export type AntennaKind = "whip" | "blade" | "mast";
export type GearKind = "none" | "skids" | "legs";
export type ArchetypeId = "scout" | "courier" | "sentinel" | "surveyor" | "worker" | "interceptor" | "lifter" | "manta";

export interface HullSpec {
  kind: HullKind;
  /** Body length (Z), width (X) and height (Y) in units of the drone's size. */
  length: number;
  width: number;
  height: number;
  /** Superellipse exponent of the shell: 0.3 boxy, 1 round, 1.6 faceted. */
  roundness: number;
  /** Nose pointiness 0..1 (wedge, manta). */
  nose: number;
  /** Raised glass canopy / sensor dome. */
  canopy: boolean;
  /** Dorsal spine ridge. */
  spine: boolean;
  /** Contrasting belt around the body. */
  belt: boolean;
  /** Extra armour plates, vents and greebles, 0..1. */
  detail: number;
}

export interface PropSpec {
  kind: PropKind;
  count: number;
  /** "radial": around the body; "lateral": pairs left and right; "under": below the body. */
  layout: "radial" | "lateral" | "under";
  /** Radius of one unit (units of size). */
  radius: number;
  /** Extra distance between hull and unit. */
  reach: number;
  /** Mounting height relative to the hull centre (fraction of hull height). */
  lift: number;
  arm: "strut" | "boom" | "wing" | "none";
  /** Blades per rotor. */
  blades: number;
  /** Second, counter-rotating rotor (open rotors). */
  coaxial: boolean;
  /** Guard ring around open rotors. */
  guard: boolean;
  /** Units tilt with the flight direction. */
  vectoring: boolean;
}

export type Mount = "nose" | "top" | "belly" | "sides" | "rear";

export interface SensorSpec {
  kind: SensorKind;
  mount: Mount;
  size: number;
}
export interface ToolSpec {
  kind: ToolKind;
  mount: Mount;
  size: number;
}
export interface WeaponSpec {
  kind: WeaponKind;
  mount: Mount;
  size: number;
}
export interface AntennaSpec {
  kind: AntennaKind;
  count: number;
  size: number;
}
export interface FinSpec {
  /** Tail fins: 0 none, 1 single, 2 twin canted. */
  tail: number;
  wings: boolean;
  canards: boolean;
  span: number;
}
export interface LightSpec {
  /** Red/green position lights and a white tail light. */
  nav: boolean;
  /** Blinking anti-collision strobes. */
  strobe: boolean;
  /** Glowing disc under the body. */
  underglow: boolean;
  /** Glowing panel seams, 0..1. */
  seams: number;
}

export interface DronePalette {
  name: string;
  primary: RGB;
  secondary: RGB;
  accent: RGB;
  /** Mechanical parts (rotors, joints, nozzles). */
  metal: RGB;
  /** Emissive colour (lenses, thrusters, seams). */
  glow: RGB;
  glass: RGB;
  /** 0 matte .. 1 glossy. */
  gloss: number;
  /** Metalness of the main plating. */
  metallic: number;
  /** Strength of panel lines. */
  panels: number;
}

export interface DroneSpec {
  name: string;
  seed: number;
  archetype: ArchetypeId;
  /** Overall scale in meters (a 1-unit hull is `size` meters long). */
  size: number;
  hull: HullSpec;
  propulsion: PropSpec;
  /** Small manoeuvring jets. */
  rcs: boolean;
  sensors: SensorSpec[];
  tools: ToolSpec[];
  /** Empty unless the drone is armed (weapons are opt-in). */
  weapons: WeaponSpec[];
  antennae: AntennaSpec[];
  fins: FinSpec;
  gear: GearKind;
  lights: LightSpec;
  palette: DronePalette;
  /** Dirt and scuffs, 0..1. */
  wear: number;
}

export const PALETTES: Record<string, DronePalette> = {
  corporate: { name: "Corporate white", primary: [0.92, 0.93, 0.95], secondary: [0.18, 0.2, 0.24], accent: [0.1, 0.62, 0.9], metal: [0.32, 0.34, 0.38], glow: [0.3, 0.85, 1], glass: [0.05, 0.08, 0.12], gloss: 0.8, metallic: 0.05, panels: 0.6 },
  military: { name: "Military olive", primary: [0.33, 0.36, 0.27], secondary: [0.22, 0.23, 0.2], accent: [0.92, 0.55, 0.12], metal: [0.25, 0.25, 0.25], glow: [1, 0.35, 0.15], glass: [0.12, 0.1, 0.05], gloss: 0.25, metallic: 0.1, panels: 0.9 },
  police: { name: "Patrol", primary: [0.95, 0.96, 0.97], secondary: [0.06, 0.12, 0.3], accent: [0.15, 0.35, 0.95], metal: [0.2, 0.22, 0.26], glow: [0.35, 0.55, 1], glass: [0.04, 0.05, 0.1], gloss: 0.75, metallic: 0.05, panels: 0.6 },
  stealth: { name: "Stealth", primary: [0.09, 0.095, 0.1], secondary: [0.15, 0.16, 0.17], accent: [0.75, 0.08, 0.08], metal: [0.2, 0.2, 0.21], glow: [1, 0.12, 0.1], glass: [0.15, 0.02, 0.02], gloss: 0.35, metallic: 0.2, panels: 0.5 },
  industrial: { name: "Industrial", primary: [0.95, 0.68, 0.08], secondary: [0.12, 0.12, 0.13], accent: [0.1, 0.1, 0.1], metal: [0.45, 0.45, 0.47], glow: [1, 0.85, 0.5], glass: [0.08, 0.08, 0.08], gloss: 0.45, metallic: 0.05, panels: 1 },
  medical: { name: "Medical", primary: [0.96, 0.96, 0.95], secondary: [0.75, 0.78, 0.8], accent: [0.85, 0.1, 0.12], metal: [0.4, 0.42, 0.45], glow: [0.3, 1, 0.6], glass: [0.05, 0.1, 0.08], gloss: 0.85, metallic: 0.0, panels: 0.4 },
  explorer: { name: "Explorer", primary: [0.93, 0.92, 0.88], secondary: [0.92, 0.38, 0.08], accent: [0.15, 0.15, 0.17], metal: [0.6, 0.6, 0.6], glow: [1, 0.75, 0.35], glass: [0.12, 0.08, 0.02], gloss: 0.55, metallic: 0.05, panels: 0.8 },
  chrome: { name: "Chrome", primary: [0.82, 0.83, 0.86], secondary: [0.25, 0.22, 0.35], accent: [0.6, 0.3, 1], metal: [0.5, 0.5, 0.55], glow: [0.75, 0.4, 1], glass: [0.08, 0.04, 0.12], gloss: 0.9, metallic: 0.95, panels: 0.35 },
  racing: { name: "Racing", primary: [0.8, 0.06, 0.08], secondary: [0.08, 0.08, 0.09], accent: [1, 0.85, 0.1], metal: [0.3, 0.3, 0.32], glow: [1, 0.8, 0.2], glass: [0.06, 0.06, 0.06], gloss: 0.85, metallic: 0.3, panels: 0.5 },
  desert: { name: "Desert", primary: [0.76, 0.66, 0.5], secondary: [0.45, 0.38, 0.28], accent: [0.1, 0.55, 0.55], metal: [0.32, 0.3, 0.28], glow: [0.3, 1, 0.9], glass: [0.06, 0.1, 0.1], gloss: 0.3, metallic: 0.05, panels: 0.8 },
  arctic: { name: "Arctic", primary: [0.78, 0.84, 0.88], secondary: [0.35, 0.42, 0.5], accent: [0.95, 0.35, 0.1], metal: [0.35, 0.38, 0.42], glow: [0.5, 0.9, 1], glass: [0.05, 0.1, 0.15], gloss: 0.5, metallic: 0.1, panels: 0.7 },
  neon: { name: "Neon", primary: [0.12, 0.12, 0.16], secondary: [0.2, 0.2, 0.26], accent: [1, 0.1, 0.6], metal: [0.25, 0.25, 0.3], glow: [0.1, 1, 0.85], glass: [0.02, 0.06, 0.08], gloss: 0.7, metallic: 0.4, panels: 0.5 },
};

type W<K extends string> = Partial<Record<K, number>>;
interface Archetype {
  name: string;
  hull: W<HullKind>;
  prop: W<PropKind>;
  sensors: W<SensorKind>;
  tools: W<ToolKind | "none">;
  weapons: W<WeaponKind>;
  gear: W<GearKind>;
  size: [number, number];
  palettes: string[];
}

/** Roles: each one weights the blocks it tends to use. Any block can still be set by hand in the spec. */
export const ARCHETYPES: Record<ArchetypeId, Archetype> = {
  scout: { name: "Scout", hull: { pod: 3, wedge: 1, frame: 2 }, prop: { rotor: 3, ducted: 3 }, sensors: { turret: 3, eye: 1, array: 2, bar: 1 }, tools: { none: 3, spotlight: 1, probe: 1 }, weapons: { cannons: 2, laser: 1 }, gear: { skids: 2, legs: 1, none: 1 }, size: [0.45, 0.8], palettes: ["corporate", "police", "stealth", "racing", "arctic", "neon"] },
  courier: { name: "Courier", hull: { pod: 3, frame: 2 }, prop: { ducted: 3, rotor: 2 }, sensors: { turret: 2, array: 2, bar: 1 }, tools: { cargo: 6, spotlight: 1 }, weapons: { cannons: 1 }, gear: { legs: 2, skids: 2 }, size: [0.7, 1.2], palettes: ["corporate", "medical", "explorer", "industrial", "racing"] },
  sentinel: { name: "Sentinel", hull: { orb: 5, disc: 1, pod: 1 }, prop: { ring: 3, ion: 3 }, sensors: { eye: 6, bar: 2 }, tools: { none: 3, spotlight: 2, scanner: 1 }, weapons: { laser: 2, cannons: 1 }, gear: { none: 1 }, size: [0.5, 1], palettes: ["chrome", "stealth", "corporate", "neon", "police", "military"] },
  surveyor: { name: "Surveyor", hull: { disc: 3, pod: 2, orb: 1 }, prop: { ducted: 2, ring: 2, ion: 1 }, sensors: { dish: 3, lidar: 3, array: 2 }, tools: { scanner: 4, probe: 2, spotlight: 1 }, weapons: { laser: 1 }, gear: { legs: 2, none: 1 }, size: [0.8, 1.5], palettes: ["explorer", "arctic", "desert", "corporate", "chrome"] },
  worker: { name: "Worker", hull: { frame: 2, pod: 3 }, prop: { ducted: 4, rotor: 1 }, sensors: { array: 2, turret: 2, lidar: 1, eye: 1 }, tools: { claws: 6, spotlight: 2 }, weapons: { gatling: 1 }, gear: { legs: 3, skids: 1 }, size: [0.9, 1.5], palettes: ["industrial", "explorer", "desert", "arctic", "military"] },
  interceptor: { name: "Interceptor", hull: { wedge: 6, pod: 1 }, prop: { jet: 5, ducted: 1 }, sensors: { turret: 2, bar: 2, array: 1 }, tools: { none: 4, spotlight: 1 }, weapons: { cannons: 3, missiles: 3, laser: 1, gatling: 1 }, gear: { legs: 2, skids: 1 }, size: [1.2, 2.2], palettes: ["military", "stealth", "racing", "police", "arctic", "desert"] },
  lifter: { name: "Heavy lifter", hull: { frame: 3, pod: 2, wedge: 1 }, prop: { ducted: 4, rotor: 2, jet: 1 }, sensors: { array: 2, lidar: 2, turret: 1 }, tools: { cargo: 4, claws: 3 }, weapons: { gatling: 1, missiles: 1 }, gear: { legs: 3, skids: 2 }, size: [1.6, 2.8], palettes: ["industrial", "military", "explorer", "desert", "corporate"] },
  manta: { name: "Manta", hull: { manta: 6 }, prop: { ducted: 2, ion: 2, jet: 2 }, sensors: { bar: 3, turret: 2, eye: 1 }, tools: { none: 4, scanner: 1 }, weapons: { missiles: 2, laser: 2, cannons: 1 }, gear: { none: 2, skids: 1 }, size: [1.2, 2.4], palettes: ["stealth", "neon", "chrome", "military", "racing"] },
};

export interface DroneConfig {
  /** Same seed and choices, same drone. */
  seed?: number;
  archetype?: ArchetypeId | "random";
  hull?: HullKind | "auto";
  propulsion?: PropKind | "auto";
  /** Number of propulsion units ("auto" picks one that fits). */
  count?: number | "auto";
  /** A `PALETTES` key, "random", or a full palette. */
  palette?: string | DronePalette;
  /** Length in meters ("auto" from the archetype). */
  size?: number | "auto";
  /** Plates, vents and greebles 0..1 (default random). */
  detail?: number;
  wear?: number;
  /** Fit weapons (default false: weapons are optional). */
  armed?: boolean;
  /** Fit the archetype's tools (default true). */
  tools?: boolean;
}

const COUNTS: Record<PropKind, number[]> = { ducted: [2, 3, 4, 4, 4, 6, 6, 8], rotor: [3, 4, 4, 4, 6, 6, 8], jet: [2, 2, 2, 4], ring: [1, 1, 2, 3], ion: [3, 4, 4, 5, 6] };

/** Fills every block of a drone from a seed and a few choices. */
export function designDrone(config: DroneConfig = {}): DroneSpec {
  const seed = (config.seed ?? Math.floor(Math.random() * 2 ** 31)) >>> 0;
  const root = new Rng(seed);
  const arch: ArchetypeId = !config.archetype || config.archetype === "random" ? root.fork("archetype").pick(Object.keys(ARCHETYPES) as ArchetypeId[]) : config.archetype;
  const A = ARCHETYPES[arch];

  // Hull
  const rh = root.fork("hull");
  const kind: HullKind = config.hull && config.hull !== "auto" ? config.hull : rh.weighted(A.hull);
  const dims: Record<HullKind, () => [number, number, number]> = {
    pod: () => [1, rh.range(0.55, 0.9), rh.range(0.32, 0.55)],
    wedge: () => [1, rh.range(0.42, 0.62), rh.range(0.2, 0.3)],
    disc: () => {
      const d = rh.range(0.85, 1);
      return [d, d, rh.range(0.22, 0.34)];
    },
    orb: () => {
      const d = rh.range(0.7, 0.9);
      return [d, d, d * rh.range(0.92, 1.05)];
    },
    frame: () => [rh.range(0.55, 0.75), rh.range(0.45, 0.6), rh.range(0.22, 0.32)],
    manta: () => [1, rh.range(1.3, 1.8), rh.range(0.13, 0.2)],
  };
  const [length, width, height] = dims[kind]();
  const hull: HullSpec = {
    kind,
    length,
    width,
    height,
    roundness: kind === "orb" ? 1 : kind === "frame" ? rh.range(0.3, 0.5) : rh.pick([0.35, 0.5, 0.7, 1, 1.25]),
    nose: rh.range(0.2, 1),
    canopy: kind !== "orb" && rh.chance(kind === "wedge" || kind === "disc" ? 0.6 : 0.35),
    spine: (kind === "wedge" || kind === "pod" || kind === "manta") && rh.chance(0.45),
    belt: kind !== "manta" && rh.chance(0.5),
    detail: config.detail ?? rh.range(0.35, 1),
  };

  // Propulsion
  const rp = root.fork("propulsion");
  let pk: PropKind = config.propulsion && config.propulsion !== "auto" ? config.propulsion : rp.weighted(A.prop);
  let count = typeof config.count === "number" ? config.count : rp.pick(COUNTS[pk]);
  let layout: PropSpec["layout"] = "radial";
  if (pk === "jet") layout = "lateral";
  else if (pk === "ion") layout = "under";
  else if (pk === "ring") layout = "radial";
  else if ((kind === "wedge" || kind === "manta") && count % 2 === 0) layout = "lateral";
  else if (count === 2) layout = "lateral";
  if (layout === "lateral" && count % 2) count += 1;
  count = clamp(Math.round(count), 1, pk === "ring" ? 3 : 8);
  const big = count <= 2 ? 1.45 : count <= 4 ? 1 : count <= 6 ? 0.8 : 0.68;
  const propulsion: PropSpec = {
    kind: pk,
    count,
    layout,
    radius: pk === "ring" ? 1 : pk === "ion" ? rp.range(0.09, 0.13) : pk === "jet" ? rp.range(0.07, 0.09) * (count > 2 ? 0.85 : 1) : rp.range(0.2, 0.27) * big,
    reach: pk === "ion" || pk === "ring" ? 0 : rp.range(0.02, 0.22),
    lift: pk === "rotor" ? rp.range(0.2, 0.55) : rp.range(-0.15, 0.25),
    arm: pk === "ring" || pk === "ion" ? "none" : kind === "wedge" || kind === "manta" ? rp.pick(["wing", "wing", "strut"] as const) : rp.pick(["strut", "strut", "boom", "boom", "wing"] as const),
    blades: pk === "rotor" ? rp.int(2, 4) : rp.int(3, 9),
    coaxial: pk === "rotor" && rp.chance(0.3),
    guard: pk === "rotor" && rp.chance(0.5),
    vectoring: pk === "jet" || pk === "ion" || rp.chance(0.5),
  };
  pk = propulsion.kind;

  // Sensors: one main sensor plus extras.
  const rs = root.fork("sensors");
  const sensorMount: Record<SensorKind, Mount[]> = { eye: ["nose"], turret: ["belly", "nose"], lidar: ["top"], bar: ["nose"], dish: ["top"], array: ["nose", "belly"] };
  const sensors: SensorSpec[] = [];
  const main = rs.weighted(A.sensors);
  sensors.push({ kind: main, mount: rs.pick(sensorMount[main]), size: rs.range(0.8, 1.2) });
  const extras = rs.int(0, 2);
  for (let k = 0; k < extras; k++) {
    const s = rs.weighted({ lidar: 2, turret: 2, array: 1, dish: 1 } as W<SensorKind>);
    const mount = rs.pick(sensorMount[s]);
    if (sensors.some((o) => o.mount === mount)) continue;
    sensors.push({ kind: s, mount, size: rs.range(0.6, 1) });
  }

  // Tools
  const rt = root.fork("tools");
  const tools: ToolSpec[] = [];
  if (config.tools !== false) {
    const t = rt.weighted(A.tools);
    const toolMount: Record<ToolKind, Mount> = { claws: "belly", spotlight: sensors.some((s) => s.mount === "belly") ? "nose" : "belly", cargo: "belly", scanner: "belly", probe: "nose" };
    if (t !== "none") {
      const tk = t as ToolKind;
      // A nose tool would collide with a nose sensor: move it to the belly.
      const mount = toolMount[tk] === "nose" && sensors.some((s) => s.mount === "nose") ? "belly" : toolMount[tk];
      tools.push({ kind: tk, mount, size: rt.range(0.85, 1.15) });
    }
    if (rt.chance(0.25) && !tools.some((x) => x.kind === "spotlight") && !sensors.some((s) => s.mount === "belly") && !tools.some((x) => x.mount === "belly")) {
      tools.push({ kind: "spotlight", mount: "belly", size: rt.range(0.7, 1) });
    }
  }

  // Weapons: only when asked for.
  const rw = root.fork("weapons");
  const weapons: WeaponSpec[] = [];
  if (config.armed) {
    const w = rw.weighted(A.weapons);
    const winged = propulsion.arm === "wing" || kind === "manta" || kind === "wedge";
    const mount: Mount = w === "missiles" ? (winged ? "sides" : "sides") : sensors.some((s) => s.mount === "belly") || tools.some((x) => x.mount === "belly") ? "sides" : "belly";
    weapons.push({ kind: w, mount, size: rw.range(0.85, 1.2) });
    if (rw.chance(0.35)) {
      const w2 = rw.weighted({ missiles: 2, laser: 1 } as W<WeaponKind>);
      const m2: Mount = mount === "sides" ? "top" : "sides";
      if (w2 !== w) weapons.push({ kind: w2, mount: m2, size: rw.range(0.7, 1) });
    }
  }

  // Antennae, fins, gear, lights
  const ra = root.fork("antennae");
  const antennae: AntennaSpec[] = [];
  const nA = ra.int(0, 2);
  for (let k = 0; k < nA; k++) antennae.push({ kind: ra.pick(["whip", "whip", "blade", "mast"] as const), count: ra.int(1, 2), size: ra.range(0.7, 1.3) });
  const rf = root.fork("fins");
  const fins: FinSpec = {
    tail: kind === "wedge" ? rf.pick([1, 2, 2]) : kind === "pod" ? rf.pick([0, 0, 1, 2]) : kind === "manta" ? rf.pick([0, 2]) : 0,
    wings: kind === "wedge" ? propulsion.arm !== "wing" && rf.chance(0.6) : kind === "pod" ? rf.chance(0.2) : false,
    canards: kind === "wedge" && rf.chance(0.4),
    span: rf.range(0.8, 1.2),
  };
  const rg = root.fork("gear");
  const gear: GearKind = kind === "orb" || pk === "ring" ? "none" : rg.weighted(A.gear);
  const rl = root.fork("lights");
  const lights: LightSpec = { nav: rl.chance(0.8), strobe: rl.chance(0.6), underglow: rl.chance(kind === "orb" || kind === "disc" || pk === "ring" ? 0.8 : 0.3), seams: rl.chance(0.5) ? rl.range(0.3, 1) : 0 };

  // Palette and size
  const rc = root.fork("palette");
  const palette: DronePalette =
    typeof config.palette === "object" ? config.palette : config.palette && config.palette !== "random" && PALETTES[config.palette] ? PALETTES[config.palette] : PALETTES[rc.pick(A.palettes)];
  const size = typeof config.size === "number" ? config.size : root.fork("size").range(...A.size);
  const wear = config.wear ?? root.fork("wear").range(0, 0.6);

  return {
    name: `${A.name} ${arch.slice(0, 2).toUpperCase()}-${String(seed % 10000).padStart(4, "0")}`,
    seed,
    archetype: arch,
    size,
    hull,
    propulsion,
    rcs: root.fork("rcs").chance(pk === "ring" || pk === "ion" ? 0.3 : 0.55),
    sensors,
    tools,
    weapons,
    antennae,
    fins,
    gear,
    lights,
    palette: { ...palette },
    wear,
  };
}

import type { CharacterCatalog, Choice } from "./catalog";

/**
 * Theme tags: which settings an option fits. A game passes the themes it allows (`ThemeFilter`) and its
 * catalog keeps only what fits one of them; options without tags fit every setting (underwear, plain
 * socks, most hairstyles, humans).
 */
export const THEMES: (Choice & { description: string })[] = [
  { id: "modern", label: "Modern", description: "Today's clothes: jeans, T-shirts, suits, sneakers, glasses." },
  { id: "vintage", label: "Vintage", description: "The 1900s to 1950s: flapper dresses, fedoras, cloche hats." },
  { id: "future", label: "Future", description: "Clothes of 3026 and robots." },
  { id: "antique", label: "Antique", description: "Classical antiquity: draped gowns, tunics, crested helmets." },
  { id: "medieval", label: "Medieval", description: "Tunics, hose, gowns, mail and plate, hoods and boots." },
  { id: "nordic", label: "Nordic", description: "Norse tunics, trousers, fur boots and horned caps." },
  { id: "eastern", label: "Eastern", description: "Kimono, harem trousers and the like." },
  { id: "fantasy", label: "Fantasy", description: "Wizards, witches, elven gowns, fantastic helmets, races other than humans, skeletons." },
];

/**
 * Flags for things some games leave out whatever their themes, passed as `without`:
 * `real-faith` marks real-world religious symbols (a cross on a helmet, a Christmas hat).
 */
export const THEME_FLAGS: (Choice & { description: string })[] = [
  { id: "real-faith", label: "Real-world faith", description: "Shows a real-world religion's symbol." },
];

const tag = (themes: string, ids: string): Record<string, string[]> =>
  Object.fromEntries(ids.trim().split(/\s+/).map((id) => [id, themes.split(" ")]));

/** Theme tags of the pack's garments (absent: fits every setting). */
export const GARMENT_THEMES: Record<string, string[]> = {
  // Modern
  ...tag("modern", `tshirt longsleeve shorts jeans tucked-tshirt loose-tshirt fitted-tshirt polo tank-top camisole turtleneck-halter
    fishnet-stockings leg-warmers frill-socks lace-thong cargo-pants denim-shorts skirt-mini skirt-mini-2 skirt-tiered-mini tiered-dress
    keyhole-dress fluted-dress halter-midi halter-knee strapless-dress cut-out-dress shift-dress shirt-jeans striped-shirt-jeans jacket-jeans
    white-tee-jeans logo-longsleeve-jeans tee-jeans-fitted tee-denim-shorts blouse-pencil-skirt sportsuit worksuit suit-tie suit-double
    suit-dinner suit-female suit-female-2 suit-female-double elegant-male sneakers canvas-sneakers trainers leather-shoes black-shoes
    work-boots ankle-boots biker-boots overknee-boots motorcycle-helmet army-helmet sunglasses dark-glasses tinted-glasses mma-gloves face-mask`),
  ...tag("modern vintage", "stockings fisherman-sweater gown ballet-flats t-bar-shoes round-glasses gloves-long suit-3 suit-bowtie"),
  ...tag("modern real-faith", "santa-hat"),
  ...tag("modern fantasy", "bodice open-coat skirt-lace-ruffle"),
  ...tag("modern medieval", "wool-pants skirt-tiered"),
  ...tag("modern medieval fantasy", "skirt leather-boots"),
  ...tag("modern vintage medieval", "riding-boots"),
  // Vintage
  ...tag("vintage", "flapper-dress cloche-hat fedora fedora-tilted newsboy-cap"),
  ...tag("vintage fantasy", "ruffle-dress"),
  ...tag("vintage medieval", "buckled-shoes"),
  ...tag("vintage medieval fantasy", "wide-brim-hat"),
  // Future
  ...tag("future", `future-wrap future-trousers future-flares future-cocoon future-culottes future-screen-leggings future-shorts future-vest
    future-bolero future-sash future-mantle future-screen future-cuffs future-belt future-gaiters future-halo`),
  // Antique
  ...tag("antique", "corinthian-helmet"),
  ...tag("antique fantasy", "tunic goddess-dress draped-gown halter-gown ruffled-gown priestess-robe"),
  // Medieval
  ...tag("medieval fantasy", `med-tunic med-long-tunic med-hose med-gambeson med-hauberk med-coif med-surcoat med-tabard med-cuirass
    med-pauldrons med-vambraces med-greaves med-belt med-jerkin med-mantle medieval-dress long-gown square-neck-gown laced-chemise
    peasant-blouse embroidered-tunic gored-skirt medieval-boots cuffed-boots cuffed-knee-boots pirate-boots pointed-shoes monk-robe
    monk-hood hood-down veil leather-helmet gauntlet-gloves`),
  ...tag("medieval", "plague-mask"),
  ...tag("medieval real-faith", "knight-helmet"),
  ...tag("medieval eastern antique fantasy", "cloth-shoes"),
  // Nordic
  ...tag("nordic medieval fantasy", "viking-tunic viking-pants viking-boots"),
  ...tag("nordic fantasy", "horned-cap"),
  // Eastern
  ...tag("eastern", "kimono"),
  ...tag("eastern fantasy", "ninja harem-pants"),
  // Fantasy
  ...tag("fantasy", "wizard-robe wizard-hat witch-hat elven-gown dragon-helmet skull-helmet dark-horned-helmet"),
};

/** Theme tags of hairstyles (absent: fits every setting). */
export const HAIR_THEMES: Record<string, string[]> = {
  ...tag("modern", "hair-80s"),
  ...tag("modern vintage", "hair-bob-blunt hair-bob-blunt-bangs hair-bob-curled hair-bob-curled-bangs hair-bob-inverted hair-bob-inverted-bangs"),
  ...tag("vintage", "hair-updo-50s hair-finger-waves"),
  ...tag("fantasy", "leaves crest"),
};

/** Theme tags of races (humans fit every setting). */
export const RACE_THEMES: Record<string, string[]> = tag("fantasy", "elf dwarf orc halfling goblin sylvan drakeborn umbral giantkin");

/** Themes of robots and skeletons: a catalog keeps their options only for these. */
export const KIND_THEMES = { robot: ["future"], skeletal: ["fantasy"] };

/** Which options a game offers. */
export interface ThemeFilter {
  /** Themes the game allows (see `THEMES`); an option fits when it has none of its own or shares one. Absent: every theme. */
  themes?: string[];
  /** Tags left out whatever the themes (see `THEME_FLAGS`), e.g. `["real-faith"]`. */
  without?: string[];
}

/** Whether an option with these tags fits the filter. */
export function fitsThemes(tags: readonly string[] | undefined, filter: ThemeFilter): boolean {
  if (!tags?.length) return true;
  if (filter.without?.some((t) => tags.includes(t))) return false;
  const eras = tags.filter((t) => !THEME_FLAGS.some((f) => f.id === t));
  return !filter.themes || !eras.length || eras.some((t) => filter.themes!.includes(t));
}

/**
 * The catalog with only what fits `filter`: garments, hairstyles and races by their tags, outfit presets
 * whose garments all remain, and robots and skeletons only with their theme.
 */
export function filterCatalog(catalog: CharacterCatalog, filter: ThemeFilter): CharacterCatalog {
  const fits = (c: Choice) => fitsThemes(c.themes, filter);
  const garments = catalog.garments.filter(fits);
  const have = new Set(garments.map((g) => g.id));
  const outfits = catalog.outfits.filter((o) => o.garments.every((g) => have.has(g))).map((o) => (o.female ? { ...o, female: o.female.filter((g) => have.has(g)) } : o));
  const kind = (k: keyof typeof KIND_THEMES) => fitsThemes(KIND_THEMES[k], filter);
  return {
    ...catalog,
    races: catalog.races.filter(fits),
    garments,
    outfits,
    hair: catalog.hair.filter(fits),
    robot: kind("robot") ? catalog.robot : undefined,
    skeletal: kind("skeletal") ? catalog.skeletal : undefined,
  };
}

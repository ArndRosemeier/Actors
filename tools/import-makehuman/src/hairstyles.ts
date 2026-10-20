/**
 * Hairstyles from MakeHuman's community hair packs
 * (https://static.makehumancommunity.org/assets/assetpacks.html), on top of the
 * 9 system hairstyles. Each is a .mhclo proxy fitted to the body, stored in its
 * own data file and loaded the first time it is shown.
 *
 * Hair 01 is CC0. Hair 02 and Hair 03 are CC-BY: they may be redistributed,
 * but their authors must be credited (NOTICE-ASSETS.md, and the `credit` the
 * importer writes for each style).
 *
 * Left out on purpose: learning_anime_hair (46k vertices of anime spikes),
 * o4saken_curly01 (123k vertices), elvs_short_side_do (50k vertices) and
 * culturalibre_hair_11/12 (cartoon sculpts; 11 comes with a beard and brows).
 */

export interface Hairstyle {
  /** Mesh name (stable, used in saved characters). Must start with "hair-"; "short" in it marks styles men get when rolled. */
  name: string;
  /** Asset pack and the style's folder in it (`hair/<id>/<id>.mhclo`). */
  pack: "hair01" | "hair02" | "hair03";
  id: string;
  label: string;
  author: string;
  /** sRGB hex: recolour the texture at import (keeping its light/dark pattern), for styles shipped in fantasy colours. */
  tint?: string;
}

export const PACK_LICENCE: Record<Hairstyle["pack"], "cc0" | "ccby"> = { hair01: "cc0", hair02: "ccby", hair03: "ccby" };

export const HAIRSTYLES: Hairstyle[] = [
  // --- Hair 01 (CC0) ---
  { name: "hair-short-messy", pack: "hair01", id: "cortu_short_messy_hair", label: "Short, messy", author: "Cortu" },
  { name: "hair-shaggy", pack: "hair01", id: "cortu_shaggy_green_hair", label: "Shaggy, shoulder length", author: "Cortu", tint: "#4a3524" },
  { name: "hair-straight-bangs", pack: "hair01", id: "cortu_straight_bangs", label: "Straight with bangs", author: "Cortu", tint: "#1b1512" },
  { name: "hair-cloud", pack: "hair01", id: "cortu_strawberry_cloud_hair", label: "Curls, shoulder length", author: "Cortu", tint: "#9a6a4a" },
  { name: "hair-long-layered", pack: "hair01", id: "culturalibre_hair_01", label: "Long, layered", author: "culturalibre" },
  { name: "hair-short-swept", pack: "hair01", id: "culturalibre_hair_02", label: "Short, swept", author: "culturalibre" },
  { name: "hair-short-wavy", pack: "hair01", id: "culturalibre_hair_05", label: "Short, wavy", author: "culturalibre" },
  { name: "hair-short-curls", pack: "hair01", id: "culturalibre_hair_06", label: "Short, tousled curls", author: "culturalibre", tint: "#3b2a1e" },
  { name: "hair-double-braid", pack: "hair01", id: "elvs_double_mh_braid", label: "Double braids", author: "Elvaerwyn" },
  { name: "hair-french-braid", pack: "hair01", id: "elvs_french_braid_variation", label: "French braid", author: "Elvaerwyn" },
  { name: "hair-braid-bun", pack: "hair01", id: "elvs_reverse_french_braid_bun", label: "Braided bun", author: "Elvaerwyn", tint: "#3b2a1e" },
  { name: "hair-unkempt-braid", pack: "hair01", id: "elvs_unkempt_french_braid", label: "Loose braid", author: "Elvaerwyn" },
  { name: "hair-swept-back", pack: "hair01", id: "faydaen_hair_1", label: "Long, swept back", author: "Faydaen", tint: "#6b4a2b" },
  { name: "hair-bobcut", pack: "hair01", id: "littleright_bobcut_hair", label: "Bob cut", author: "littleright" },
  { name: "hair-long-shag", pack: "hair01", id: "o4saken_long01", label: "Long, layered shag", author: "punkduck" },
  { name: "hair-bun", pack: "hair01", id: "rehmanpolanski_hair_bun_brown", label: "Low bun", author: "RehmanPolanski" },
  { name: "hair-headband", pack: "hair01", id: "sonntag78_blond_with_headband", label: "Short, with headband", author: "sonntag78" },
  { name: "hair-jungle", pack: "hair01", id: "sonntag78_junglebook_hair", label: "Wild, shoulder length", author: "sonntag78" },
  { name: "hair-bob-blunt", pack: "hair01", id: "toigo_blunt_bob", label: "Blunt bob", author: "MargaretToigo" },
  { name: "hair-bob-blunt-bangs", pack: "hair01", id: "toigo_blunt_bob_with_bangs", label: "Blunt bob, bangs", author: "MargaretToigo" },
  { name: "hair-bob-curled", pack: "hair01", id: "toigo_curled_under_bob", label: "Curled-under bob", author: "MargaretToigo" },
  { name: "hair-bob-curled-bangs", pack: "hair01", id: "toigo_curled_under_bob_with_bangs", label: "Curled-under bob, bangs", author: "MargaretToigo" },
  { name: "hair-bob-inverted", pack: "hair01", id: "toigo_inverted_bob", label: "Inverted bob", author: "MargaretToigo" },
  { name: "hair-bob-inverted-bangs", pack: "hair01", id: "toigo_inverted_bob_with_bangs", label: "Inverted bob, bangs", author: "MargaretToigo" },

  // --- Hair 02 and Hair 03 (CC-BY: credit the author) ---
  { name: "hair-updo-50s", pack: "hair02", id: "elvs_50s_updo", label: "1950s updo", author: "Elvaerwyn" },
  { name: "hair-long-side-part", pack: "hair02", id: "elvs_adrienne_hair", label: "Long, side part", author: "Elvaerwyn" },
  { name: "hair-feathered", pack: "hair02", id: "elvs_ashley_may_hair", label: "Feathered, shoulder length", author: "Elvaerwyn" },
  { name: "hair-braid-bun-high", pack: "hair02", id: "elvs_braid_bun", label: "Braided high bun", author: "Elvaerwyn" },
  { name: "hair-cornrows", pack: "hair02", id: "elvs_braided_rows", label: "Cornrows", author: "Elvaerwyn" },
  { name: "hair-daisy", pack: "hair02", id: "elvs_daisy_hair", label: "Long, soft", author: "Elvaerwyn" },
  { name: "hair-short-grump", pack: "hair02", id: "elvs_grump_hair", label: "Short, combed", author: "Elvaerwyn" },
  { name: "hair-hazel", pack: "hair02", id: "elvs_hazel_hair", label: "Long, straight", author: "Elvaerwyn", tint: "#5a3a26" },
  { name: "hair-curly-shoulder", pack: "hair02", id: "elvs_inverted_curly_bob", label: "Curly, shoulder length", author: "Elvaerwyn" },
  { name: "hair-island", pack: "hair02", id: "elvs_island_princess_hair", label: "Long, half up", author: "Elvaerwyn" },
  { name: "hair-katherine", pack: "hair02", id: "elvs_katherine_hair", label: "Shoulder length, bangs", author: "Elvaerwyn", tint: "#7a5236" },
  { name: "hair-keylth", pack: "hair02", id: "elvs_keylth_hair", label: "Long, half ponytail", author: "Elvaerwyn" },
  { name: "hair-hippy", pack: "hair02", id: "elvs_lady_hippy_hair", label: "Long, side swept", author: "Elvaerwyn" },
  { name: "hair-lara", pack: "hair02", id: "elvs_lara_hair", label: "Long braid", author: "Elvaerwyn" },
  { name: "hair-short-maxwell", pack: "hair02", id: "elvs_maxwell_hair", label: "Short, spiky", author: "Elvaerwyn", tint: "#2a1d15" },
  { name: "hair-afro-puffs", pack: "hair02", id: "elvs_micky_afro", label: "Afro puffs", author: "Elvaerwyn" },
  { name: "hair-short-daisy", pack: "hair02", id: "elvs_short_daisy_hair", label: "Bob, side part", author: "Elvaerwyn" },
  { name: "hair-80s", pack: "hair02", id: "elvs_that_80s_babe_hair", label: "1980s volume", author: "Elvaerwyn" },
  { name: "hair-finger-waves", pack: "hair02", id: "elvs_wavy_bob", label: "1920s finger waves", author: "Elvaerwyn" },
  { name: "hair-bob-witchy", pack: "hair02", id: "elvs_witchy_lil_bob", label: "Bob, bangs", author: "Elvaerwyn" },
  { name: "hair-shag", pack: "hair03", id: "culturalibre_hair_13", label: "Shaggy, layered", author: "culturalibre" },
  { name: "hair-short-slick", pack: "hair03", id: "culturalibre_hair_14", label: "Short, slicked", author: "culturalibre" },
  { name: "hair-long-waves", pack: "hair03", id: "culturalibre_hair_17", label: "Long, waves", author: "culturalibre", tint: "#7a5236" },
  { name: "hair-bob-bangs", pack: "hair03", id: "culturalibre_hair_18", label: "Bob, full bangs", author: "culturalibre", tint: "#4a3122" },
  { name: "hair-wig-bow", pack: "hair03", id: "grinsegold_wig_bow_tie", label: "Wavy, with bow", author: "grinsegold" },
  { name: "hair-wig-bun-braids", pack: "hair03", id: "grinsegold_wig_bun_blonde_braids", label: "Bun with braids", author: "grinsegold", tint: "#c8a868" },
  { name: "hair-layered-side-bangs", pack: "hair03", id: "o4saken_chinesebob01", label: "Layered, side bangs", author: "punkduck" },
  { name: "hair-curly-long", pack: "hair03", id: "punkduck_alpha7_curly", label: "Long, curly", author: "punkduck" },
  { name: "hair-curly-wild", pack: "hair03", id: "punkduck_alpha7_curly2", label: "Long, wild curls", author: "punkduck" },
  { name: "hair-long-a7", pack: "hair03", id: "punkduck_alpha7_long", label: "Long, centre part", author: "punkduck" },
  { name: "hair-long-shaggy", pack: "hair03", id: "punkduck_alpha7_long2", label: "Long, shaggy", author: "punkduck" },
];

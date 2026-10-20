/**
 * The garment library imported from MakeHuman's asset packs
 * (https://static.makehumancommunity.org/assets/assetpacks.html). Most come
 * from CC0 packs (zip `<pack>_cc0.zip`); items marked `license: "CC-BY"` come
 * from CC-BY packs (`<pack>_cc-by.zip`). Characters that wear those must credit
 * the author; NOTICE-ASSETS.md lists them and the editor shows the credit.
 * The licence is the pack's: some .mhclo headers still carry MakeClothes'
 * boilerplate "AGPL3" line, in CC0 and CC-BY packs alike.
 *
 * Each garment is a .mhclo proxy fitted to the body, stored in its own data
 * file and loaded the first time it is worn, so the library can grow without
 * slowing down the first load.
 *
 * Left out on purpose: high-heeled shoes (they need a foot pose we don't
 * have yet, so toes poke through), Pantyhose 01 (doesn't fit the hm08 base),
 * the tube top (stray pieces), anything trademarked or religious.
 *
 * `occupies` names the body layers a garment takes; putting on a garment
 * takes off the others sharing a layer (a dress replaces top and bottom).
 */

export interface WardrobeItem {
  /** Mesh id in the pack (stable, used in saved characters). */
  name: string;
  /** Asset pack (zip `<pack>/<pack>_cc0.zip`, or `_cc-by.zip`) and the garment's folder in it. */
  pack: string;
  id: string;
  label: string;
  category: string;
  occupies: string[];
  gender?: "female" | "male";
  /** Skirt-like: hangs between the legs (see ProxyDef.legBlend). */
  skirt?: boolean;
  /** Hides the genital mesh while worn. */
  coversAnatomy?: boolean;
  /** Hides the hair while worn (closed helmets, hoods). */
  hidesHair?: boolean;
  /** How far from the garment the skin is hidden (meters); larger for shoes. */
  hideRadius?: number;
  /** Texture size (pixels). */
  texSize?: number;
  fabric?: "knit" | "denim" | "lace" | "smooth";
  /** CC-BY items must credit `author`; absent = CC0. */
  license?: "CC-BY";
  author?: string;
}

const SYS = "makehuman_system_assets";
const TOP = ["top"];
const BOTTOM = ["bottom"];
const FULL = ["top", "bottom"];
const SHOES = ["shoes"];

export const WARDROBE: WardrobeItem[] = [
  // --- Underwear ---
  { name: "panties", pack: "underwear01", id: "wolgade_female_panties_01", label: "Panties", category: "Underwear", occupies: ["briefs"], gender: "female", coversAnatomy: true, texSize: 512 },
  { name: "lace-thong", pack: "underwear01", id: "punkduck_strappy_lace_thong", label: "Lace thong", category: "Underwear", occupies: ["briefs"], gender: "female", coversAnatomy: true, texSize: 512, fabric: "lace" },
  { name: "underwear-top", pack: "underwear01", id: "wolgade_female_top_01", label: "Underwear top", category: "Underwear", occupies: ["bra"], gender: "female", texSize: 512 },

  // --- Socks and hosiery ---
  { name: "stockings", pack: "underwear01", id: "marco_105_stocking01", label: "Stockings", category: "Socks & hosiery", occupies: ["legwear"], gender: "female", texSize: 512 },
  { name: "fishnet-stockings", pack: "underwear01", id: "v0rt3x_stockings_black_fishnet_medium", label: "Fishnet stockings", category: "Socks & hosiery", occupies: ["legwear"], gender: "female", texSize: 512, fabric: "lace" },
  { name: "high-socks", pack: "underwear04", id: "joepal_crude_high_socks", label: "Knee socks", category: "Socks & hosiery", occupies: ["socks"], texSize: 512, hideRadius: 0.03 },
  { name: "low-socks", pack: "underwear04", id: "joepal_crude_low_socks", label: "Ankle socks", category: "Socks & hosiery", occupies: ["socks"], texSize: 512, hideRadius: 0.03 },
  { name: "leg-warmers", pack: "underwear04", id: "toigo_leg_warmer_socks", label: "Leg warmers", category: "Socks & hosiery", occupies: ["socks"], gender: "female", texSize: 512 },
  { name: "frill-socks", pack: "underwear04", id: "toigo_lace_frill_socks", label: "Frilled socks", category: "Socks & hosiery", occupies: ["socks"], gender: "female", texSize: 512, hideRadius: 0.03 },

  // --- Tops ---
  { name: "tucked-tshirt", pack: "shirts01", id: "toigo_basic_tucked_t-shirt", label: "Tucked T-shirt", category: "Tops", occupies: TOP, fabric: "knit" },
  { name: "loose-tshirt", pack: "shirts01", id: "elvs_crude_t-shirt_male", label: "Loose T-shirt", category: "Tops", occupies: TOP, gender: "male", fabric: "knit" },
  { name: "fitted-tshirt", pack: "shirts01", id: "joepal_crude_t-shirt_female", label: "Fitted T-shirt", category: "Tops", occupies: TOP, gender: "female", fabric: "knit" },
  { name: "polo", pack: "shirts01", id: "namuhekam_male_polo_shirt", label: "Polo shirt", category: "Tops", occupies: TOP, fabric: "knit" },
  { name: "fisherman-sweater", pack: "shirts01", id: "toigo_fisherman_sweater", label: "Knit sweater", category: "Tops", occupies: TOP, fabric: "knit" },
  { name: "tank-top", pack: "shirts01", id: "toigo_keyhole_tank_top", label: "Tank top", category: "Tops", occupies: TOP, gender: "female", fabric: "knit" },
  { name: "camisole", pack: "shirts01", id: "toigo_camisole_top", label: "Camisole", category: "Tops", occupies: TOP, gender: "female" },
  { name: "turtleneck-halter", pack: "shirts01", id: "toigo_turtleneck_halter_top", label: "Turtleneck halter", category: "Tops", occupies: TOP, gender: "female", fabric: "knit" },
  { name: "bodice", pack: "shirts01", id: "toigo_bodice-style_top", label: "Bodice top", category: "Tops", occupies: TOP, gender: "female" },
  { name: "viking-tunic", pack: "suits02", id: "rehmanpolanski_viking_tunic", label: "Viking tunic", category: "Tops", occupies: TOP, gender: "male" },

  // --- Bottoms ---
  { name: "wool-pants", pack: "pants01", id: "toigo_wool_pants", label: "Wool trousers", category: "Bottoms", occupies: BOTTOM, coversAnatomy: true },
  { name: "cargo-pants", pack: "pants01", id: "cortu_cargo_pants", label: "Cargo pants", category: "Bottoms", occupies: BOTTOM, coversAnatomy: true, fabric: "denim" },
  { name: "harem-pants", pack: "pants01", id: "toigo_harem_pants", label: "Harem pants", category: "Bottoms", occupies: BOTTOM, coversAnatomy: true },
  { name: "denim-shorts", pack: "pants01", id: "cortu_jeans_shorts", label: "Denim shorts", category: "Bottoms", occupies: BOTTOM, coversAnatomy: true, fabric: "denim" },
  { name: "viking-pants", pack: "suits02", id: "rehmanpolanski_viking_pants", label: "Viking trousers", category: "Bottoms", occupies: BOTTOM, gender: "male", coversAnatomy: true },
  { name: "skirt-lace-ruffle", pack: "skirts01", id: "toigo_skirt_with_lace_ruffle", label: "Lace ruffle skirt", category: "Bottoms", occupies: BOTTOM, gender: "female", skirt: true },
  { name: "skirt-tiered", pack: "skirts01", id: "toigo_tiered_skirt", label: "Tiered skirt", category: "Bottoms", occupies: BOTTOM, gender: "female", skirt: true },
  { name: "skirt-tiered-mini", pack: "skirts01", id: "toigo_tiered_mini_skirt", label: "Tiered mini skirt", category: "Bottoms", occupies: BOTTOM, gender: "female", skirt: true },
  { name: "skirt-mini-2", pack: "skirts01", id: "frankyaye_mini_skirt_02", label: "Mini skirt 2", category: "Bottoms", occupies: BOTTOM, gender: "female", skirt: true },

  // --- Dresses and robes ---
  { name: "gown", pack: "dress01", id: "toigo_camisole_dress_with_full_skirt", label: "Full-skirt gown", category: "Dresses & robes", occupies: FULL, gender: "female", skirt: true },
  { name: "keyhole-dress", pack: "dress01", id: "toigo_keyhole_neck_dress", label: "Keyhole dress", category: "Dresses & robes", occupies: FULL, gender: "female", skirt: true },
  { name: "ruffle-dress", pack: "dress01", id: "toigo_bodice_dress_with_lace_ruffle_skirt", label: "Bodice dress", category: "Dresses & robes", occupies: FULL, gender: "female", skirt: true },
  { name: "fluted-dress", pack: "dress01", id: "toigo_halter_dress_with_fluted_skirt", label: "Fluted halter dress", category: "Dresses & robes", occupies: FULL, gender: "female", skirt: true },
  { name: "halter-midi", pack: "dress01", id: "toigo_halter_dress_midi", label: "Halter midi dress", category: "Dresses & robes", occupies: FULL, gender: "female", skirt: true },
  { name: "halter-knee", pack: "dress01", id: "toigo_halter_dress_knee_length", label: "Halter dress, knee", category: "Dresses & robes", occupies: FULL, gender: "female", skirt: true },
  { name: "strapless-dress", pack: "dress01", id: "toigo_strapless_ruffle_top_dress", label: "Strapless dress", category: "Dresses & robes", occupies: FULL, gender: "female", skirt: true },
  { name: "tiered-dress", pack: "dress01", id: "toigo_dress_with_tiered_skirt", label: "Tiered dress", category: "Dresses & robes", occupies: FULL, gender: "female", skirt: true },
  { name: "shift-dress", pack: "dress01", id: "toigo_shift_dress", label: "Shift dress", category: "Dresses & robes", occupies: FULL, gender: "female", skirt: true },
  { name: "cut-out-dress", pack: "dress01", id: "toigo_cut_out_dress", label: "Cut-out dress", category: "Dresses & robes", occupies: FULL, gender: "female", skirt: true },
  { name: "flapper-dress", pack: "dress01", id: "aethelraed_flapper_dress", label: "Flapper dress", category: "Dresses & robes", occupies: FULL, gender: "female", skirt: true },
  { name: "kimono", pack: "dress01", id: "mindfront_kimono", label: "Kimono", category: "Dresses & robes", occupies: FULL, gender: "female", skirt: true },
  { name: "tunic", pack: "dress01", id: "wdg_mycenaean_tunic", label: "Antique tunic", category: "Dresses & robes", occupies: FULL, skirt: true },
  { name: "monk-robe", pack: "suits02", id: "donitz_monk_robe", label: "Monk robe", category: "Dresses & robes", occupies: FULL, skirt: true, coversAnatomy: true },
  { name: "wizard-robe", pack: "suits03", id: "maciekg_wizard_robe", label: "Wizard robe", category: "Dresses & robes", occupies: FULL, skirt: true, coversAnatomy: true, license: "CC-BY", author: "maciekg" },
  { name: "medieval-dress", pack: "dress03", id: "punkduck_medieval_dress", label: "Medieval dress", category: "Dresses & robes", occupies: FULL, gender: "female", skirt: true, coversAnatomy: true, license: "CC-BY", author: "punkduck" },
  { name: "goddess-dress", pack: "dress02", id: "elvs_goddess_dress1", label: "Goddess dress", category: "Dresses & robes", occupies: FULL, gender: "female", skirt: true, license: "CC-BY", author: "Elvaerwyn" },
  { name: "draped-gown", pack: "dress02", id: "elvs_goddess_dress3", label: "Draped gown", category: "Dresses & robes", occupies: FULL, gender: "female", skirt: true, license: "CC-BY", author: "Elvaerwyn" },
  { name: "halter-gown", pack: "dress02", id: "elvs_goddess_dress4", label: "Halter gown", category: "Dresses & robes", occupies: FULL, gender: "female", skirt: true, license: "CC-BY", author: "Elvaerwyn" },
  { name: "elven-gown", pack: "dress02", id: "elvs_goddess_dress5", label: "Elven gown", category: "Dresses & robes", occupies: FULL, gender: "female", skirt: true, license: "CC-BY", author: "Elvaerwyn" },
  { name: "priestess-robe", pack: "dress02", id: "elvs_goddess_dress6", label: "Priestess robe", category: "Dresses & robes", occupies: FULL, gender: "female", skirt: true, coversAnatomy: true, license: "CC-BY", author: "Elvaerwyn" },
  { name: "ruffled-gown", pack: "dress02", id: "elvs_goddess_dress8", label: "Ruffled gown", category: "Dresses & robes", occupies: FULL, gender: "female", skirt: true, license: "CC-BY", author: "Elvaerwyn" },

  // --- Complete outfits (top and bottom in one mesh) ---
  { name: "shirt-jeans", pack: SYS, id: "male_casualsuit01", label: "Shirt and jeans", category: "Outfits", occupies: FULL, gender: "male", coversAnatomy: true },
  { name: "striped-shirt-jeans", pack: SYS, id: "male_casualsuit03", label: "Striped shirt and jeans", category: "Outfits", occupies: FULL, gender: "male", coversAnatomy: true },
  { name: "jacket-jeans", pack: SYS, id: "male_casualsuit05", label: "Jacket and jeans", category: "Outfits", occupies: FULL, gender: "male", coversAnatomy: true },
  { name: "white-tee-jeans", pack: SYS, id: "male_casualsuit06", label: "White T-shirt and jeans", category: "Outfits", occupies: FULL, gender: "male", coversAnatomy: true },
  { name: "logo-longsleeve-jeans", pack: SYS, id: "male_casualsuit02", label: "Logo long-sleeve and jeans", category: "Outfits", occupies: FULL, gender: "male", coversAnatomy: true },
  { name: "tee-jeans-fitted", pack: SYS, id: "female_casualsuit01", label: "Fitted T-shirt and jeans", category: "Outfits", occupies: FULL, gender: "female", coversAnatomy: true },
  { name: "tee-denim-shorts", pack: SYS, id: "female_casualsuit02", label: "T-shirt and hot pants", category: "Outfits", occupies: FULL, gender: "female", coversAnatomy: true },
  { name: "blouse-pencil-skirt", pack: SYS, id: "female_elegantsuit01", label: "Blouse and pencil skirt", category: "Outfits", occupies: FULL, gender: "female", coversAnatomy: true },
  { name: "sportsuit", pack: SYS, id: "female_sportsuit01", label: "Crop top and leggings", category: "Outfits", occupies: FULL, gender: "female", coversAnatomy: true },
  { name: "worksuit", pack: SYS, id: "male_worksuit01", label: "Work overalls", category: "Outfits", occupies: FULL, coversAnatomy: true },
  { name: "ninja", pack: "suits03", id: "mindfront_f_ninja", label: "Ninja", category: "Outfits", occupies: [...FULL, "hat"], gender: "female", coversAnatomy: true, hidesHair: true, license: "CC-BY", author: "Mindfront" },

  // --- Suits ---
  { name: "suit-tie", pack: "suits01", id: "toigo_male_suit_tie_and_jacket", label: "Suit and tie", category: "Suits", occupies: FULL, gender: "male", coversAnatomy: true },
  { name: "suit-3", pack: "suits01", id: "toigo_male_suit_3", label: "Three-piece suit", category: "Suits", occupies: FULL, gender: "male", coversAnatomy: true },
  { name: "suit-double", pack: "suits01", id: "toigo_male_double-breasted_suit", label: "Double-breasted suit", category: "Suits", occupies: FULL, gender: "male", coversAnatomy: true },
  { name: "suit-dinner", pack: "suits01", id: "toigo_suit_with_dinner_jacket", label: "Dinner jacket", category: "Suits", occupies: FULL, gender: "male", coversAnatomy: true },
  { name: "suit-bowtie", pack: "suits01", id: "toigo_suit_with_jacket_and_bowtie", label: "Suit and bow tie", category: "Suits", occupies: FULL, gender: "male", coversAnatomy: true },
  { name: "elegant-male", pack: SYS, id: "male_elegantsuit01", label: "Black suit", category: "Suits", occupies: FULL, gender: "male", coversAnatomy: true },
  { name: "suit-female", pack: "suits01", id: "toigo_female_suit", label: "Pantsuit", category: "Suits", occupies: FULL, gender: "female", coversAnatomy: true },
  { name: "suit-female-2", pack: "suits01", id: "toigo_female_suit_2", label: "Skirt suit", category: "Suits", occupies: FULL, gender: "female", coversAnatomy: true },
  { name: "suit-female-double", pack: "suits01", id: "toigo_female_double-breasted_suit", label: "Double-breasted pantsuit", category: "Suits", occupies: FULL, gender: "female", coversAnatomy: true },

  // --- Shoes ---
  { name: "sneakers", pack: SYS, id: "shoes05", label: "Sneakers", category: "Shoes", occupies: SHOES, hideRadius: 0.03, texSize: 512 },
  { name: "canvas-sneakers", pack: SYS, id: "shoes06", label: "Canvas sneakers", category: "Shoes", occupies: SHOES, hideRadius: 0.03, texSize: 512 },
  { name: "trainers", pack: SYS, id: "shoes02", label: "Worn trainers", category: "Shoes", occupies: SHOES, hideRadius: 0.03, texSize: 512 },
  { name: "leather-shoes", pack: SYS, id: "shoes01", label: "Leather shoes", category: "Shoes", occupies: SHOES, hideRadius: 0.03, texSize: 512 },
  { name: "black-shoes", pack: SYS, id: "shoes04", label: "Black shoes", category: "Shoes", occupies: SHOES, hideRadius: 0.03, texSize: 512 },
  { name: "work-boots", pack: SYS, id: "shoes03", label: "Boots", category: "Shoes", occupies: SHOES, hideRadius: 0.03, texSize: 512 },
  { name: "cloth-shoes", pack: "shoes01", id: "toigo_mj_cloth_shoes", label: "Cloth shoes", category: "Shoes", occupies: SHOES, hideRadius: 0.03, texSize: 512 },
  { name: "ballet-flats", pack: "shoes01", id: "toigo_ballet_flats", label: "Ballet flats", category: "Shoes", occupies: SHOES, gender: "female", hideRadius: 0.03, texSize: 512 },
  { name: "t-bar-shoes", pack: "shoes01", id: "cortu_t-bar", label: "T-bar shoes", category: "Shoes", occupies: SHOES, gender: "female", hideRadius: 0.03, texSize: 512 },
  { name: "ankle-boots", pack: "shoes01", id: "toigo_ankle_boots_male", label: "Ankle boots", category: "Shoes", occupies: SHOES, hideRadius: 0.03, texSize: 512 },
  { name: "biker-boots", pack: "shoes01", id: "culturalibre_male_boots", label: "Biker boots", category: "Shoes", occupies: SHOES, hideRadius: 0.03, texSize: 512 },
  { name: "overknee-boots", pack: "shoes01", id: "cortu_floppy_overknee_shoes", label: "Over-knee boots", category: "Shoes", occupies: SHOES, gender: "female", hideRadius: 0.03, texSize: 512 },
  { name: "viking-boots", pack: "suits02", id: "rehmanpolanski_viking_boots", label: "Fur boots", category: "Shoes", occupies: SHOES, hideRadius: 0.03, texSize: 512 },
  { name: "pirate-boots", pack: "shoes01", id: "grinsegold_female_pirate_boots", label: "Cuffed riding boots", category: "Shoes", occupies: SHOES, gender: "female", hideRadius: 0.03, texSize: 512 },
  { name: "cuffed-knee-boots", pack: "shoes01", id: "culturalibre_hero_boots_1", label: "Cuffed knee boots", category: "Shoes", occupies: SHOES, hideRadius: 0.03, texSize: 512 },
  { name: "cuffed-boots", pack: "shoes01", id: "culturalibre_hero_boots_4", label: "Cuffed boots", category: "Shoes", occupies: SHOES, hideRadius: 0.03, texSize: 512 },

  // --- Hats, glasses, gloves, masks ---
  { name: "fedora", pack: SYS, id: "fedora01", label: "Fedora", category: "Accessories", occupies: ["hat"], texSize: 512 },
  { name: "fedora-tilted", pack: SYS, id: "fedora_cocked", label: "Fedora, tilted", category: "Accessories", occupies: ["hat"], texSize: 512 },
  { name: "newsboy-cap", pack: "hats01", id: "jujube_newsboy_cap", label: "Newsboy cap", category: "Accessories", occupies: ["hat"], texSize: 512 },
  { name: "cloche-hat", pack: "hats01", id: "aethelraed_unraed_cloche_hat", label: "Cloche hat", category: "Accessories", occupies: ["hat"], gender: "female", texSize: 512 },
  { name: "santa-hat", pack: "hats01", id: "joepal_xmas_cap", label: "Santa hat", category: "Accessories", occupies: ["hat"], texSize: 512 },
  { name: "motorcycle-helmet", pack: "hats02", id: "culturalibre_motorcycle_helmet", label: "Motorcycle helmet", category: "Accessories", occupies: ["hat"], hidesHair: true, texSize: 512 },
  { name: "army-helmet", pack: "hats02", id: "mrgreaterthan_m1_helmet", label: "Army helmet", category: "Accessories", occupies: ["hat"], texSize: 512 },
  { name: "corinthian-helmet", pack: "hats02", id: "grinsegold_corinthian_helmet", label: "Corinthian helmet", category: "Accessories", occupies: ["hat"], hidesHair: true, texSize: 512 },
  { name: "knight-helmet", pack: "hats02", id: "javherre_casco_caballero_templario_templar_knight_helmet", label: "Knight helmet", category: "Accessories", occupies: ["hat"], hidesHair: true, texSize: 512 },
  { name: "dragon-helmet", pack: "hats02", id: "culturalibre_warrior_helmet", label: "Dragon-scale helmet", category: "Accessories", occupies: ["hat"], hidesHair: true, texSize: 512 },
  { name: "skull-helmet", pack: "hats02", id: "culturalibre_skull_helmet", label: "Horned skull helmet", category: "Accessories", occupies: ["hat"], hidesHair: true, texSize: 512 },
  { name: "dark-horned-helmet", pack: "hats04", id: "culturalibre_warrior_helmet_02", label: "Dark horned helmet", category: "Accessories", occupies: ["hat"], hidesHair: true, texSize: 512, license: "CC-BY", author: "culturalibre" },
  { name: "horned-cap", pack: "hats04", id: "maciekg_horned_helmet", label: "Horned cap", category: "Accessories", occupies: ["hat"], hidesHair: true, texSize: 512, license: "CC-BY", author: "maciekg" },
  { name: "leather-helmet", pack: "hats04", id: "maciekg_leather_helmet", label: "Leather helmet", category: "Accessories", occupies: ["hat"], hidesHair: true, texSize: 512, license: "CC-BY", author: "maciekg" },
  { name: "wizard-hat", pack: "hats03", id: "maciekg_wizard_hat", label: "Wizard hat", category: "Accessories", occupies: ["hat"], hidesHair: true, texSize: 512, license: "CC-BY", author: "maciekg" },
  { name: "witch-hat", pack: "hats03", id: "elvs_witchy_hallows_hat1", label: "Witch hat", category: "Accessories", occupies: ["hat"], texSize: 512, license: "CC-BY", author: "Elvaerwyn" },
  { name: "wide-brim-hat", pack: "hats03", id: "culturalibre_cl_don_quixote_hat", label: "Wide-brim hat", category: "Accessories", occupies: ["hat"], texSize: 512, license: "CC-BY", author: "culturalibre" },
  { name: "sunglasses", pack: "glasses01", id: "kwnet_at_optical_glasses", label: "Sunglasses", category: "Accessories", occupies: ["glasses"], texSize: 512 },
  { name: "dark-glasses", pack: "glasses01", id: "frankyaye_glasses_library_male", label: "Dark glasses", category: "Accessories", occupies: ["glasses"], texSize: 512 },
  { name: "tinted-glasses", pack: "glasses01", id: "spamrakuen_sagerfrogs_glasses_01", label: "Tinted glasses", category: "Accessories", occupies: ["glasses"], texSize: 512 },
  { name: "round-glasses", pack: "glasses01", id: "toigo_round_glasses_leopard", label: "Round glasses", category: "Accessories", occupies: ["glasses"], texSize: 512 },
  { name: "gloves-short", pack: "gloves01", id: "toigo_gloves_short", label: "Gloves", category: "Accessories", occupies: ["gloves"], texSize: 512, hideRadius: 0.02 },
  { name: "gloves-medium", pack: "gloves01", id: "toigo_gloves_medium", label: "Gloves, mid-arm", category: "Accessories", occupies: ["gloves"], gender: "female", texSize: 512, hideRadius: 0.02 },
  { name: "gloves-long", pack: "gloves01", id: "toigo_gloves_long", label: "Opera gloves", category: "Accessories", occupies: ["gloves"], gender: "female", texSize: 512, hideRadius: 0.02 },
  { name: "mma-gloves", pack: "gloves01", id: "learning_mma_fighting_gloves", label: "Fighting gloves", category: "Accessories", occupies: ["gloves"], texSize: 512, hideRadius: 0.02 },
  { name: "gauntlet-gloves", pack: "gloves01", id: "culturalibre_hero-heroine_gloves_3", label: "Gauntlet gloves", category: "Accessories", occupies: ["gloves"], texSize: 512, hideRadius: 0.02 },
  { name: "monk-hood", pack: "suits02", id: "donitz_monk_robe_hood", label: "Hood", category: "Accessories", occupies: ["hat"], hidesHair: true, texSize: 512 },
  { name: "face-mask", pack: "masks01", id: "joepal_medical_mouth_protection", label: "Face mask", category: "Accessories", occupies: ["mask"], texSize: 512 },
];

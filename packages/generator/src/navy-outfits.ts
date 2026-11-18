import type { OutfitPreset } from "./catalog";

/** Colours of the two navies around 1800 (sRGB). */
const RN = { blue: "#1c2340", white: "#e9e4d6", gold: "#c9a24a", red: "#a8232b", facing: "#1d2a5a", black: "#18181b", jacket: "#26305a", duck: "#ddd6c3" };
const FR = { blue: "#1d2547", red: "#b02a2a", white: "#e9e4d6", gold: "#c9a24a", black: "#18181b", jacket: "#2a3566", cap: "#a52a2a" };

/** An officer's dress: shoes, stockings, breeches, waistcoat, a tailcoat with its facings and buttons, a stock and a hat. */
const officer = ["briefs", "high-socks", "buckled-shoes", "navy-breeches", "navy-waistcoat", "navy-tailcoat", "navy-lapels", "navy-collar", "navy-cuffs", "navy-buttons-officer", "navy-stock", "navy-bicorne", "navy-cockade"];
/** A marine's dress: coatee, collar and cuffs, cross belts, breeches and gaiters. */
const marine = ["briefs", "high-socks", "buckled-shoes", "navy-breeches", "navy-gaiters", "navy-coatee", "navy-collar", "navy-cuffs", "navy-buttons-single", "navy-crossbelts", "navy-stock"];

/**
 * Two navies around 1800, for the crews of a brig: the Royal Navy and the French Marine. Seamen wear
 * slops (no uniform yet) and go barefoot on deck; officers and marines wear their navy's uniform.
 */
export const NAVY_OUTFITS: OutfitPreset[] = [
  // Royal Navy
  {
    id: "navy-rn-captain", label: "Navy · British captain",
    description: "Royal Navy post captain, about 1800: blue tailcoat with white lapels and cuffs, gold epaulettes and buttons, white waistcoat and breeches, a laced bicorne worn athwartships.",
    garments: [...officer, "navy-epaulettes", "navy-bicorne-lace"], gender: "male",
    colors: { "navy-tailcoat": RN.blue, "navy-collar": RN.blue, "navy-lapels": RN.white, "navy-cuffs": RN.white, "navy-waistcoat": RN.white, "navy-breeches": RN.white, "high-socks": RN.white, "buckled-shoes": RN.black, "navy-stock": RN.white, "navy-bicorne": RN.black, "navy-cockade": RN.black },
  },
  {
    id: "navy-rn-lieutenant", label: "Navy · British lieutenant",
    description: "Royal Navy lieutenant: the blue coat with white lapels and cuffs, no epaulettes, a plain bicorne.",
    garments: officer, gender: "male",
    colors: { "navy-tailcoat": RN.blue, "navy-collar": RN.blue, "navy-lapels": RN.white, "navy-cuffs": RN.blue, "navy-waistcoat": RN.white, "navy-breeches": RN.white, "high-socks": RN.white, "buckled-shoes": RN.black, "navy-stock": RN.white },
  },
  {
    id: "navy-rn-midshipman", label: "Navy · British midshipman",
    description: "A young gentleman: blue coat with the white collar patches of his rank, round hat.",
    garments: ["briefs", "high-socks", "buckled-shoes", "navy-breeches", "navy-waistcoat", "navy-tailcoat", "navy-collar", "navy-buttons-single", "navy-stock", "navy-round-hat"], gender: "male",
    colors: { "navy-tailcoat": RN.blue, "navy-collar": RN.white, "navy-waistcoat": RN.white, "navy-breeches": RN.white, "high-socks": RN.white, "buckled-shoes": RN.black, "navy-stock": RN.black },
  },
  {
    id: "navy-rn-boatswain", label: "Navy · British boatswain",
    description: "A warrant officer in his own good clothes: blue jacket over a red waistcoat, white trousers, shoes, round hat.",
    garments: ["briefs", "navy-shirt", "navy-waistcoat", "navy-jacket", "navy-buttons-jacket", "navy-slops", "navy-neckerchief", "socks", "buckled-shoes", "navy-round-hat"], gender: "male",
    colors: { "navy-jacket": RN.jacket, "navy-waistcoat": RN.red, "navy-slops": RN.duck, "socks": RN.white, "buckled-shoes": RN.black },
  },
  {
    id: "navy-rn-seaman", label: "Navy · British seaman",
    description: "Slops from the purser: linen shirt, short blue jacket, wide duck trousers, black neckerchief, tarred round hat; barefoot on deck.",
    garments: ["briefs", "navy-shirt", "navy-jacket", "navy-buttons-jacket", "navy-slops", "navy-neckerchief", "navy-round-hat"], gender: "male",
    colors: { "navy-jacket": RN.jacket, "navy-slops": RN.duck, "navy-round-hat": RN.black },
  },
  {
    id: "navy-rn-hand", label: "Navy · British seaman at work",
    description: "Stripped for work at the guns or aloft: shirt, trousers and neckerchief, barefoot and bareheaded.",
    garments: ["briefs", "navy-shirt", "navy-slops", "navy-neckerchief"], gender: "male",
    colors: { "navy-slops": RN.duck },
  },
  {
    id: "navy-rn-marine", label: "Navy · Royal Marine",
    description: "Red coatee with the blue facings of the Royal Marines (1802), white cross belts and breeches, black gaiters and stock, round hat.",
    garments: [...marine, "navy-round-hat"], gender: "male",
    colors: { "navy-coatee": RN.red, "navy-collar": RN.facing, "navy-cuffs": RN.facing, "navy-crossbelts": RN.white, "navy-breeches": RN.white, "navy-gaiters": RN.black, "high-socks": RN.white, "buckled-shoes": RN.black, "navy-stock": RN.black },
  },
  // French Marine
  {
    id: "navy-fr-captain", label: "Navy · French captain",
    description: "Capitaine de vaisseau, about 1800: blue coat with scarlet cuffs and waistcoat, gold epaulettes, a laced bicorne with the tricolour cockade.",
    garments: [...officer.filter((g) => g !== "navy-cockade"), "navy-cockade-tricolour", "navy-epaulettes", "navy-bicorne-lace"], gender: "male",
    colors: { "navy-tailcoat": FR.blue, "navy-collar": FR.blue, "navy-lapels": FR.blue, "navy-cuffs": FR.red, "navy-waistcoat": FR.red, "navy-breeches": FR.blue, "high-socks": FR.white, "buckled-shoes": FR.black, "navy-stock": FR.black },
  },
  {
    id: "navy-fr-officer", label: "Navy · French officer",
    description: "Lieutenant de vaisseau: the blue coat with scarlet cuffs and waistcoat, one epaulette on the right shoulder.",
    garments: [...officer.filter((g) => g !== "navy-cockade"), "navy-cockade-tricolour", "navy-epaulette"], gender: "male",
    colors: { "navy-tailcoat": FR.blue, "navy-collar": FR.blue, "navy-lapels": FR.blue, "navy-cuffs": FR.red, "navy-waistcoat": FR.red, "navy-breeches": FR.blue, "high-socks": FR.white, "buckled-shoes": FR.black, "navy-stock": FR.black },
  },
  {
    id: "navy-fr-aspirant", label: "Navy · French aspirant",
    description: "A midshipman of the French Marine: blue coat with scarlet collar and cuffs, round hat.",
    garments: ["briefs", "high-socks", "buckled-shoes", "navy-breeches", "navy-waistcoat", "navy-tailcoat", "navy-collar", "navy-cuffs", "navy-buttons-single", "navy-stock", "navy-round-hat"], gender: "male",
    colors: { "navy-tailcoat": FR.blue, "navy-collar": FR.red, "navy-cuffs": FR.red, "navy-waistcoat": FR.white, "navy-breeches": FR.blue, "high-socks": FR.white, "buckled-shoes": FR.black, "navy-stock": FR.black },
  },
  {
    id: "navy-fr-boatswain", label: "Navy · French boatswain",
    description: "Maître d'équipage: blue jacket, red waistcoat, striped trousers, shoes and a round hat.",
    garments: ["briefs", "navy-shirt", "navy-waistcoat", "navy-jacket", "navy-buttons-jacket", "navy-slops-striped", "navy-neckerchief", "socks", "buckled-shoes", "navy-round-hat"], gender: "male",
    colors: { "navy-jacket": FR.jacket, "navy-waistcoat": FR.red, "socks": FR.white, "buckled-shoes": FR.black },
  },
  {
    id: "navy-fr-seaman", label: "Navy · French seaman",
    description: "Matelot: shirt, short blue jacket, red-and-white striped trousers, neckerchief and the red knitted bonnet; barefoot on deck.",
    garments: ["briefs", "navy-shirt", "navy-jacket", "navy-buttons-jacket", "navy-slops-striped", "navy-neckerchief", "navy-knit-cap"], gender: "male",
    colors: { "navy-jacket": FR.jacket, "navy-knit-cap": FR.cap },
  },
  {
    id: "navy-fr-hand", label: "Navy · French seaman at work",
    description: "Stripped for work: shirt, striped trousers, neckerchief and bonnet, barefoot.",
    garments: ["briefs", "navy-shirt", "navy-slops-striped", "navy-neckerchief", "navy-knit-cap"], gender: "male",
    colors: { "navy-knit-cap": FR.cap },
  },
  {
    id: "navy-fr-marine", label: "Navy · French marine",
    description: "Soldat of the marine infantry: blue coatee with scarlet collar and cuffs, white cross belts and breeches, black gaiters, a bicorne with the tricolour cockade.",
    garments: [...marine, "navy-bicorne", "navy-cockade-tricolour"], gender: "male",
    colors: { "navy-coatee": FR.blue, "navy-collar": FR.red, "navy-cuffs": FR.red, "navy-crossbelts": FR.white, "navy-breeches": FR.white, "navy-gaiters": FR.black, "high-socks": FR.white, "buckled-shoes": FR.black, "navy-stock": FR.black, "navy-bicorne": FR.black },
  },
];

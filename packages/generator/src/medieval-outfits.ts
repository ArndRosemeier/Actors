import type { OutfitPreset } from "./catalog";

/** Looks for a medieval setting: commoners, soldiers, knights, nobles and clergy. */
export const MEDIEVAL_OUTFITS: OutfitPreset[] = [
  {
    id: "med-peasant", label: "Medieval · Peasant",
    description: "Undyed linen tunic, wool hose and a plain belt: everyday wear for field and workshop.",
    garments: ["briefs", "med-tunic", "med-hose", "med-belt", "medieval-boots"],
    colors: { "med-tunic": "#b8a684", "med-hose": "#5a4a3a", "med-belt": "#4a3020" },
  },
  {
    id: "peasant", label: "Medieval · Peasant woman",
    description: "A laced chemise over a long gored skirt and sturdy boots.",
    garments: ["briefs", "laced-chemise", "gored-skirt", "med-belt", "medieval-boots"],
    gender: "female",
    colors: { "laced-chemise": "#e8e0cc", "gored-skirt": "#6b4a32", "med-belt": "#4a3020" },
  },
  {
    id: "med-traveller", label: "Medieval · Traveller",
    description: "Tunic and hose under a leather jerkin, with a hood and boots for the road.",
    garments: ["briefs", "med-tunic", "med-hose", "med-jerkin", "med-belt", "hood-down", "leather-boots"],
    female: ["bra"],
    colors: { "med-tunic": "#7a6a4c", "med-hose": "#3b3a33", "med-jerkin": "#5a3a22", "hood-down": "#3f4a2c" },
  },
  {
    id: "med-archer", label: "Medieval · Archer",
    description: "A quilted gambeson over tunic and hose, with a hood: the levy's armour.",
    garments: ["briefs", "med-tunic", "med-hose", "med-gambeson", "med-belt", "monk-hood", "medieval-boots"],
    female: ["bra"],
    colors: { "med-tunic": "#5f6838", "med-hose": "#4a3426", "med-gambeson": "#a89270", "monk-hood": "#2f3b26" },
  },
  {
    id: "med-man-at-arms", label: "Medieval · Man-at-arms",
    description: "Mail hauberk and coif over a gambeson, under a tabard in his lord's colours.",
    garments: ["briefs", "med-hose", "med-gambeson", "med-hauberk", "med-coif", "med-tabard", "med-belt", "gauntlet-gloves", "leather-boots"],
    female: ["bra"],
    colors: { "med-hose": "#3b3a33", "med-tabard": "#2c3f78", "gauntlet-gloves": "#4a3426" },
  },
  {
    id: "knight", label: "Medieval · Mail knight",
    description: "A crusade-era knight: mail from head to knee, a long surcoat, great helm and greaves.",
    garments: ["briefs", "med-hose", "med-gambeson", "med-hauberk", "med-coif", "med-surcoat", "med-belt", "med-greaves", "gauntlet-gloves", "leather-boots", "knight-helmet"],
    female: ["bra"],
    colors: { "med-hose": "#5a5048", "med-surcoat": "#f1efe9", "gauntlet-gloves": "#4a3426", "med-belt": "#3a2416" },
  },
  {
    id: "med-plate-knight", label: "Medieval · Plate knight",
    description: "Breastplate, pauldrons, vambraces and greaves over mail.",
    garments: ["briefs", "med-hose", "med-gambeson", "med-hauberk", "med-cuirass", "med-pauldrons", "med-vambraces", "med-greaves", "med-belt", "gauntlet-gloves", "leather-boots"],
    female: ["bra"],
    colors: { "med-hose": "#3b3a33", "gauntlet-gloves": "#3a3a3e" },
  },
  {
    id: "med-noble", label: "Medieval · Noble",
    description: "An embroidered tunic, fine hose, riding boots and a wool shoulder mantle.",
    garments: ["briefs", "embroidered-tunic", "med-hose", "med-belt", "med-mantle", "riding-boots"],
    gender: "male",
    colors: { "med-hose": "#1f2a44", "med-mantle": "#5e1a2b", "med-belt": "#3a2416" },
  },
  {
    id: "med-lady", label: "Medieval · Lady",
    description: "A long-sleeved gown with a shoulder mantle and pointed shoes.",
    garments: ["briefs", "long-gown", "med-mantle", "pointed-shoes"],
    gender: "female",
    colors: { "long-gown": "#2f6b45", "med-mantle": "#5d3b80", "pointed-shoes": "#3a2416" },
  },
  {
    id: "med-merchant", label: "Medieval · Merchant",
    description: "A long dyed tunic, belt and buckled shoes: comfortable wealth.",
    garments: ["briefs", "med-long-tunic", "med-belt", "buckled-shoes"],
    female: ["bra"],
    colors: { "med-long-tunic": "#3d5a80", "med-belt": "#4a3020" },
  },
  {
    id: "med-nun", label: "Medieval · Nun",
    description: "A plain dark gown and veil.",
    garments: ["briefs", "square-neck-gown", "veil", "pointed-shoes"],
    gender: "female",
    colors: { "square-neck-gown": "#1c1c1f", veil: "#1c1c1f", "pointed-shoes": "#1c1c1f" },
  },
  {
    id: "med-plague-doctor", label: "Medieval · Plague doctor",
    description: "Beaked mask, wide-brimmed hat, gloves and a long dark coat over a tunic.",
    garments: ["briefs", "med-long-tunic", "open-coat", "plague-mask", "wide-brim-hat", "gloves-short", "leather-boots"],
    female: ["bra"],
    colors: { "med-long-tunic": "#2a2a2e", "open-coat": "#1c1c1f", "wide-brim-hat": "#1c1c1f", "gloves-short": "#2a1d14" },
  },
];

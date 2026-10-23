import type { OutfitPreset } from "./catalog";

/** Everyday and expressive looks for a spacefaring post-scarcity society in 3026. */
export const FUTURE_OUTFITS: OutfitPreset[] = [
  {
    id: "future-comet", label: "3026 · Promenade / Comet trails",
    description: "Sculpted flares and a sleeveless arc vest for the long way around the ring habitat. A memory ribbon quietly carries a friend's colours; the silhouette does the rest.",
    garments: ["briefs", "future-vest", "future-flares", "future-sash", "sneakers"],
    colors: { "future-vest": "#f0d7a4", "future-flares": "#be8265", "future-sash": "#91e7df", sneakers: "#eadbc5" },
  },
  {
    id: "future-garden", label: "3026 · Quiet day / Garden commons",
    description: "Rounded cocoon pants, a soft wrap and a cropped bolero. Generous volume for an afternoon tending a communal garden, with no display required.",
    garments: ["briefs", "future-wrap", "future-cocoon", "future-bolero", "sneakers"],
    colors: { "future-wrap": "#e4d9c4", "future-cocoon": "#809b84", "future-bolero": "#b96f7c", sneakers: "#d4c5a8" },
  },
  {
    id: "future-courtyard", label: "3026 · Gathering / Open courtyard",
    description: "Wide cropped culottes, an arc vest and conversation cuffs. Familiar ease with floating proportions for a shared meal under an artificial sky.",
    garments: ["briefs", "future-vest", "future-culottes", "future-cuffs", "sneakers"],
    colors: { "future-vest": "#d7cf9c", "future-culottes": "#b7a2d6", "future-cuffs": "#f5c48e", sneakers: "#e6dcee" },
  },
  {
    id: "future-lightstream", label: "3026 · Night walk / Lightstream",
    description: "Moving light flows all the way down the legs. A quiet vest and two luminous orbits frame the display: wearable art for the habitat's long twilight.",
    garments: ["briefs", "future-vest", "future-screen-leggings", "future-halo", "future-sash", "sneakers"],
    colors: { "future-vest": "#44465e", "future-screen-leggings": "#96e2fb", "future-halo": "#f6a9cd", "future-sash": "#e3b9ff", sneakers: "#bbd1e3" },
  },
  {
    id: "future-drift", label: "3026 · Leisure / Drift afternoon",
    description: "Uneven, roomy shorts and an asymmetric wrap for a very ordinary afternoon a thousand years from now. Keepsakes matter more than scarcity.",
    garments: ["briefs", "future-wrap", "future-shorts", "future-belt", "future-cuffs", "sneakers"],
    colors: { "future-wrap": "#a4c8d6", "future-shorts": "#d5967e", "future-belt": "#b6a0ca", "future-cuffs": "#caf4d6", sneakers: "#e5d6c3" },
  },
  {
    id: "future-daily", label: "3026 · Everyday / Common ground",
    description: "A day between habitats: an asymmetric wrap, transit trousers and conversation cuffs. Repair marks and keepsakes carry personal history in a society where new things are easy to make.",
    garments: ["briefs", "future-wrap", "future-trousers", "future-cuffs", "future-belt", "future-gaiters", "sneakers"],
    colors: { "future-wrap": "#aec4ad", "future-trousers": "#303e54", "future-cuffs": "#a1eddd", "future-belt": "#bb8763", "future-gaiters": "#bccbc8", sneakers: "#d8ded4" },
  },
  {
    id: "future-orbit", label: "3026 · Habitat / Aurora commons",
    description: "An aurora mantle carries a slow-moving personal sky. Soft layers and an orbital halo turn an ordinary gathering aboard a habitat into a small celebration. Habitat wear; not a pressure suit.",
    garments: ["briefs", "future-wrap", "future-trousers", "future-mantle", "future-halo", "future-gaiters", "sneakers"],
    colors: { "future-wrap": "#ded4c3", "future-trousers": "#626282", "future-mantle": "#70d5e7", "future-halo": "#d5b6fa", "future-gaiters": "#b6c7df", sneakers: "#dcd8ed" },
  },
  {
    id: "future-festival", label: "3026 · Expression / Living constellation",
    description: "Clothes as an exhibition: a living canvas, luminous cuffs and two intersecting orbits. The wearer shares moving colour rather than status or rank; the display is a choice, not an obligation.",
    garments: ["briefs", "future-screen", "future-trousers", "future-cuffs", "future-halo", "future-belt", "sneakers"],
    colors: { "future-screen": "#e8a3f3", "future-trousers": "#403359", "future-cuffs": "#9ff1dc", "future-halo": "#f6ca8c", "future-belt": "#a28ad1", sneakers: "#e2c6e8" },
  },
];

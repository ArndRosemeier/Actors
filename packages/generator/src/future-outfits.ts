import type { OutfitPreset } from "./catalog";

/** First capsule for an expressive, spacefaring post-scarcity society in 3026. */
export const FUTURE_OUTFITS: OutfitPreset[] = [
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

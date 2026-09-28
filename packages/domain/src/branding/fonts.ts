/**
 * Curated Google Fonts catalog self-hosted from R2 per PLAN §8.1.
 * Storefront visitors never load any fonts from third-party Google CDNs.
 */

export type FontCategory = "sans-serif" | "serif" | "display" | "handwriting";

export interface CuratedFont {
  id: string;
  name: string;
  category: FontCategory;
  weights: number[];
  supportsDevanagari: boolean;
  r2Path: string;
}

export const CURATED_FONTS: CuratedFont[] = [
  // Sans-Serif Fonts
  {
    id: "inter",
    name: "Inter",
    category: "sans-serif",
    weights: [300, 400, 500, 600, 700],
    supportsDevanagari: false,
    r2Path: "/fonts/inter/",
  },
  {
    id: "roboto",
    name: "Roboto",
    category: "sans-serif",
    weights: [300, 400, 500, 700],
    supportsDevanagari: false,
    r2Path: "/fonts/roboto/",
  },
  {
    id: "open-sans",
    name: "Open Sans",
    category: "sans-serif",
    weights: [300, 400, 600, 700],
    supportsDevanagari: false,
    r2Path: "/fonts/open-sans/",
  },
  {
    id: "lato",
    name: "Lato",
    category: "sans-serif",
    weights: [300, 400, 700],
    supportsDevanagari: false,
    r2Path: "/fonts/lato/",
  },
  {
    id: "montserrat",
    name: "Montserrat",
    category: "sans-serif",
    weights: [400, 500, 600, 700, 800],
    supportsDevanagari: false,
    r2Path: "/fonts/montserrat/",
  },
  {
    id: "poppins",
    name: "Poppins",
    category: "sans-serif",
    weights: [300, 400, 500, 600, 700],
    supportsDevanagari: true,
    r2Path: "/fonts/poppins/",
  },
  {
    id: "raleway",
    name: "Raleway",
    category: "sans-serif",
    weights: [300, 400, 500, 600, 700],
    supportsDevanagari: false,
    r2Path: "/fonts/raleway/",
  },
  {
    id: "nunito",
    name: "Nunito",
    category: "sans-serif",
    weights: [300, 400, 600, 700, 800],
    supportsDevanagari: false,
    r2Path: "/fonts/nunito/",
  },
  {
    id: "rubik",
    name: "Rubik",
    category: "sans-serif",
    weights: [300, 400, 500, 600, 700],
    supportsDevanagari: false,
    r2Path: "/fonts/rubik/",
  },
  {
    id: "work-sans",
    name: "Work Sans",
    category: "sans-serif",
    weights: [300, 400, 500, 600, 700],
    supportsDevanagari: false,
    r2Path: "/fonts/work-sans/",
  },
  {
    id: "plus-jakarta-sans",
    name: "Plus Jakarta Sans",
    category: "sans-serif",
    weights: [400, 500, 600, 700],
    supportsDevanagari: false,
    r2Path: "/fonts/plus-jakarta-sans/",
  },
  {
    id: "dm-sans",
    name: "DM Sans",
    category: "sans-serif",
    weights: [400, 500, 700],
    supportsDevanagari: false,
    r2Path: "/fonts/dm-sans/",
  },
  {
    id: "manrope",
    name: "Manrope",
    category: "sans-serif",
    weights: [400, 500, 600, 700],
    supportsDevanagari: false,
    r2Path: "/fonts/manrope/",
  },
  // Devanagari-Capable Sans-Serif
  {
    id: "mukta",
    name: "Mukta",
    category: "sans-serif",
    weights: [300, 400, 500, 600, 700],
    supportsDevanagari: true,
    r2Path: "/fonts/mukta/",
  },
  {
    id: "noto-sans-devanagari",
    name: "Noto Sans Devanagari",
    category: "sans-serif",
    weights: [400, 500, 600, 700],
    supportsDevanagari: true,
    r2Path: "/fonts/noto-sans-devanagari/",
  },
  {
    id: "hind",
    name: "Hind",
    category: "sans-serif",
    weights: [300, 400, 500, 600, 700],
    supportsDevanagari: true,
    r2Path: "/fonts/hind/",
  },
  {
    id: "ek-mukta",
    name: "Ek Mukta",
    category: "sans-serif",
    weights: [300, 400, 500, 600, 700],
    supportsDevanagari: true,
    r2Path: "/fonts/ek-mukta/",
  },

  // Serif Fonts
  {
    id: "merriweather",
    name: "Merriweather",
    category: "serif",
    weights: [300, 400, 700],
    supportsDevanagari: false,
    r2Path: "/fonts/merriweather/",
  },
  {
    id: "playfair-display",
    name: "Playfair Display",
    category: "serif",
    weights: [400, 500, 600, 700, 800],
    supportsDevanagari: false,
    r2Path: "/fonts/playfair-display/",
  },
  {
    id: "lora",
    name: "Lora",
    category: "serif",
    weights: [400, 500, 600, 700],
    supportsDevanagari: false,
    r2Path: "/fonts/lora/",
  },
  {
    id: "pt-serif",
    name: "PT Serif",
    category: "serif",
    weights: [400, 700],
    supportsDevanagari: false,
    r2Path: "/fonts/pt-serif/",
  },
  {
    id: "eb-garamond",
    name: "EB Garamond",
    category: "serif",
    weights: [400, 500, 600, 700],
    supportsDevanagari: false,
    r2Path: "/fonts/eb-garamond/",
  },
  {
    id: "cormorant-garamond",
    name: "Cormorant Garamond",
    category: "serif",
    weights: [400, 500, 600, 700],
    supportsDevanagari: false,
    r2Path: "/fonts/cormorant-garamond/",
  },
  {
    id: "cinzel",
    name: "Cinzel",
    category: "serif",
    weights: [400, 600, 700],
    supportsDevanagari: false,
    r2Path: "/fonts/cinzel/",
  },
  {
    id: "bodoni-moda",
    name: "Bodoni Moda",
    category: "serif",
    weights: [400, 600, 700],
    supportsDevanagari: false,
    r2Path: "/fonts/bodoni-moda/",
  },
  // Devanagari-Capable Serif & Display
  {
    id: "rozha-one",
    name: "Rozha One",
    category: "serif",
    weights: [400],
    supportsDevanagari: true,
    r2Path: "/fonts/rozha-one/",
  },
  {
    id: "tiro-devanagari-hindi",
    name: "Tiro Devanagari Hindi",
    category: "serif",
    weights: [400],
    supportsDevanagari: true,
    r2Path: "/fonts/tiro-devanagari-hindi/",
  },

  // Display / Handwriting Fonts
  {
    id: "oswald",
    name: "Oswald",
    category: "display",
    weights: [400, 500, 600, 700],
    supportsDevanagari: false,
    r2Path: "/fonts/oswald/",
  },
  {
    id: "bebas-neue",
    name: "Bebas Neue",
    category: "display",
    weights: [400],
    supportsDevanagari: false,
    r2Path: "/fonts/bebas-neue/",
  },
  {
    id: "syne",
    name: "Syne",
    category: "display",
    weights: [400, 600, 700, 800],
    supportsDevanagari: false,
    r2Path: "/fonts/syne/",
  },
  {
    id: "kalam",
    name: "Kalam",
    category: "handwriting",
    weights: [300, 400, 700],
    supportsDevanagari: true,
    r2Path: "/fonts/kalam/",
  },
  {
    id: "yatra-one",
    name: "Yatra One",
    category: "display",
    weights: [400],
    supportsDevanagari: true,
    r2Path: "/fonts/yatra-one/",
  },
];

export function getCuratedFont(id: string): CuratedFont | undefined {
  return CURATED_FONTS.find((f) => f.id === id);
}

export function getDevanagariFonts(): CuratedFont[] {
  return CURATED_FONTS.filter((f) => f.supportsDevanagari);
}

export function getFontsByCategory(category: FontCategory): CuratedFont[] {
  return CURATED_FONTS.filter((f) => f.category === category);
}

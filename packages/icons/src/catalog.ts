// Heavy half of @bs/icons for the editor's icon picker. Load it with `await import("@bs/icons/catalog")` only when
// the picker opens, so the SVG table stays out of the editor's first load.
export { LUCIDE_DATA as ICON_DATA, type IconNode } from "./generated/data.ts";
import { LUCIDE_NAMES } from "./generated/names.ts";

/** Words that people type for an icon but that are not in its Lucide name (lowercase). */
const SYNONYMS: Readonly<Record<string, string>> = {
  delivery: "truck",
  shipping: "truck",
  return: "rotate-ccw",
  returns: "rotate-ccw",
  secure: "shield-check",
  security: "shield-check",
  support: "headphones",
  cart: "shopping-cart",
  bag: "shopping-bag",
  organic: "leaf",
  natural: "leaf",
  quality: "award",
  warranty: "badge-check",
  cod: "banknote",
  payment: "credit-card",
  whatsapp: "message-circle",
  call: "phone",
  email: "mail",
  location: "map-pin",
  discount: "percent",
  offer: "tag",
  fast: "zap",
};

/** Ranks names against a query: exact, then prefix, then substring, plus synonym hits. Empty query returns everything. */
export function searchIcons(query: string, limit = 400): string[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, "-");
  if (!q) return LUCIDE_NAMES.slice(0, limit);
  const hit = SYNONYMS[q];
  const exact: string[] = [];
  const prefix: string[] = [];
  const contains: string[] = [];
  for (const n of LUCIDE_NAMES) {
    if (n === q || n === hit) exact.push(n);
    else if (n.startsWith(q)) prefix.push(n);
    else if (n.includes(q)) contains.push(n);
  }
  return [...exact, ...prefix, ...contains].slice(0, limit);
}

/** Browsing groups for the picker. Lucide's own categories are not in the npm package, so these match on name words. */
export const ICON_CATEGORIES: ReadonlyArray<{ id: string; label: string; words: readonly string[] }> = [
  { id: "store", label: "Store", words: ["shopping", "store", "tag", "tags", "truck", "package", "box", "boxes", "gift", "credit", "wallet", "banknote", "coins", "receipt", "percent", "badge", "award", "ticket", "barcode", "qr", "handshake", "warehouse", "container", "ruler", "scale", "shirt", "gem", "crown", "diamond", "trophy", "medal"] },
  { id: "trust", label: "Trust", words: ["shield", "lock", "unlock", "key", "fingerprint", "verified", "check", "circle-check", "thumbs", "heart", "star", "sparkles", "headphones", "rotate", "undo", "refresh", "life", "clock", "timer", "zap"] },
  { id: "contact", label: "Contact", words: ["phone", "mail", "message", "messages", "map", "pin", "send", "inbox", "at", "contact", "smartphone", "megaphone", "bell", "globe", "link", "share", "rss"] },
  { id: "arrows", label: "Arrows", words: ["arrow", "arrows", "chevron", "chevrons", "move", "corner", "undo", "redo", "expand", "shrink", "maximize", "minimize"] },
  { id: "nature", label: "Nature", words: ["leaf", "tree", "trees", "flower", "sprout", "sun", "moon", "cloud", "droplet", "droplets", "wind", "snowflake", "flame", "mountain", "waves", "bird", "fish", "bug", "paw", "rabbit", "cat", "dog", "bone"] },
  { id: "food", label: "Food", words: ["coffee", "cup", "utensils", "pizza", "cake", "cookie", "apple", "cherry", "citrus", "grape", "wine", "beer", "milk", "egg", "carrot", "salad", "sandwich", "soup", "croissant", "ice", "candy", "popcorn", "cooking", "chef", "beef", "drumstick", "banana", "bean", "wheat"] },
  { id: "people", label: "People", words: ["user", "users", "baby", "smile", "frown", "meh", "angry", "laugh", "accessibility", "hand", "contact", "person", "family"] },
  { id: "devices", label: "Devices", words: ["laptop", "monitor", "tablet", "tv", "camera", "video", "mic", "speaker", "printer", "keyboard", "mouse", "watch", "battery", "wifi", "bluetooth", "cpu", "server", "database", "code", "terminal"] },
];

/** Icon names in a category (all names when the id is unknown). A name belongs if any of its words, or the whole name, is listed. */
export function iconsInCategory(id: string, names: readonly string[]): string[] {
  const cat = ICON_CATEGORIES.find((c) => c.id === id);
  if (!cat) return [...names];
  const words = new Set(cat.words);
  return names.filter((n) => words.has(n) || n.split("-").some((w) => words.has(w)));
}

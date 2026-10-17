import { randomUUID } from "node:crypto";

/** Menu item as stored in `menus.items` (the shape the admin editor and the MenuItem contract expect). */
export interface StoredMenuItem {
  id: string;
  title: string;
  url: string;
  type: string;
  children?: StoredMenuItem[];
  [key: string]: unknown;
}

/** Starter items for a new store's Main menu (handle "header"). Every item carries an id and a type. */
export function defaultHeaderMenuItems(): StoredMenuItem[] {
  return [
    { id: randomUUID(), title: "Home", url: "/", type: "home" },
    { id: randomUUID(), title: "Shop", url: "/categories", type: "url" },
    { id: randomUUID(), title: "About", url: "/pages/about", type: "page" },
  ];
}

/** Starter items for a new store's Footer menu (handle "footer"). */
export function defaultFooterMenuItems(): StoredMenuItem[] {
  return [
    { id: randomUUID(), title: "About Us", url: "/pages/about", type: "page" },
    { id: randomUUID(), title: "Privacy Policy", url: "/policies/privacy", type: "policy" },
    { id: randomUUID(), title: "Terms of Service", url: "/policies/terms", type: "policy" },
  ];
}

const KNOWN_TYPES = new Set([
  "url", "page", "collection", "product", "category", "brand", "blog", "blog_category", "blog_post",
  "policy", "home", "search", "account", "filter",
]);

/**
 * Makes stored menu items safe for the admin editor. Menus seeded by older provisioning code held `{ title, url }`
 * only; the editor keys and drags items by `id` and the contract requires `type`, so opening those menus failed.
 * Missing ids get a fresh uuid and a missing or unknown type becomes "url" (the storefront renders by url).
 * Saving the menu from the editor then persists the repaired shape. Never throws on odd input: non-objects are skipped.
 */
export function normalizeMenuItems(items: unknown): unknown[] {
  if (!Array.isArray(items)) return [];
  const out: unknown[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = { ...(raw as Record<string, unknown>) };
    if (typeof item.id !== "string" || item.id.length === 0) item.id = randomUUID();
    if (typeof item.title !== "string") item.title = "";
    if (typeof item.url !== "string") item.url = "";
    if (typeof item.type !== "string" || !KNOWN_TYPES.has(item.type)) item.type = "url";
    if (Array.isArray(item.children)) item.children = normalizeMenuItems(item.children);
    out.push(item);
  }
  return out;
}

/**
 * The AI permission matrix (ADR-050, docs/MCP-PLAN.md section 3.1): what the store lets any connected AI app do.
 * It is a ceiling: a call also needs the approving user's own store permission, a plan that includes AI access, and the consent.
 * Pure data, no protocol knowledge, so any later adapter (not only MCP) reads the same rows.
 */

export const AI_RESOURCES = ["products", "categories", "collections", "blog", "pages", "redirects", "customers", "orders", "analytics", "finance"] as const;
export type AiResource = (typeof AI_RESOURCES)[number];

export const AI_ACTIONS = ["read", "write", "delete"] as const;
export type AiAction = (typeof AI_ACTIONS)[number];

/**
 * What each cell of the grid is today:
 *  toggle: a switch the merchant can use (at least one capability is built for it)
 *  soon:   shown disabled, "Coming soon"
 *  na:     does not apply to this resource
 *  locked: permanently off for AI (money is never written by AI)
 * Delete: products are only archived (permanent deletion is never offered). For categories, collections, blog posts and
 * categories, website pages, menus and redirects, "delete" removes an item that is already hidden from shoppers (a draft or an
 * unpublished collection), always with an explicit confirmation, and the store's own rules still apply.
 */
export type AiCellKind = "toggle" | "soon" | "na" | "locked";

export const AI_CELLS: Readonly<Record<AiResource, Readonly<Record<AiAction, AiCellKind>>>> = {
  products: { read: "toggle", write: "toggle", delete: "toggle" },
  categories: { read: "toggle", write: "toggle", delete: "toggle" },
  collections: { read: "toggle", write: "toggle", delete: "toggle" },
  blog: { read: "toggle", write: "toggle", delete: "toggle" },
  pages: { read: "toggle", write: "toggle", delete: "toggle" },
  redirects: { read: "toggle", write: "toggle", delete: "toggle" },
  customers: { read: "toggle", write: "na", delete: "na" },
  orders: { read: "toggle", write: "soon", delete: "na" },
  analytics: { read: "toggle", write: "na", delete: "na" },
  finance: { read: "toggle", write: "locked", delete: "locked" },
};

/** Stored shape: only cells that are switched on appear; a missing cell is off. */
export type AiMatrix = Partial<Record<AiResource, Partial<Record<AiAction, boolean>>>>;

/** Keeps only known resources and actions whose cell is a real toggle and whose value is exactly true. Anything else is dropped. */
export function normalizeMatrix(input: unknown): AiMatrix {
  const out: AiMatrix = {};
  if (!input || typeof input !== "object") return out;
  const record = input as Record<string, unknown>;
  for (const resource of AI_RESOURCES) {
    const row = record[resource];
    if (!row || typeof row !== "object") continue;
    const rowRecord = row as Record<string, unknown>;
    for (const action of AI_ACTIONS) {
      if (AI_CELLS[resource][action] !== "toggle") continue;
      if (rowRecord[action] === true) {
        (out[resource] ??= {})[action] = true;
      }
    }
  }
  return out;
}

export function isCellAllowed(matrix: AiMatrix, resource: AiResource, action: AiAction): boolean {
  return AI_CELLS[resource][action] === "toggle" && matrix[resource]?.[action] === true;
}

/** The "Read only" preset: every read cell on, nothing else. */
export function readOnlyMatrix(): AiMatrix {
  const out: AiMatrix = {};
  for (const resource of AI_RESOURCES) {
    if (AI_CELLS[resource].read === "toggle") out[resource] = { read: true };
  }
  return out;
}

/**
 * Store permission the approving user must hold for a matrix cell (ADR-020 names). The matrix alone never grants anything:
 * `finance.read` is owner and admin only, so a user without it cannot lend it to an AI app.
 */
export function storePermissionFor(resource: AiResource, action: AiAction): string {
  switch (resource) {
    case "products":
    case "categories":
    case "collections":
      return action === "read" ? "products.read" : "products.write";
    case "blog":
    case "pages":
    case "redirects":
      // The store's own services guard even reads of these with content.write (there is no separate content.read).
      return "content.write";
    case "customers":
      return "customers.read";
    case "orders":
      return action === "read" ? "orders.read" : "orders.write";
    case "analytics":
      return "analytics.read";
    case "finance":
      return action === "read" ? "finance.read" : "finance.write";
  }
}

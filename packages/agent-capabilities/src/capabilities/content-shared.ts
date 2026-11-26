import { z } from "zod";
import { CapabilityError } from "../errors.ts";

export { Id, plain, seoPatch } from "./products.ts";

/** Deleting always needs this explicit flag, so a vague instruction cannot delete something by accident. */
export const Confirm = z.literal(true, { error: "Set confirm to true to delete this. Deleting cannot be undone." }).describe("Must be true. Deleting cannot be undone.");

export const SortOrder = z.enum(["manual", "best_selling", "title_asc", "title_desc", "price_asc", "price_desc", "created_desc", "created_asc"]).describe("Default order of products on the page.");

export const SeoFields = {
  seoTitle: z.string().max(70).optional().describe("Search result title, ideally up to 60 characters."),
  seoDescription: z.string().max(170).optional().describe("Search result description, ideally up to 160 characters."),
};

/** A rule that picks products for an automated category or collection. */
export const ProductRule = z.object({
  field: z.enum(["tag", "product_type", "brand", "category", "price", "in_stock", "title"]),
  operator: z.enum(["equals", "not_equals", "contains", "not_contains", "greater_than", "less_than", "is_set", "is_not_set"]),
  value: z.union([z.string().max(200), z.number(), z.boolean()]).describe("What to compare with. Price is in minor units (paise)."),
});

export function requirePublishing(allowPublishing: boolean, what: string): void {
  if (!allowPublishing) {
    throw new CapabilityError("forbidden", `This store has not allowed AI apps to publish, so ${what} cannot be made visible to shoppers. The store owner can turn on Allow publishing in Settings > AI access > Permissions.`);
  }
}

/** Store-relative web address (a path), as used by redirects: no scheme, no host. */
export const InternalPath = z
  .string()
  .min(1)
  .max(500)
  .regex(/^\/(?!\/)[^\s]*$/, "Use a path on this store that starts with a single slash, for example /old-page.");

/** A link a shopper can follow: a path on the store, a #fragment, https, mailto or tel. */
export const SafeLink = z
  .string()
  .max(500)
  .regex(/^(\/(?!\/)|#|https:\/\/|mailto:|tel:)\S*$/i, "A link must start with /, #, https://, mailto: or tel:.");

import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { schema, type Db } from "@bs/db";
import { buildSingleRuleCondition, parseCollectionRules } from "../storefront/catalog.ts";

/**
 * Which of the given collections each product is in (product id to collection ids), for discounts scoped to collections
 * (ADR-045). A manual collection is its assigned products; an automated one is its rules evaluated on the products asked
 * about, the same rules the storefront uses to list it. Reads only; a tenant-scoped connection is required.
 */
export async function collectionIdsByProduct(db: Db, tenantId: string, productIds: string[], collectionIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (productIds.length === 0 || collectionIds.length === 0) return out;
  const add = (productId: string, collectionId: string) => {
    const list = out.get(productId);
    if (list) {
      if (!list.includes(collectionId)) list.push(collectionId);
    } else {
      out.set(productId, [collectionId]);
    }
  };

  const cols = await db
    .select({ id: schema.collections.id, type: schema.collections.type, rules: schema.collections.rules, match: schema.collections.match })
    .from(schema.collections)
    .where(and(eq(schema.collections.tenantId, tenantId), inArray(schema.collections.id, collectionIds)));

  const manual = cols.filter((c) => c.type !== "automated").map((c) => c.id);
  if (manual.length > 0) {
    const rows = await db
      .select({ collectionId: schema.collectionProducts.collectionId, productId: schema.collectionProducts.productId })
      .from(schema.collectionProducts)
      .where(
        and(
          eq(schema.collectionProducts.tenantId, tenantId),
          inArray(schema.collectionProducts.collectionId, manual),
          inArray(schema.collectionProducts.productId, productIds),
        ),
      );
    for (const r of rows) add(r.productId, r.collectionId);
  }

  for (const col of cols.filter((c) => c.type === "automated")) {
    const conditions = parseCollectionRules(col.rules).map((rule) => buildSingleRuleCondition(rule, schema.products)).filter((c) => c !== undefined);
    if (conditions.length === 0) continue;
    const matched = await db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(
        and(
          eq(schema.products.tenantId, tenantId),
          isNull(schema.products.deletedAt),
          inArray(schema.products.id, productIds),
          col.match === "any" ? or(...conditions) : and(...conditions),
        ),
      );
    for (const m of matched) add(m.id, col.id);
  }
  return out;
}

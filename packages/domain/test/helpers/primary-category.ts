import { createCategory, type Runtime, type TenantContext } from "../../src/index.ts";

const cache = new Map<string, string>();

/** A product needs a primary category to be active (catalog plan Q2); tests that just need an active product share one per store. */
export async function primaryCategory(rt: Runtime, ctx: TenantContext): Promise<string> {
  const hit = cache.get(ctx.tenantId);
  if (hit) return hit;
  const c = await createCategory(rt, ctx, { name: "Test Catalog" });
  cache.set(ctx.tenantId, c.id);
  return c.id;
}

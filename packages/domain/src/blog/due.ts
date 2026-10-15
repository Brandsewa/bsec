import { and, eq, sql } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";

/**
 * Flips scheduled posts whose time has come to published and writes the audit row (ADR-033).
 * Visibility never depends on this job (the storefront rule is evaluated at read time), and the worker cannot call
 * `revalidateTag`, so the blog's cached storefront loaders carry a short `cacheLife` instead (about a minute).
 * The worker runs as `app_rw`, so each store is visited under its own tenant context, like the other sweeps.
 */
export async function publishDueBlogPosts(db: Db): Promise<{ published: number }> {
  const tenantIds = await db.select({ id: schema.tenants.id }).from(schema.tenants);
  let published = 0;
  for (const t of tenantIds) {
    const rows = await withTenant(db, t.id, async (tx) => {
      const flipped = await tx
        .update(schema.blogPosts)
        .set({ status: "published", updatedAt: new Date() })
        .where(and(eq(schema.blogPosts.tenantId, t.id), eq(schema.blogPosts.status, "scheduled"), sql`${schema.blogPosts.publishedAt} <= now()`))
        .returning({ id: schema.blogPosts.id, slug: schema.blogPosts.slug });
      for (const r of flipped) {
        await tx.insert(schema.auditLogs).values({
          tenantId: t.id,
          actorType: "system",
          actorId: null,
          action: "blog.post.auto_published",
          targetType: "blog_post",
          targetId: r.id,
          diff: { slug: r.slug },
        });
      }
      return flipped;
    });
    published += rows.length;
  }
  return { published };
}

import { eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { invalidateCache } from "../cache-invalidation.ts";
import { auditBlog, readBlogSettings, resolveBlogSettings, type BlogSettings } from "./shared.ts";

export async function getBlogSettings(rt: Runtime, ctx: TenantContext): Promise<BlogSettings> {
  assertPermission(ctx, "content.write");
  return withTenant(rt._db.db, ctx.tenantId, (tx) => readBlogSettings(tx, ctx.tenantId));
}

export async function updateBlogSettings(rt: Runtime, ctx: TenantContext, input: { [K in keyof BlogSettings]?: BlogSettings[K] | undefined }): Promise<BlogSettings> {
  assertPermission(ctx, "content.write");
  if (input.description && /[<>]/.test(input.description)) throw new Error("Bad Request: The description must be plain text (no HTML).");
  const next = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const cur = await readBlogSettings(tx, ctx.tenantId);
    const merged = resolveBlogSettings({ ...cur, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) });
    const res = await tx.update(schema.storeSettings).set({ blogSettings: merged }).where(eq(schema.storeSettings.tenantId, ctx.tenantId)).returning({ id: schema.storeSettings.id });
    if (res.length === 0) throw new Error("Bad Request: This store has no settings row yet.");
    await auditBlog(tx, ctx, "blog.settings.updated", "blog_settings", null, { enabled: merged.enabled, postsPerPage: merged.postsPerPage });
    return merged;
  });
  await invalidateCache(rt, ctx, { type: "blog_settings_changed" });
  return next;
}

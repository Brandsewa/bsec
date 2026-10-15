import { eq } from "drizzle-orm";
import { schema } from "@bs/db";
import type { withTenant } from "@bs/db";
import type { TenantContext } from "../context.ts";

export type Tx = Parameters<Parameters<typeof withTenant>[2]>[0];

/** Audit row for a blog mutation (AGENTS.md rule 6). */
export async function auditBlog(
  tx: Tx,
  ctx: TenantContext,
  action: string,
  targetType: "blog_post" | "blog_category" | "blog_settings",
  targetId: string | null,
  diff: Record<string, unknown>,
): Promise<void> {
  await tx.insert(schema.auditLogs).values({
    tenantId: ctx.tenantId,
    actorType: ctx.actor.type,
    actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
    action,
    targetType,
    targetId: targetId ?? targetType,
    diff,
  });
}

export interface BlogSettings {
  enabled: boolean;
  title: string;
  description: string;
  postsPerPage: number;
}

export const DEFAULT_BLOG_SETTINGS: BlogSettings = { enabled: true, title: "Blog", description: "", postsPerPage: 9 };

export function resolveBlogSettings(raw: unknown): BlogSettings {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const per =
    typeof o["postsPerPage"] === "number"
      ? Math.min(48, Math.max(3, Math.trunc(o["postsPerPage"])))
      : DEFAULT_BLOG_SETTINGS.postsPerPage;
  const title = o["title"];
  const description = o["description"];
  return {
    enabled: o["enabled"] !== false,
    title: typeof title === "string" && title.trim() ? title.trim().slice(0, 120) : DEFAULT_BLOG_SETTINGS.title,
    description: typeof description === "string" ? description.trim().slice(0, 320) : "",
    postsPerPage: per,
  };
}

export async function readBlogSettings(tx: Tx, tenantId: string): Promise<BlogSettings> {
  const [row] = await tx
    .select({ blog: schema.storeSettings.blogSettings })
    .from(schema.storeSettings)
    .where(eq(schema.storeSettings.tenantId, tenantId))
    .limit(1);
  return resolveBlogSettings(row?.blog);
}

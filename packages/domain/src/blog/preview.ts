import { createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";

/**
 * Preview links for posts that are not public yet (ADR-033): a signed, expiring token in the address, so staff can
 * share a draft with someone who has no admin login. Nothing is stored. The key is the store-secrets key (required in
 * production); the token binds the store, the post and the expiry, so it cannot open another post or another store.
 */

const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;

function key(): string {
  const k = process.env.TENANT_SECRETS_KEY ?? process.env.ENCRYPTION_KEY;
  if (!k && process.env.NODE_ENV === "production") throw new Error("TENANT_SECRETS_KEY is required to create preview links");
  return k ?? "dev-only-blog-preview-key";
}

function mac(tenantId: string, postId: string, exp: number): string {
  return createHmac("sha256", key()).update(`blog-preview:${tenantId}:${postId}:${exp}`).digest("hex");
}

export function signBlogPreviewToken(tenantId: string, postId: string, now = Date.now()): { token: string; expiresAt: Date } {
  const exp = now + PREVIEW_TTL_MS;
  return { token: `${exp.toString(36)}.${mac(tenantId, postId, exp)}`, expiresAt: new Date(exp) };
}

export function verifyBlogPreviewToken(tenantId: string, postId: string, token: string, now = Date.now()): boolean {
  const [expRaw, sig] = token.split(".");
  if (!expRaw || !sig || !/^[0-9a-z]{1,12}$/.test(expRaw) || !/^[0-9a-f]{64}$/.test(sig)) return false;
  const exp = parseInt(expRaw, 36);
  if (!Number.isFinite(exp) || exp < now) return false;
  const want = Buffer.from(mac(tenantId, postId, exp), "hex");
  const got = Buffer.from(sig, "hex");
  return want.length === got.length && timingSafeEqual(want, got);
}

/** An absolute address for the post's preview on the store's own host (primary domain first). */
export async function createBlogPreviewLink(rt: Runtime, ctx: TenantContext, postId: string): Promise<{ url: string; expiresAt: string }> {
  assertPermission(ctx, "content.write");
  const post = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [p] = await tx
      .select({ slug: schema.blogPosts.slug })
      .from(schema.blogPosts)
      .where(and(eq(schema.blogPosts.tenantId, ctx.tenantId), eq(schema.blogPosts.id, postId)))
      .limit(1);
    return p ?? null;
  });
  if (!post) throw new Error("Bad Request: Post not found.");
  const [domain] = await rt._db.db
    .select({ hostname: schema.domains.hostname })
    .from(schema.domains)
    .where(and(eq(schema.domains.tenantId, ctx.tenantId), eq(schema.domains.status, "active")))
    .orderBy(desc(schema.domains.isPrimary), asc(schema.domains.createdAt))
    .limit(1);
  if (!domain) throw new Error("Bad Request: This store has no active address yet, so a preview link cannot be made.");
  const { token, expiresAt } = signBlogPreviewToken(ctx.tenantId, postId);
  const local = /(^|\.)localhost(:\d+)?$/.test(domain.hostname);
  return { url: `${local ? "http" : "https"}://${domain.hostname}/blog/${post.slug}?preview=${token}`, expiresAt: expiresAt.toISOString() };
}

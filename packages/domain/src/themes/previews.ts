import { randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { schema } from "@bs/db";
import { validateBlockDocument, type BlockInstance } from "@bs/blocks";
import type { Runtime } from "../runtime.ts";
import { writePlatformAudit, type AuditMeta } from "../platform-services.ts";
import { assertThemeEditor } from "./templates.ts";

/**
 * Shareable theme previews. A preview is an immutable snapshot of the theme's saved draft (pages and
 * tokens) behind an unguessable code, valid for a few hours. The storefront renders it at
 * /preview/<code> on the platform's marketing host with sample products, collections and cart, so
 * staff can look at a theme in a real browser (or send the link to someone) before publishing.
 */

export const PREVIEW_DEFAULT_TTL_HOURS = 24;
export const PREVIEW_MAX_TTL_HOURS = 24 * 7;

/** 11 URL-safe characters (64 bits of randomness): short enough to type, too long to guess. */
function newCode(): string {
  return randomBytes(8).toString("base64url");
}

export interface CreatedPreview {
  code: string;
  expiresAt: string;
  /** Pages that can be shown (everything except the header and footer, which frame every page). */
  pages: string[];
}

export async function createThemePreview(
  rt: Runtime,
  staffUserId: string,
  input: { code: string; ttlHours?: number | undefined },
  meta?: AuditMeta,
): Promise<CreatedPreview> {
  await assertThemeEditor(rt, staffUserId);
  const ttl = Math.min(PREVIEW_MAX_TTL_HOURS, Math.max(1, Math.round(input.ttlHours ?? PREVIEW_DEFAULT_TTL_HOURS)));
  return rt._db.db.transaction(async (tx) => {
    const [tpl] = await tx.select().from(schema.themeTemplates).where(eq(schema.themeTemplates.code, input.code)).limit(1);
    if (!tpl) throw new Error(`Not Found: Template not found: "${input.code}"`);
    const draft = (tpl.draftPages ?? tpl.defaultPages) as Record<string, unknown>;
    const pages: Record<string, BlockInstance[]> = {};
    for (const [key, blocks] of Object.entries(draft)) {
      if (!Array.isArray(blocks)) continue;
      // Re-validated here so the public page only ever renders blocks the registry accepts.
      const r = validateBlockDocument({ version: 1, blocks });
      if (r.success) pages[key] = r.data.blocks;
    }
    if (!pages["home"]) throw new Error("Bad Request: The theme has no valid home page to preview");
    const tokens = (tpl.draftTokens ?? tpl.defaultTokens) as Record<string, unknown>;

    // Housekeeping: expired links are removed whenever a new one is made.
    await tx.delete(schema.themePreviews).where(lt(schema.themePreviews.expiresAt, new Date()));

    const expiresAt = new Date(Date.now() + ttl * 3600_000);
    const code = newCode();
    await tx.insert(schema.themePreviews).values({ code, templateCode: tpl.code, name: tpl.name, pages, tokens, createdBy: staffUserId, expiresAt });
    await writePlatformAudit(tx, staffUserId, "theme_template.preview_create", "theme_template", tpl.code, null, { ttlHours: ttl, pages: Object.keys(pages) }, meta);
    return { code, expiresAt: expiresAt.toISOString(), pages: Object.keys(pages).filter((k) => k !== "header" && k !== "footer") };
  });
}

export interface ThemePreview {
  name: string;
  templateCode: string;
  pages: Record<string, BlockInstance[]>;
  tokens: Record<string, unknown>;
  expiresAt: string;
}

/** The snapshot behind a preview code, or null when the code is unknown or expired. Read by the storefront. */
export async function getThemePreview(rt: Runtime, code: string): Promise<ThemePreview | null> {
  if (!/^[A-Za-z0-9_-]{8,32}$/.test(code)) return null;
  const [row] = await rt._db.db
    .select()
    .from(schema.themePreviews)
    .where(and(eq(schema.themePreviews.code, code), gt(schema.themePreviews.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;
  return {
    name: row.name,
    templateCode: row.templateCode,
    pages: row.pages as Record<string, BlockInstance[]>,
    tokens: row.tokens as Record<string, unknown>,
    expiresAt: row.expiresAt.toISOString(),
  };
}

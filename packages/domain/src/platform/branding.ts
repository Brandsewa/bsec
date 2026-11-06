import { desc, eq, sql } from "drizzle-orm";
import { schema } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPlatformStaff, assertRoleAtLeast, writePlatformAudit, type AuditMeta } from "../platform-services.ts";
import { DEFAULT_BRAND, buildBrandCss, parseBrandTokens, type PlatformBrandTokens } from "./branding-tokens.ts";

export interface PlatformBrandView {
  tokens: PlatformBrandTokens;
  defaults: PlatformBrandTokens;
  /** Ready-to-inline CSS variables derived from the tokens. */
  css: string;
  version: number;
  explicit: boolean;
  updatedAt: string | null;
  updatedByEmail: string | null;
}

export async function getPlatformBrand(rt: Runtime, platformStaffUserId: string): Promise<PlatformBrandView> {
  await assertPlatformStaff(rt, platformStaffUserId);
  const [row] = await rt._db.db
    .select({
      tokens: schema.platformBranding.tokens,
      version: schema.platformBranding.version,
      updatedAt: schema.platformBranding.updatedAt,
      updatedByEmail: schema.users.email,
    })
    .from(schema.platformBranding)
    .leftJoin(schema.users, eq(schema.users.id, schema.platformBranding.updatedBy))
    .where(eq(schema.platformBranding.id, "default"))
    .limit(1);
  const tokens = parseBrandTokens(row?.tokens, DEFAULT_BRAND).tokens;
  return {
    tokens,
    defaults: DEFAULT_BRAND,
    css: buildBrandCss(tokens),
    version: row?.version ?? 0,
    explicit: Boolean(row),
    updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
    updatedByEmail: row?.updatedByEmail ?? null,
  };
}

/** Saves the brand (platform_admin and above, audited). Invalid input is refused whole; nothing is half-saved. */
export async function updatePlatformBrand(
  rt: Runtime,
  platformStaffUserId: string,
  input: unknown,
  meta?: AuditMeta,
): Promise<{ ok: true; version: number }> {
  const staff = await assertPlatformStaff(rt, platformStaffUserId);
  assertRoleAtLeast(staff.role, "platform_admin", "change platform branding");

  const { tokens, issues } = parseBrandTokens(input, DEFAULT_BRAND);
  if (issues.length > 0) {
    throw new Error(`Invalid branding: ${issues.map((i) => `${i.field}: ${i.message}`).join("; ")}`);
  }

  return saveBrand(rt, platformStaffUserId, tokens, "update", meta);
}

const KEEP_VERSIONS = 20;

/** One write path for save and restore: upsert the row, append a history entry, prune, audit. */
async function saveBrand(
  rt: Runtime,
  platformStaffUserId: string,
  tokens: PlatformBrandTokens,
  action: "update" | "restore",
  meta?: AuditMeta,
  restoredFrom?: number,
): Promise<{ ok: true; version: number }> {
  return rt._db.db.transaction(async (tx) => {
    const [prev] = await tx
      .select({ version: schema.platformBranding.version })
      .from(schema.platformBranding)
      .where(eq(schema.platformBranding.id, "default"))
      .limit(1);
    const version = (prev?.version ?? 0) + 1;
    await tx
      .insert(schema.platformBranding)
      .values({ id: "default", tokens, version, updatedBy: platformStaffUserId, updatedAt: sql`now()` })
      .onConflictDoUpdate({
        target: schema.platformBranding.id,
        set: { tokens, version, updatedBy: platformStaffUserId, updatedAt: sql`now()` },
      });
    await tx.insert(schema.platformBrandingVersions).values({ version, tokens, action, updatedBy: platformStaffUserId });
    await tx.delete(schema.platformBrandingVersions).where(sql`${schema.platformBrandingVersions.version} <= ${version - KEEP_VERSIONS}`);
    await writePlatformAudit(tx, platformStaffUserId, `platform_branding.${action}`, "platform_branding", "default", null, {
      version: { from: prev?.version ?? 0, to: version },
      ...(restoredFrom ? { restoredFrom } : {}),
    }, meta);
    return { ok: true as const, version };
  });
}

export interface PlatformBrandVersion {
  version: number;
  action: string;
  createdAt: string;
  updatedByEmail: string | null;
  tokens: PlatformBrandTokens;
}

/** The last saves, newest first (staff read). Tokens are re-parsed so an old shape can never break the page. */
export async function listPlatformBrandVersions(rt: Runtime, platformStaffUserId: string): Promise<PlatformBrandVersion[]> {
  await assertPlatformStaff(rt, platformStaffUserId);
  const rows = await rt._db.db
    .select({
      version: schema.platformBrandingVersions.version,
      action: schema.platformBrandingVersions.action,
      createdAt: schema.platformBrandingVersions.createdAt,
      tokens: schema.platformBrandingVersions.tokens,
      updatedByEmail: schema.users.email,
    })
    .from(schema.platformBrandingVersions)
    .leftJoin(schema.users, eq(schema.users.id, schema.platformBrandingVersions.updatedBy))
    .orderBy(desc(schema.platformBrandingVersions.version))
    .limit(KEEP_VERSIONS);
  return rows.map((r) => ({
    version: r.version,
    action: r.action,
    createdAt: r.createdAt.toISOString(),
    updatedByEmail: r.updatedByEmail ?? null,
    tokens: parseBrandTokens(r.tokens, DEFAULT_BRAND).tokens,
  }));
}

/** Restores an earlier version as a NEW version (history is never rewritten). platform_admin and above, audited. */
export async function restorePlatformBrand(
  rt: Runtime,
  platformStaffUserId: string,
  version: number,
  meta?: AuditMeta,
): Promise<{ ok: true; version: number }> {
  const staff = await assertPlatformStaff(rt, platformStaffUserId);
  assertRoleAtLeast(staff.role, "platform_admin", "restore platform branding");
  const [row] = await rt._db.db
    .select({ tokens: schema.platformBrandingVersions.tokens })
    .from(schema.platformBrandingVersions)
    .where(eq(schema.platformBrandingVersions.version, version))
    .limit(1);
  if (!row) throw new Error(`Branding version ${version} was not found (only the last ${KEEP_VERSIONS} are kept).`);
  return saveBrand(rt, platformStaffUserId, parseBrandTokens(row.tokens, DEFAULT_BRAND).tokens, "restore", meta, version);
}

export interface PublicPlatformBrand {
  tokens: PlatformBrandTokens;
  css: string;
  version: number;
  /** False until a brand has been saved: consumers keep their built-in look. */
  explicit: boolean;
}

/** Unauthenticated read for the website, dashboards and sign-in pages. Only the safe token subset: no staff or audit data. */
export async function getPublicPlatformBrand(rt: Runtime): Promise<PublicPlatformBrand> {
  const [row] = await rt._db.db
    .select({ tokens: schema.platformBranding.tokens, version: schema.platformBranding.version })
    .from(schema.platformBranding)
    .where(eq(schema.platformBranding.id, "default"))
    .limit(1);
  const tokens = parseBrandTokens(row?.tokens, DEFAULT_BRAND).tokens;
  return { tokens, css: buildBrandCss(tokens), version: row?.version ?? 0, explicit: Boolean(row) };
}

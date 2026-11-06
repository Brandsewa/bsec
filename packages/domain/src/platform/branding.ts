import { eq, sql } from "drizzle-orm";
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

  return rt._db.db.transaction(async (tx) => {
    const [prev] = await tx
      .select({ tokens: schema.platformBranding.tokens, version: schema.platformBranding.version })
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
    await writePlatformAudit(tx, platformStaffUserId, "platform_branding.update", "platform_branding", "default", null, {
      version: { from: prev?.version ?? 0, to: version },
    }, meta);
    return { ok: true as const, version };
  });
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

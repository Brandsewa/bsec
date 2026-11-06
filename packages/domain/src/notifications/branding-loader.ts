import { eq } from "drizzle-orm";
import { schema, type Db } from "@bs/db";
import { DEFAULT_EMAIL_BRANDING, parseEmailBranding, resolveEmailBranding, type EmailBrandingTokens } from "../system/email-branding.ts";
import { parseBrandTokens, type PlatformBrandTokens } from "../platform/branding-tokens.ts";

/**
 * The BCom brand for mail sent to store admins and staff. Starts from the Super Admin platform brand (logo, primary colour,
 * light button) when one is saved, then explicit values in platform_email_branding win (owner decision 2026-11-05). Falls back to
 * the defaults when nothing is saved. Not used for store customer emails: a store's customers never see the platform's logo.
 */
export async function loadPlatformBranding(db: Db): Promise<EmailBrandingTokens> {
  const [row] = await db.select({ tokens: schema.platformEmailBranding.tokens }).from(schema.platformEmailBranding).where(eq(schema.platformEmailBranding.id, "default")).limit(1);
  const [brand] = await db.select({ tokens: schema.platformBranding.tokens }).from(schema.platformBranding).where(eq(schema.platformBranding.id, "default")).limit(1);
  const base = brand ? emailBaseFromBrand(parseBrandTokens(brand.tokens).tokens) : undefined;
  return parseEmailBranding(row?.tokens, base, { layer: "platform" }).tokens;
}

/** Email tokens implied by the platform brand. Emails sit on a light card, so the light logo and light button are used. */
export function emailBaseFromBrand(b: PlatformBrandTokens): EmailBrandingTokens {
  const logo = b.logo.light.full ?? b.logo.dark.full ?? b.logo.light.icon ?? b.logo.dark.icon;
  return {
    ...DEFAULT_EMAIL_BRANDING,
    logoUrl: logo && logo.url.startsWith("https://") ? logo.url : null,
    accent: b.color.primary,
    linkColor: b.color.primary,
    buttonBackground: b.button.light.background,
    buttonText: b.button.light.text,
  };
}

/** The tokens a customer email is rendered with: the store's own tokens over the platform's. `tx` is the tenant transaction. */
export async function loadCustomerEmailBranding(tx: Db, platformDb: Db, tenantId: string): Promise<EmailBrandingTokens> {
  const [platformRow] = await platformDb.select({ tokens: schema.platformEmailBranding.tokens }).from(schema.platformEmailBranding).where(eq(schema.platformEmailBranding.id, "default")).limit(1);
  const [storeRow] = await tx.select({ tokens: schema.storeEmailBranding.tokens }).from(schema.storeEmailBranding).where(eq(schema.storeEmailBranding.tenantId, tenantId)).limit(1);
  return resolveEmailBranding(platformRow?.tokens, storeRow?.tokens);
}

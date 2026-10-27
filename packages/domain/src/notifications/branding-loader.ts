import { eq } from "drizzle-orm";
import { schema, type Db } from "@bs/db";
import { parseEmailBranding, resolveEmailBranding, type EmailBrandingTokens } from "../system/email-branding.ts";

/** The BCom brand for mail sent to store admins and staff. Falls back to the defaults when nothing is saved. */
export async function loadPlatformBranding(db: Db): Promise<EmailBrandingTokens> {
  const [row] = await db.select({ tokens: schema.platformEmailBranding.tokens }).from(schema.platformEmailBranding).where(eq(schema.platformEmailBranding.id, "default")).limit(1);
  return parseEmailBranding(row?.tokens, undefined, { layer: "platform" }).tokens;
}

/** The tokens a customer email is rendered with: the store's own tokens over the platform's. `tx` is the tenant transaction. */
export async function loadCustomerEmailBranding(tx: Db, platformDb: Db, tenantId: string): Promise<EmailBrandingTokens> {
  const [platformRow] = await platformDb.select({ tokens: schema.platformEmailBranding.tokens }).from(schema.platformEmailBranding).where(eq(schema.platformEmailBranding.id, "default")).limit(1);
  const [storeRow] = await tx.select({ tokens: schema.storeEmailBranding.tokens }).from(schema.storeEmailBranding).where(eq(schema.storeEmailBranding.tenantId, tenantId)).limit(1);
  return resolveEmailBranding(platformRow?.tokens, storeRow?.tokens);
}

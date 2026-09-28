import { sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import type { TenantContext } from "../context.ts";

export interface SubscribeNewsletterInput {
  email: string;
  source?: string | undefined;
}

export interface SubscribeNewsletterResult {
  success: boolean;
  message: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Subscribes an email to the storefront newsletter, upserting if already subscribed or unsubscribed.
 */
export async function subscribeNewsletter(
  rt: Runtime,
  ctx: TenantContext,
  input: SubscribeNewsletterInput,
): Promise<SubscribeNewsletterResult> {
  const email = input.email?.trim().toLowerCase();
  if (!email || !EMAIL_REGEX.test(email)) {
    throw new Error("Invalid email address");
  }

  const source = input.source?.trim() || "storefront";
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    await tx
      .insert(schema.newsletterSubscribers)
      .values({
        email,
        source,
        status: "subscribed",
        tenantId: ctx.tenantId,
      })
      .onConflictDoUpdate({
        target: [schema.newsletterSubscribers.tenantId, schema.newsletterSubscribers.email],
        set: {
          status: "subscribed",
          unsubscribedAt: null,
          source,
          consentAt: sql`now()`,
        },
      });

    return {
      success: true,
      message: "Subscribed successfully",
    };
  });
}

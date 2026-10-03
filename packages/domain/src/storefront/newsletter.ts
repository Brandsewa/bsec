import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import type { TenantContext } from "../context.ts";
import { setMarketingConsent } from "../customers/consent.ts";

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
 * Subscribes an email to the storefront newsletter, upserting customer (guest if needed) and recording consent event.
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

  const source = input.source?.trim() || "storefront_form";
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    // 1. Find or create customer
    let [c] = await tx
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(and(eq(schema.customers.tenantId, ctx.tenantId), eq(schema.customers.email, email)))
      .limit(1);

    if (!c) {
      const [newCust] = await tx
        .insert(schema.customers)
        .values({
          tenantId: ctx.tenantId,
          email,
          name: "",
          isGuest: true,
          emailVerified: false,
          phoneVerified: false,
          acceptsMarketing: false,
          marketingState: "not_subscribed",
        })
        .returning({ id: schema.customers.id });
      c = newCust;
    }

    if (!c) {
      throw new Error("Failed to resolve customer for newsletter subscription");
    }

    // 2. Set marketing consent via single writer
    const consentSource = source === "storefront" ? "storefront_form" : (source as "storefront_form");
    await setMarketingConsent(
      rt,
      ctx,
      {
        customerId: c.id,
        state: "subscribed",
        source: consentSource,
        channel: "email",
      },
      tx,
    );

    return {
      success: true,
      message: "Subscribed successfully",
    };
  });
}

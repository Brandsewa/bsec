import { eq, and } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { type TenantContext } from "../context.ts";

export type MarketingConsentState = "subscribed" | "unsubscribed" | "not_subscribed" | "invalid";

export type MarketingConsentSource =
  | "checkout"
  | "storefront_form"
  | "account_page"
  | "admin"
  | "import"
  | "unsubscribe_link"
  | "legacy";

export interface SetMarketingConsentInput {
  customerId: string;
  state: MarketingConsentState;
  source: MarketingConsentSource;
  channel?: "email" | "sms" | undefined;
  ip?: string | undefined;
  actorType?: "customer" | "staff" | "system" | undefined;
  actorId?: string | null | undefined;
}

export interface SetMarketingConsentResult {
  success: boolean;
  customerId: string;
  marketingState: MarketingConsentState;
  acceptsMarketing: boolean;
  consentEventId: string;
}

/**
 * Single authoritative writer of marketing consent (PLAN §0c).
 *
 * 1. Updates customer row: marketing_state, accepts_marketing (state === 'subscribed'),
 *    marketing_source, marketing_updated_at, and marketing_consent_at.
 * 2. Keeps newsletter_subscribers table synchronized when channel is email.
 * 3. Appends immutable audit event to customer_consent_events table.
 * 4. Writes an audit_logs row when actor is staff.
 */
export async function setMarketingConsent(
  rt: Runtime,
  ctx: TenantContext | { tenantId: string; actor?: { type: string; userId?: string } },
  input: SetMarketingConsentInput,
  tx?: Db,
): Promise<SetMarketingConsentResult> {
  const tenantId = ctx.tenantId;
  const db = rt._db.db;
  const channel = input.channel ?? "email";
  const state = input.state;
  const source = input.source;
  const acceptsMarketing = state === "subscribed";
  const now = new Date();

  const runner = async (d: Db): Promise<SetMarketingConsentResult> => {
    // 1. Fetch customer
    const [c] = await d
      .select({
        id: schema.customers.id,
        email: schema.customers.email,
        phone: schema.customers.phone,
        acceptsMarketing: schema.customers.acceptsMarketing,
        marketingState: schema.customers.marketingState,
      })
      .from(schema.customers)
      .where(and(eq(schema.customers.tenantId, tenantId), eq(schema.customers.id, input.customerId)))
      .limit(1);

    if (!c) {
      throw new Error(`Customer not found: ${input.customerId}`);
    }

    // 2. Update customer record
    await d
      .update(schema.customers)
      .set({
        marketingState: state,
        acceptsMarketing,
        marketingSource: source,
        marketingUpdatedAt: now,
        ...(acceptsMarketing ? { marketingConsentAt: now } : {}),
        updatedAt: now,
      })
      .where(and(eq(schema.customers.tenantId, tenantId), eq(schema.customers.id, c.id)));

    // 3. Keep newsletter_subscribers in step if email channel
    if (channel === "email" && c.email) {
      if (acceptsMarketing) {
        await d
          .insert(schema.newsletterSubscribers)
          .values({
            tenantId,
            email: c.email,
            status: "subscribed",
            source,
            consentAt: now,
            unsubscribedAt: null,
          })
          .onConflictDoUpdate({
            target: [schema.newsletterSubscribers.tenantId, schema.newsletterSubscribers.email],
            set: {
              status: "subscribed",
              source,
              consentAt: now,
              unsubscribedAt: null,
            },
          });
      } else if (state === "unsubscribed") {
        await d
          .update(schema.newsletterSubscribers)
          .set({
            status: "unsubscribed",
            unsubscribedAt: now,
          })
          .where(and(eq(schema.newsletterSubscribers.tenantId, tenantId), eq(schema.newsletterSubscribers.email, c.email)));
      }
    }

    // 4. Record customer_consent_events row
    const actorType = input.actorType ?? (ctx.actor?.type ?? "customer");
    const actorId = input.actorId ?? (ctx.actor && "userId" in ctx.actor ? ctx.actor.userId : null);

    const [eventRow] = await d
      .insert(schema.customerConsentEvents)
      .values({
        tenantId,
        customerId: c.id,
        channel,
        state,
        source,
        actorType,
        actorId: actorId ?? null,
        ip: input.ip ?? null,
        at: now,
      })
      .returning({ id: schema.customerConsentEvents.id });

    // 5. Write audit_logs when actor is staff
    if (actorType === "staff") {
      await d.insert(schema.auditLogs).values({
        tenantId,
        actorType: "staff",
        actorId,
        action: "customer.consent_changed",
        targetType: "customer",
        targetId: c.id,
        diff: {
          previousState: c.marketingState,
          newState: state,
          source,
          channel,
        },
      });
    }

    return {
      success: true,
      customerId: c.id,
      marketingState: state,
      acceptsMarketing,
      consentEventId: eventRow?.id ?? "",
    };
  };

  if (tx) {
    return runner(tx);
  }
  return withTenant(db, tenantId, runner);
}

import { and, eq } from "drizzle-orm";
import { type Db, customers, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";

export interface CustomerProfile {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  acceptsMarketing: boolean;
  /** True while the email is still the placeholder made at OTP sign-in. */
  emailIsPlaceholder: boolean;
}

export interface ProfileInput {
  name: string;
  email: string;
  acceptsMarketing: boolean;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLACEHOLDER_SUFFIX = "@customer.store";

export async function getCustomerProfile(db: Db, tenantId: string, customerId: string): Promise<CustomerProfile | null> {
  return await withTenant(db, tenantId, async (tx) => {
    const [c] = await tx
      .select()
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId), eq(customers.status, "active")));
    if (!c) return null;
    return {
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      acceptsMarketing: c.acceptsMarketing,
      emailIsPlaceholder: c.email.endsWith(PLACEHOLDER_SUFFIX),
    };
  });
}

/** Lets a signed-in shopper change their name, email and marketing choice. The phone is their login and cannot change here. */
export async function updateCustomerProfile(db: Db, tenantId: string, customerId: string, input: ProfileInput): Promise<CustomerProfile | null> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (name.length > 120) throw new Error("Bad Request: Name is too long");
  if (!EMAIL_REGEX.test(email) || email.length > 254) throw new Error("Bad Request: Enter a valid email address");

  return await withTenant(db, tenantId, async (tx) => {
    const [taken] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), eq(customers.email, email)));
    if (taken && taken.id !== customerId) throw new Error("Conflict: That email is already used by another account");

    const [current] = await tx
      .select({ acceptsMarketing: customers.acceptsMarketing })
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId), eq(customers.status, "active")));
    if (!current) return null;

    await tx
      .update(customers)
      .set({
        name,
        email,
        updatedAt: new Date(),
      })
      .where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId)));

    if (input.acceptsMarketing !== current.acceptsMarketing) {
      const { setMarketingConsent } = await import("./consent.ts");
      await setMarketingConsent(
        { _db: { db: tx } } as unknown as Runtime,
        { tenantId, actor: { type: "customer", userId: customerId } },
        {
          customerId,
          state: input.acceptsMarketing ? "subscribed" : "unsubscribed",
          source: "account_page",
          channel: "email",
        },
        tx,
      );
    }

    const [c] = await tx.select().from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId)));
    return c
      ? {
          id: c.id,
          name: c.name,
          email: c.email,
          phone: c.phone,
          acceptsMarketing: c.acceptsMarketing,
          emailIsPlaceholder: c.email.endsWith(PLACEHOLDER_SUFFIX),
        }
      : null;
  });
}

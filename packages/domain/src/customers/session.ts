import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { type Db, customerSessions, customers, withTenant } from "@bs/db";
import type { CustomerRecord } from "./otp.ts";

/** A shopper stays signed in on one device for 30 days. */
export const CUSTOMER_SESSION_TTL_MS = 30 * 86_400_000;

const hashToken = (raw: string): string => createHash("sha256").update(raw.trim()).digest("hex");

/**
 * Opens a session after a successful OTP check. The raw token goes into an httpOnly cookie and is never stored:
 * only its sha256 is, so a database leak cannot be replayed. Runs inside the caller's tenant transaction.
 */
export async function createCustomerSession(
  tx: Db,
  tenantId: string,
  customerId: string,
  meta: { ip?: string | undefined; userAgent?: string | undefined } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = `cs_${randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + CUSTOMER_SESSION_TTL_MS);
  await tx.insert(customerSessions).values({
    id: randomUUID(),
    tenantId,
    userId: customerId,
    token: hashToken(token),
    expiresAt,
    ipAddress: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
  });
  return { token, expiresAt };
}

/** The signed-in customer for a session cookie, or null when it is unknown, expired, for another store, or the customer is gone. */
export async function getCustomerBySession(db: Db, tenantId: string, rawToken: string | undefined | null): Promise<CustomerRecord | null> {
  if (!rawToken) return null;
  return await withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({
        id: customers.id,
        phone: customers.phone,
        email: customers.email,
        name: customers.name,
        phoneVerified: customers.phoneVerified,
      })
      .from(customerSessions)
      .innerJoin(customers, and(eq(customers.tenantId, customerSessions.tenantId), eq(customers.id, customerSessions.userId)))
      .where(
        and(
          eq(customerSessions.tenantId, tenantId),
          eq(customerSessions.token, hashToken(rawToken)),
          gt(customerSessions.expiresAt, new Date()),
          eq(customers.status, "active"),
        ),
      );
    return row ?? null;
  });
}

/** Sign out: forget this session. Unknown tokens are a no-op. */
export async function destroyCustomerSession(db: Db, tenantId: string, rawToken: string): Promise<void> {
  await withTenant(db, tenantId, async (tx) => {
    await tx.delete(customerSessions).where(and(eq(customerSessions.tenantId, tenantId), eq(customerSessions.token, hashToken(rawToken))));
  });
}

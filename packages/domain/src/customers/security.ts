import { and, desc, eq, gt, ne } from "drizzle-orm";
import { type Db, customerSecurityEvents, customerSessions, customers, withTenant } from "@bs/db";
import { deviceLabel, displayIp } from "../account/device.ts";
import { hashCustomerToken } from "./session.ts";

export type CustomerSecurityEventType = "sign_in" | "password_changed" | "password_reset" | "session_revoked" | "other_sessions_revoked";

interface RequestInfo {
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
}

/** Append a trail entry. Never throws: the trail must not break the sign-in or change it describes. */
export async function recordCustomerSecurityEvent(
  db: Db,
  tenantId: string,
  customerId: string,
  type: CustomerSecurityEventType,
  req: RequestInfo = {},
): Promise<void> {
  try {
    await withTenant(db, tenantId, (tx) =>
      tx.insert(customerSecurityEvents).values({ tenantId, customerId, type, ip: req.ip ?? null, userAgent: req.userAgent?.slice(0, 300) ?? null }),
    );
  } catch {
    /* intentionally swallowed, see above */
  }
}

export interface CustomerSessionRecord {
  id: string;
  device: string;
  ip: string | null;
  signedInAt: string;
  current: boolean;
}

/** The shopper's live sessions on this store. The stored value is a hash, so a token is never shown or returned. */
export async function listCustomerSessions(db: Db, tenantId: string, customerId: string, currentRawToken: string | null | undefined): Promise<CustomerSessionRecord[]> {
  const currentHash = currentRawToken ? hashCustomerToken(currentRawToken) : null;
  return withTenant(db, tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(customerSessions)
      .where(and(eq(customerSessions.tenantId, tenantId), eq(customerSessions.userId, customerId), gt(customerSessions.expiresAt, new Date())))
      .orderBy(desc(customerSessions.createdAt));
    return rows.map((r) => ({ id: r.id, device: deviceLabel(r.userAgent), ip: displayIp(r.ipAddress), signedInAt: r.createdAt.toISOString(), current: r.token === currentHash }));
  });
}

/** Sign one other device out. Refuses the current session (that is Sign out) and anyone else's session. */
export async function revokeCustomerSession(
  db: Db,
  tenantId: string,
  customerId: string,
  sessionId: string,
  currentRawToken: string,
  req: RequestInfo = {},
): Promise<{ revoked: boolean }> {
  const currentHash = hashCustomerToken(currentRawToken);
  const deleted = await withTenant(db, tenantId, (tx) =>
    tx
      .delete(customerSessions)
      .where(
        and(
          eq(customerSessions.tenantId, tenantId),
          eq(customerSessions.userId, customerId),
          eq(customerSessions.id, sessionId),
          ne(customerSessions.token, currentHash),
        ),
      )
      .returning({ id: customerSessions.id }),
  );
  if (deleted.length) await recordCustomerSecurityEvent(db, tenantId, customerId, "session_revoked", req);
  return { revoked: deleted.length > 0 };
}

/** Sign out every other device and record it. */
export async function revokeOtherCustomerSessions(
  db: Db,
  tenantId: string,
  customerId: string,
  currentRawToken: string,
  req: RequestInfo = {},
): Promise<{ count: number }> {
  const currentHash = hashCustomerToken(currentRawToken);
  const deleted = await withTenant(db, tenantId, (tx) =>
    tx
      .delete(customerSessions)
      .where(and(eq(customerSessions.tenantId, tenantId), eq(customerSessions.userId, customerId), ne(customerSessions.token, currentHash)))
      .returning({ id: customerSessions.id }),
  );
  if (deleted.length) await recordCustomerSecurityEvent(db, tenantId, customerId, "other_sessions_revoked", req);
  return { count: deleted.length };
}

export interface CustomerSecurityEventRecord {
  id: string;
  type: string;
  ip: string | null;
  device: string;
  at: string;
}

export async function listCustomerSecurityEvents(db: Db, tenantId: string, customerId: string, limit = 20): Promise<CustomerSecurityEventRecord[]> {
  return withTenant(db, tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(customerSecurityEvents)
      .where(and(eq(customerSecurityEvents.tenantId, tenantId), eq(customerSecurityEvents.customerId, customerId)))
      .orderBy(desc(customerSecurityEvents.createdAt))
      .limit(Math.min(Math.max(limit, 1), 50));
    return rows.map((r) => ({ id: r.id, type: r.type, ip: displayIp(r.ip), device: deviceLabel(r.userAgent), at: r.createdAt.toISOString() }));
  });
}

export interface ChannelConsent {
  sms: boolean;
  whatsapp: boolean;
  updatedAt: string | null;
}

export async function getChannelConsent(db: Db, tenantId: string, customerId: string): Promise<ChannelConsent | null> {
  return withTenant(db, tenantId, async (tx) => {
    const [c] = await tx
      .select({ sms: customers.consentSms, whatsapp: customers.consentWhatsapp, at: customers.channelConsentUpdatedAt })
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId), eq(customers.status, "active")));
    return c ? { sms: c.sms, whatsapp: c.whatsapp, updatedAt: c.at?.toISOString() ?? null } : null;
  });
}

/** The shopper opts in or out of texting and WhatsApp offers. Order updates are not marketing and are not affected. */
export async function setChannelConsent(db: Db, tenantId: string, customerId: string, input: { sms: boolean; whatsapp: boolean }): Promise<ChannelConsent | null> {
  return withTenant(db, tenantId, async (tx) => {
    const [c] = await tx
      .update(customers)
      .set({ consentSms: input.sms, consentWhatsapp: input.whatsapp, channelConsentUpdatedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId), eq(customers.status, "active")))
      .returning({ sms: customers.consentSms, whatsapp: customers.consentWhatsapp, at: customers.channelConsentUpdatedAt });
    return c ? { sms: c.sms, whatsapp: c.whatsapp, updatedAt: c.at?.toISOString() ?? null } : null;
  });
}

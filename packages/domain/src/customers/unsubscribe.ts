import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { type Db, actionTokens, customers, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";

/** Unsubscribe links sit in every marketing email for a long time, so they live a year. */
const UNSUBSCRIBE_TTL_MS = 365 * 86_400_000;

const hashToken = (raw: string): string => createHash("sha256").update(raw.trim()).digest("hex");

export interface UnsubscribeView {
  /** Where the customer stands: still subscribed, already out, or the link is no good. */
  state: "subscribed" | "unsubscribed" | "invalid";
  /** Masked email for the confirmation page, never the full address. */
  maskedEmail?: string;
}

function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

/**
 * Mints an unsubscribe link token for one customer (email templates put `/unsubscribe/{token}` in their footer).
 * Only the sha256 is stored.
 */
export async function mintUnsubscribeToken(db: Db, tenantId: string, customerId: string): Promise<string> {
  const raw = `unsub_${randomBytes(24).toString("hex")}`;
  await withTenant(db, tenantId, async (tx) => {
    const [c] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId)));
    if (!c) throw new Error("Not Found: Customer not found");
    await tx.insert(actionTokens).values({
      tenantId,
      purpose: "unsubscribe",
      targetId: customerId,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + UNSUBSCRIBE_TTL_MS),
    });
  });
  return raw;
}

async function lookup(tx: Db, tenantId: string, token: string) {
  const [row] = await tx
    .select({ id: customers.id, email: customers.email, acceptsMarketing: customers.acceptsMarketing, tokenId: actionTokens.id })
    .from(actionTokens)
    .innerJoin(customers, and(eq(customers.tenantId, actionTokens.tenantId), eq(sql`${customers.id}::text`, actionTokens.targetId)))
    .where(
      and(
        eq(actionTokens.tenantId, tenantId),
        eq(actionTokens.purpose, "unsubscribe"),
        eq(actionTokens.tokenHash, hashToken(token)),
        gt(actionTokens.expiresAt, new Date()),
      ),
    );
  return row ?? null;
}

/** Read-only look at a link, for the confirmation page. Nothing changes on GET. */
export async function getUnsubscribeView(db: Db, tenantId: string, token: string): Promise<UnsubscribeView> {
  return await withTenant(db, tenantId, async (tx) => {
    const row = await lookup(tx, tenantId, token);
    if (!row) return { state: "invalid" };
    return { state: row.acceptsMarketing ? "subscribed" : "unsubscribed", maskedEmail: maskEmail(row.email) };
  });
}

/**
 * Turns marketing off for the customer behind the link (and drops them from the newsletter list). Idempotent: the link
 * can be used again and again, it just reports success. Returns false for an unknown, expired or other-store link.
 */
export async function unsubscribeByToken(db: Db, tenantId: string, token: string): Promise<boolean> {
  return await withTenant(db, tenantId, async (tx) => {
    const row = await lookup(tx, tenantId, token);
    if (!row) return false;

    const { setMarketingConsent } = await import("./consent.ts");
    await setMarketingConsent(
      { _db: { db: tx } } as unknown as Runtime,
      { tenantId, actor: { type: "customer", userId: row.id } },
      {
        customerId: row.id,
        state: "unsubscribed",
        source: "unsubscribe_link",
        channel: "email",
      },
      tx,
    );

    // Remember the first use; later uses keep working so a double click or a forwarded email stays harmless.
    await tx
      .update(actionTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(actionTokens.tenantId, tenantId), eq(actionTokens.id, row.tokenId), isNull(actionTokens.usedAt)));
    return true;
  });
}

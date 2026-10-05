import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { schema, type Db } from "@bs/db";
import type { EmailBrand, EmailOrder } from "./email-templates.ts";

/** Anything that can run tenant-scoped queries: a transaction opened with withTenant(), or a Db. */
type Q = Db;

/** The store's name, public address and support address, for the email header and footer. */
export async function loadEmailBrand(tx: Q, tenantId: string): Promise<EmailBrand> {
  const [tenant] = await tx.select({ slug: schema.tenants.slug, name: schema.tenants.name }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  const [settings] = await tx
    .select({
      storeName: schema.storeSettings.storeName,
      supportEmail: schema.storeSettings.supportEmail,
      notifications: schema.storeSettings.notifications,
    })
    .from(schema.storeSettings)
    .where(eq(schema.storeSettings.tenantId, tenantId))
    .limit(1);
  const [domain] = await tx
    .select({ hostname: schema.domains.hostname })
    .from(schema.domains)
    .where(and(eq(schema.domains.tenantId, tenantId), eq(schema.domains.status, "active")))
    .orderBy(desc(schema.domains.isPrimary), schema.domains.createdAt)
    .limit(1);

  const platformDomain = (process.env.PLATFORM_DOMAIN?.trim() || "bcom.si").toLowerCase();
  const host = domain?.hostname ?? `${tenant?.slug ?? "store"}.${platformDomain}`;
  const notifObj = (settings?.notifications && typeof settings.notifications === "object" ? settings.notifications : {}) as Record<string, unknown>;
  const footerNote = typeof notifObj.footerNote === "string" && notifObj.footerNote.trim() ? notifObj.footerNote.trim() : null;

  return {
    storeName: settings?.storeName || tenant?.name || "Our store",
    baseUrl: `https://${host}`,
    supportEmail: settings?.supportEmail ?? null,
    footerNote,
  };
}

/** An order as the emails show it. */
export async function loadEmailOrder(tx: Q, tenantId: string, orderId: string): Promise<EmailOrder | null> {
  const [order] = await tx.select().from(schema.orders).where(and(eq(schema.orders.tenantId, tenantId), eq(schema.orders.id, orderId))).limit(1);
  if (!order) return null;
  const items = await tx
    .select({ title: schema.orderItems.productTitle, variant: schema.orderItems.variantTitle, quantity: schema.orderItems.quantity, total: schema.orderItems.total })
    .from(schema.orderItems)
    .where(and(eq(schema.orderItems.tenantId, tenantId), eq(schema.orderItems.orderId, orderId)));
  const address = (order.shippingAddress ?? null) as EmailOrder["shippingAddress"];
  return {
    number: order.number,
    placedAt: order.placedAt instanceof Date ? order.placedAt.toISOString() : undefined,
    items: items.map((i) => ({ title: i.title, variant: i.variant, quantity: i.quantity, total: Number(i.total) })),
    subtotal: Number(order.subtotal),
    discountTotal: Number(order.discountTotal ?? 0),
    shippingTotal: Number(order.shippingTotal),
    codFee: Number(order.codFee ?? 0),
    grandTotal: Number(order.grandTotal),
    paymentStatus: order.paymentStatus,
    shippingAddress: address,
  };
}

/**
 * A fresh, 30-day "view this order" link for an email. The raw token is only ever stored hashed, so an email job
 * cannot recover the one shown at checkout: it mints its own.
 */
export async function mintOrderViewUrl(tx: Q, tenantId: string, orderId: string, baseUrl: string): Promise<string> {
  const raw = `ord_${randomBytes(24).toString("hex")}`;
  await tx.insert(schema.actionTokens).values({
    tenantId,
    purpose: "order_view",
    targetId: orderId,
    tokenHash: createHash("sha256").update(raw).digest("hex"),
    expiresAt: new Date(Date.now() + 30 * 86_400_000),
  });
  return `${baseUrl}/o/${raw}`;
}

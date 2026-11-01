import { and, eq, inArray } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";

type Tx = Parameters<Parameters<typeof withTenant>[2]>[0];

/**
 * Removes an online order that was only a hold for a payment that never completed (it has a temporary `PEND-` number, was
 * never announced and never paid), together with its stock reservation, discount use, payment records and tokens. Returns the
 * order's lines so the caller can put them back in the cart. The caller must have checked that the order is an unpaid hold.
 */
export async function deleteHeldOrder(tx: Tx, tenantId: string, id: string) {
  const intents = await tx.select({ id: schema.paymentIntents.id }).from(schema.paymentIntents).where(and(eq(schema.paymentIntents.tenantId, tenantId), eq(schema.paymentIntents.orderId, id)));
  if (intents.length > 0) {
    await tx.delete(schema.paymentAttempts).where(and(eq(schema.paymentAttempts.tenantId, tenantId), inArray(schema.paymentAttempts.intentId, intents.map((i) => i.id))));
    await tx.delete(schema.paymentIntents).where(and(eq(schema.paymentIntents.tenantId, tenantId), eq(schema.paymentIntents.orderId, id)));
  }
  await tx.delete(schema.discountRedemptions).where(and(eq(schema.discountRedemptions.tenantId, tenantId), eq(schema.discountRedemptions.orderId, id)));
  await tx.delete(schema.inventoryReservations).where(and(eq(schema.inventoryReservations.tenantId, tenantId), eq(schema.inventoryReservations.orderId, id)));
  await tx.delete(schema.orderNotes).where(and(eq(schema.orderNotes.tenantId, tenantId), eq(schema.orderNotes.orderId, id)));
  await tx.delete(schema.orderEvents).where(and(eq(schema.orderEvents.tenantId, tenantId), eq(schema.orderEvents.orderId, id)));
  await tx.delete(schema.actionTokens).where(and(eq(schema.actionTokens.tenantId, tenantId), eq(schema.actionTokens.targetId, id)));
  await tx.update(schema.quoteRequests).set({ orderId: null }).where(and(eq(schema.quoteRequests.tenantId, tenantId), eq(schema.quoteRequests.orderId, id)));
  const items = await tx.select().from(schema.orderItems).where(and(eq(schema.orderItems.tenantId, tenantId), eq(schema.orderItems.orderId, id)));
  await tx.delete(schema.orderItems).where(and(eq(schema.orderItems.tenantId, tenantId), eq(schema.orderItems.orderId, id)));
  await tx.delete(schema.orders).where(and(eq(schema.orders.tenantId, tenantId), eq(schema.orders.id, id)));
  return items;
}

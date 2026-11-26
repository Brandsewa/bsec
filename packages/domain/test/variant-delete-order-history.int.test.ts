import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { STORE_PERMISSIONS } from "@bs/auth";
import {
  cancelAdminOrder,
  createRuntime,
  createVariant,
  deleteVariant,
  getReturnableItems,
  provisionTenant,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import { createActiveProduct, createDeliveredCodOrder, createGuestCheckout } from "./helpers/factories.ts";

/**
 * Deleting a variant that was ordered (owner report 2026-11-26: a cancelled test order blocked the delete for good).
 * Allowed once every order with it is cancelled, returned or delivered; the order lines keep their own details and lose
 * only the link (migration 0122). Runs as app_rw, so Row Level Security applies as in production.
 */
let env: TestDb;
let rt: Runtime;
let rtWeb: Runtime;
let ctx: TenantContext;

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  const t = await provisionTenant(rt, { storeName: "vdel", slug: "vdel", owner: { email: "owner@vdel.test", name: "Owner" }, planCode: "starter", source: "platform_admin" });
  ctx = { tenantId: t.tenantId, storeStatus: "live", actor: { type: "staff", userId: t.ownerId }, roles: ["store_owner"], permissions: [...STORE_PERMISSIONS], requestId: "req-vdel" };
}, 180_000);

afterAll(async () => {
  await rtWeb?.close();
  await rt?.close();
  await env?.stop();
});

/** A product with the variant under test plus a spare, so "a product needs at least one variant" never gets in the way. */
async function productWithSpare(title: string, sku: string) {
  const p = await createActiveProduct(rtWeb, ctx, { title, sku, price: 49_900, stock: 20 });
  await createVariant(rtWeb, ctx, { productId: p.productId, sku: `${sku}-SPARE`, title: "Spare", price: 1_000 });
  return p;
}

const linesFor = (orderId: string) =>
  withTenant(rt._db.db, ctx.tenantId, (tx) => tx.select().from(schema.orderItems).where(and(eq(schema.orderItems.tenantId, ctx.tenantId), eq(schema.orderItems.orderId, orderId))));

describe("deleting a variant that has orders", () => {
  it("is refused while an order is in progress, and allowed once it is cancelled; the order keeps its details", async () => {
    const p = await productWithSpare("Cancelled Tea", "VDEL-CXL");
    const order = await createGuestCheckout(rtWeb, ctx, { variantId: p.variantId });

    await expect(deleteVariant(rtWeb, ctx, { id: p.variantId })).rejects.toThrow(new RegExp(`still in progress \\(${order.orderNumber}\\)`));

    // A review of the variant used to block the delete too (two-column ON DELETE SET NULL also cleared tenant_id).
    await withTenant(rt._db.db, ctx.tenantId, (tx) =>
      tx.insert(schema.reviews).values({ tenantId: ctx.tenantId, productId: p.productId, variantId: p.variantId, reviewerName: "R", rating: 5, body: "Good" }),
    );

    await cancelAdminOrder(rtWeb, ctx, { id: order.orderId, reason: "test order" });
    await expect(deleteVariant(rtWeb, ctx, { id: p.variantId })).resolves.toEqual({ success: true });

    const [line] = await linesFor(order.orderId);
    expect(line).toBeDefined();
    expect(line!.variantId).toBeNull();
    expect(line!.tenantId).toBe(ctx.tenantId);
    expect(line!.sku).toBe("VDEL-CXL");
    expect(line!.productTitle).toBe("Cancelled Tea");
    expect(Number(line!.unitPrice)).toBe(49_900);

    const reviews = await withTenant(rt._db.db, ctx.tenantId, (tx) => tx.select().from(schema.reviews).where(eq(schema.reviews.productId, p.productId)));
    expect(reviews).toHaveLength(1);
    expect(reviews[0]!.variantId).toBeNull();
  });

  it("is allowed once the order is delivered, and the line can still be returned (refund, nothing to restock)", async () => {
    const p = await productWithSpare("Delivered Tea", "VDEL-DLV");
    const order = await createDeliveredCodOrder(rtWeb, ctx, { variantId: p.variantId, locationId: p.locationId });

    await expect(deleteVariant(rtWeb, ctx, { id: p.variantId })).resolves.toEqual({ success: true });

    const [line] = await linesFor(order.orderId);
    expect(line!.variantId).toBeNull();
    expect(line!.sku).toBe("VDEL-DLV");

    const returnable = await withTenant(rtWeb._db.db, ctx.tenantId, (tx) => getReturnableItems(tx, ctx.tenantId, order.orderId));
    expect(returnable.find((i) => i.id === line!.id)?.returnable).toBe(1);
  });
});

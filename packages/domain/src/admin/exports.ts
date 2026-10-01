import { and, desc, eq, isNull } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";

export type ExportKind = "orders" | "customers" | "products";

const MAX_ROWS = 10_000;

/** One CSV field. A leading = + - @ would be run as a formula by Excel/Sheets, so it is defanged with a quote. */
export function csvField(value: unknown): string {
  let s = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}

const rupees = (paise: number | bigint) => (Number(paise) / 100).toFixed(2);

/** The store's data as a spreadsheet the merchant can keep. Money columns are in rupees. */
export async function exportCsv(rt: Runtime, ctx: TenantContext, input: { kind: ExportKind }) {
  assertPermission(ctx, input.kind === "orders" ? "orders.read" : input.kind === "customers" ? "customers.read" : "products.read");
  const day = new Date().toISOString().slice(0, 10);

  return await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    if (input.kind === "orders") {
      const rows = await tx
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.tenantId, ctx.tenantId))
        .orderBy(desc(schema.orders.placedAt))
        .limit(MAX_ROWS);
      return {
        filename: `orders-${day}.csv`,
        csv: toCsv(
          ["Order", "Placed at", "Status", "Payment", "Fulfilment", "Email", "Phone", "Subtotal", "Discount", "Shipping", "COD fee", "Tax", "Total"],
          rows.map((o) => [o.number, o.placedAt, o.status, o.paymentStatus, o.fulfillmentStatus, o.email, o.phone, rupees(o.subtotal), rupees(o.discountTotal), rupees(o.shippingTotal), rupees(o.codFee), rupees(o.taxTotal), rupees(o.grandTotal)]),
        ),
      };
    }
    if (input.kind === "customers") {
      const rows = await tx
        .select()
        .from(schema.customers)
        .where(and(eq(schema.customers.tenantId, ctx.tenantId), isNull(schema.customers.deletedAt)))
        .orderBy(desc(schema.customers.createdAt))
        .limit(MAX_ROWS);
      return {
        filename: `customers-${day}.csv`,
        csv: toCsv(
          ["Name", "Email", "Phone", "Orders", "Total spent", "Last order", "Accepts marketing", "Tags", "Joined"],
          rows.map((c) => [c.name, c.email, c.phone, c.ordersCount, rupees(c.totalSpent), c.lastOrderAt, c.acceptsMarketing ? "yes" : "no", c.tags.join("; "), c.createdAt]),
        ),
      };
    }
    const rows = await tx
      .select({ title: schema.products.title, status: schema.products.status, type: schema.products.productType, sku: schema.variants.sku, variant: schema.variants.title, price: schema.variants.price, compareAt: schema.variants.compareAtPrice })
      .from(schema.variants)
      .innerJoin(schema.products, and(eq(schema.products.tenantId, schema.variants.tenantId), eq(schema.products.id, schema.variants.productId)))
      .where(eq(schema.variants.tenantId, ctx.tenantId))
      .orderBy(schema.products.title)
      .limit(MAX_ROWS);
    return {
      filename: `products-${day}.csv`,
      csv: toCsv(
        ["Product", "Status", "Type", "SKU", "Variant", "Price", "Compare-at price"],
        rows.map((p) => [p.title, p.status, p.type, p.sku, p.variant === "Default" ? "" : p.variant, rupees(p.price), p.compareAt === null ? "" : rupees(p.compareAt)]),
      ),
    };
  });
}

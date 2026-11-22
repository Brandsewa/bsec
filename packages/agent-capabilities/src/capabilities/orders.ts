import { z } from "zod";
import { getAdminOrderDetail, getAdminOrderStats, listAdminOrders } from "@bs/domain";
import { canAccess } from "../policy.ts";
import { pageInput, pageParams, toPage } from "../shape.ts";
import { defineCapability } from "../types.ts";

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use yyyy-mm-dd");

/** Customer name, email, phone and addresses appear in orders only when the store also allows AI to read customers. */
const canSeeContact = (s: Parameters<typeof canAccess>[0]) => canAccess(s, "customers", "read");

export const listOrdersCap = defineCapability({
  name: "list_orders",
  title: "List orders",
  description:
    "Recent orders, newest first, with status, payment and fulfilment state and total. Filter by view (unfulfilled, unpaid, open), status or a placed date range. Totals are in minor units (paise). Customer contact details appear only if the store allows AI to read customers.",
  resource: "orders",
  action: "read",
  kind: "read",
  userText: true,
  annotations: { readOnly: true, destructive: false, idempotent: true },
  input: z.object({
    view: z.enum(["all", "unfulfilled", "unpaid", "cod_to_confirm", "open", "closed"]).optional(),
    status: z.string().max(30).optional(),
    paymentStatus: z.string().max(30).optional(),
    fulfillmentStatus: z.string().max(30).optional(),
    search: z.string().max(100).optional().describe("Order number, or customer name or email when allowed."),
    placedFrom: Day.optional(),
    placedTo: Day.optional(),
    ...pageInput,
  }),
  async handler({ rt, session }, input) {
    const { limit, offset } = pageParams(input);
    const contact = canSeeContact(session);
    const r = await listAdminOrders(rt, session.ctx, {
      view: input.view,
      status: input.status,
      paymentStatus: input.paymentStatus,
      fulfillmentStatus: input.fulfillmentStatus,
      ...(contact && input.search ? { search: input.search } : input.search && /^[A-Za-z0-9-]{1,20}$/.test(input.search) ? { search: input.search } : {}),
      placedFrom: input.placedFrom,
      placedTo: input.placedTo,
      sort: "placed_desc",
      limit,
      offset,
    });
    return toPage(
      r.items.map((o) => ({
        id: o.id,
        number: o.number,
        placedAt: o.placedAt,
        status: o.status,
        paymentStatus: o.paymentStatus,
        fulfillmentStatus: o.fulfillmentStatus,
        total: o.grandTotal,
        currency: o.currency ?? session.currency,
        items: o.itemsCount,
        firstItem: o.firstItemTitle,
        ...(contact ? { customerName: o.customerName, customerEmail: o.customerEmail, customerPhone: o.customerPhone } : {}),
      })),
      r.total,
      offset,
      limit,
    );
  },
});

export const getOrderCap = defineCapability({
  name: "get_order",
  title: "Get an order",
  description: "One order with items, totals, fulfilment and tracking, and its timeline. Shipping address and customer contact details appear only if the store allows AI to read customers. Amounts are in minor units (paise).",
  resource: "orders",
  action: "read",
  kind: "read",
  userText: true,
  annotations: { readOnly: true, destructive: false, idempotent: true },
  input: z.object({ id: z.string().uuid().describe("The order id from list_orders.") }),
  async handler({ rt, session }, input) {
    const d = await getAdminOrderDetail(rt, session.ctx, { id: input.id });
    const contact = canSeeContact(session);
    const o = d.order;
    return {
      id: o.id,
      number: o.number,
      placedAt: o.placedAt,
      status: o.status,
      paymentStatus: o.paymentStatus,
      fulfillmentStatus: o.fulfillmentStatus,
      currency: o.currency,
      subtotal: o.subtotal,
      discountTotal: o.discountTotal,
      shippingTotal: o.shippingTotal,
      taxTotal: o.taxTotal,
      codFee: o.codFee,
      total: o.grandTotal,
      tags: o.tags,
      cancelReason: o.cancelReason,
      ...(contact ? { email: o.email, phone: o.phone, shippingAddress: o.shippingAddress, billingAddress: o.billingAddress } : { contactDetails: "Hidden: the store has not allowed AI to read customers." }),
      items: d.items.map((i) => ({ product: i.productTitle, variant: i.variantTitle, sku: i.sku, quantity: i.quantity, unitPrice: i.unitPrice, total: i.total, fulfilled: i.fulfilledQty, returned: i.returnedQty })),
      fulfillments: d.fulfillments.map((f) => ({ status: f.status, carrier: f.carrier, awb: f.awb, trackingUrl: f.trackingUrl, shippedAt: f.shippedAt, deliveredAt: f.deliveredAt })),
      discounts: d.discounts.map((x) => ({ code: x.code, title: x.title, amount: x.amount })),
      timeline: d.events.slice(-15).map((e) => ({ type: e.type, message: e.message, at: e.createdAt })),
      notes: d.notes.slice(-10).map((n) => ({ body: n.body, at: n.createdAt })),
    };
  },
});

export const getOrderStatsCap = defineCapability({
  name: "get_order_stats",
  title: "Order counts and revenue",
  description: "Totals across the store: orders, open orders, paid orders, revenue and average order value (minor units).",
  resource: "orders",
  action: "read",
  kind: "report",
  annotations: { readOnly: true, destructive: false, idempotent: true },
  input: z.object({}),
  async handler({ rt, session }) {
    const s = await getAdminOrderStats(rt, session.ctx);
    return { ...s, currency: session.currency };
  },
});

export const orderCapabilities = [listOrdersCap, getOrderCap, getOrderStatsCap];

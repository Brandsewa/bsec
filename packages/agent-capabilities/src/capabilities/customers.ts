import { z } from "zod";
import { getAdminCustomerDetail, listAdminCustomers } from "@bs/domain";
import { pageInput, pageParams, toPage } from "../shape.ts";
import { defineCapability } from "../types.ts";

export const listCustomersCap = defineCapability({
  name: "list_customers",
  title: "List customers",
  description: "Customers with name, email, phone, number of orders and total spent (minor units). Search by name, email or phone.",
  resource: "customers",
  action: "read",
  kind: "read",
  userText: true,
  annotations: { readOnly: true, destructive: false, idempotent: true },
  input: z.object({
    search: z.string().max(100).optional(),
    view: z.enum(["all", "accounts", "guests"]).optional(),
    repeat: z.boolean().optional().describe("Only customers with more than one order."),
    ...pageInput,
  }),
  async handler({ rt, session }, input) {
    const { limit, offset } = pageParams(input);
    const r = await listAdminCustomers(rt, session.ctx, { search: input.search, view: input.view, repeat: input.repeat, sort: "created_desc", limit, offset });
    return toPage(
      r.items.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        orders: c.ordersCount,
        totalSpent: c.totalSpent,
        currency: session.currency,
        lastOrderAt: c.lastOrderAt,
        tags: c.tags,
        guest: c.isGuest,
        blocked: c.status === "blocked",
      })),
      r.total,
      offset,
      limit,
    );
  },
});

export const getCustomerCap = defineCapability({
  name: "get_customer",
  title: "Get a customer",
  description: "One customer with contact details, saved addresses and recent orders.",
  resource: "customers",
  action: "read",
  kind: "read",
  userText: true,
  annotations: { readOnly: true, destructive: false, idempotent: true },
  input: z.object({ id: z.string().uuid() }),
  async handler({ rt, session }, input) {
    const d = await getAdminCustomerDetail(rt, session.ctx, { id: input.id });
    const c = d.customer;
    return {
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      guest: c.isGuest,
      blocked: c.status === "blocked",
      orders: c.ordersCount,
      totalSpent: c.totalSpent,
      averageOrderValue: c.averageOrderValue,
      currency: session.currency,
      firstOrderAt: c.firstOrderAt,
      lastOrderAt: c.lastOrderAt,
      tags: c.tags,
      addresses: d.addresses.map((a) => ({ name: a.name, phone: a.phone, line1: a.line1, line2: a.line2, city: a.city, state: a.stateCode, pincode: a.pincode, default: a.isDefault })),
      recentOrders: d.recentOrders.slice(0, 10).map((o) => ({ id: o.id, number: o.number, status: o.status, total: o.grandTotal, placedAt: o.placedAt })),
    };
  },
});

export const customerCapabilities = [listCustomersCap, getCustomerCap];

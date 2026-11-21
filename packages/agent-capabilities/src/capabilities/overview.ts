import { z } from "zod";
import { AI_ACTIONS, AI_RESOURCES, getAdminOrderStats, listInventoryLevels, listProducts } from "@bs/domain";
import { canAccess } from "../policy.ts";
import { defineCapability } from "../types.ts";

export const getStoreOverviewCap = defineCapability({
  name: "get_store_overview",
  title: "Store overview",
  description:
    "Call this first. Returns the store name, currency and time zone, which things this connection is allowed to read, change or archive, whether publishing is allowed, and quick counts for the allowed areas.",
  resource: null,
  action: null,
  kind: "read",
  annotations: { readOnly: true, destructive: false, idempotent: true },
  input: z.object({}),
  async handler({ rt, session }) {
    const allowed: Record<string, string[]> = {};
    for (const resource of AI_RESOURCES) {
      const actions = AI_ACTIONS.filter((a) => canAccess(session, resource, a));
      if (actions.length) allowed[resource] = [...actions];
    }
    const counts: Record<string, unknown> = {};
    if (canAccess(session, "products", "read")) {
      const [all, drafts, active, low] = await Promise.all([
        listProducts(rt, session.ctx, { limit: 1 }),
        listProducts(rt, session.ctx, { limit: 1, status: "draft" }),
        listProducts(rt, session.ctx, { limit: 1, status: "active" }),
        listInventoryLevels(rt, session.ctx, { limit: 1, stock: "low" }),
      ]);
      counts.products = { total: all.total, drafts: drafts.total, published: active.total, lowStockVariants: low.total };
    }
    if (canAccess(session, "orders", "read")) {
      const s = await getAdminOrderStats(rt, session.ctx);
      counts.orders = { total: s.totalOrders, open: s.openOrders, paid: s.paidOrders };
    }
    return {
      store: session.storeName,
      currency: session.currency,
      timezone: session.timezone,
      connectedApp: session.connection.clientName,
      allowed,
      canPublish: session.settings.allowPublishing && canAccess(session, "products", "write"),
      counts,
      tips: "Money is in minor units (paise). Writes create drafts unless publishing is allowed. Ask the store owner to change permissions in Settings > AI access.",
    };
  },
});

export const overviewCapabilities = [getStoreOverviewCap];

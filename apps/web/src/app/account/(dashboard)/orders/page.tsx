import React from "react";
import Link from "next/link";
import { getCustomerOrders } from "@bs/domain";
import { accountContext } from "@/server/customer-session.ts";
import { OrdersTable } from "@/components/account/OrdersTable.tsx";

export default async function PurchaseHistoryPage() {
  const ctx = await accountContext();
  if (!ctx) return null;
  const orders = await getCustomerOrders(ctx.store.rt._db.db, ctx.store.tenantId, ctx.customer.id);

  if (orders.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-6 text-center" data-testid="no-orders">
        <p className="text-sm text-[var(--muted-foreground)]">You have not placed any orders yet.</p>
        <Link href="/collections" className="mt-3 inline-block text-sm font-semibold text-[var(--brand-ink)] hover:opacity-70 transition-opacity">
          Start shopping
        </Link>
      </div>
    );
  }

  return (
    <div data-testid="orders-list">
      <OrdersTable orders={orders} />
    </div>
  );
}

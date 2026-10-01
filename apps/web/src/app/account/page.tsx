import React from "react";
import Link from "next/link";
import { getCustomerOrders } from "@bs/domain";
import { accountContext } from "@/server/customer-session.ts";

const money = (paise: number) => `₹${(paise / 100).toFixed(2)}`;
const label = (s: string) => s.replace(/_/g, " ");

export default async function AccountOrdersPage() {
  const ctx = await accountContext();
  if (!ctx) return null;
  const orders = await getCustomerOrders(ctx.store.rt._db.db, ctx.store.tenantId, ctx.customer.id);

  if (orders.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm" data-testid="no-orders">
        <p className="text-sm text-muted-foreground">You have not placed any orders yet.</p>
        <Link href="/collections" className="mt-3 inline-block text-sm font-medium text-primary hover:underline">
          Start shopping
        </Link>
      </div>
    );
  }

  return (
    <ul className="space-y-3" data-testid="orders-list">
      {orders.map((o) => (
        <li key={o.id}>
          <Link
            href={`/account/orders/${o.id}`}
            className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 shadow-sm transition-colors hover:bg-muted sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <div className="font-semibold text-foreground">{o.number}</div>
              <div className="text-xs text-muted-foreground">{o.placedAt.toISOString().slice(0, 10)}</div>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase text-primary">{label(o.status)}</span>
              <span className="font-semibold text-foreground">{money(o.grandTotal)}</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

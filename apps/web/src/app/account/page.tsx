import React from "react";
import Link from "next/link";
import { getCustomerOrders } from "@bs/domain";
import { accountContext } from "@/server/customer-session.ts";
import { StatusBadge, Money, RelativeTime, type StatusTone } from "@bs/ui";

function mapStatusToTone(status: string): StatusTone {
  switch (status.toLowerCase()) {
    case "placed":
    case "confirmed":
      return "info";
    case "processing":
      return "warning";
    case "shipped":
    case "delivered":
    case "fulfilled":
    case "paid":
      return "success";
    case "cancelled":
    case "failed":
    case "returned":
      return "destructive";
    default:
      return "neutral";
  }
}

export default async function AccountOrdersPage() {
  const ctx = await accountContext();
  if (!ctx) return null;
  const orders = await getCustomerOrders(ctx.store.rt._db.db, ctx.store.tenantId, ctx.customer.id);

  if (orders.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-8 text-center shadow-xs" data-testid="no-orders">
        <p className="text-sm text-[var(--muted-foreground)]">You have not placed any orders yet.</p>
        <Link href="/collections" className="mt-3 inline-block text-sm font-semibold text-[var(--brand-ink)] hover:underline">
          Start shopping
        </Link>
      </div>
    );
  }

  return (
    <div data-testid="orders-list" className="space-y-4">
      {/* Mobile Card List */}
      <ul className="space-y-3 md:hidden">
        {orders.map((o) => (
          <li key={o.id}>
            <Link
              href={`/account/orders/${o.id}`}
              className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-xs transition-colors hover:bg-[var(--muted)]"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm text-[var(--foreground)]">{o.number}</span>
                <StatusBadge tone={mapStatusToTone(o.status)} label={o.status.replace(/_/g, " ")} />
              </div>
              <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
                <RelativeTime date={o.placedAt} />
                <span className="font-semibold text-sm text-[var(--foreground)]">
                  <Money paise={o.grandTotal} />
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {/* Desktop Simple Table */}
      <div className="hidden md:block overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-xs">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-[var(--border)] bg-[var(--muted)] text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            <tr>
              <th className="px-4 py-3">Order</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-soft)]">
            {orders.map((o) => (
              <tr key={o.id} className="hover:bg-[var(--muted)] transition-colors">
                <td className="px-4 py-3.5 font-semibold text-[var(--foreground)]">
                  <Link href={`/account/orders/${o.id}`} className="hover:underline">
                    {o.number}
                  </Link>
                </td>
                <td className="px-4 py-3.5 text-xs text-[var(--muted-foreground)]">
                  <RelativeTime date={o.placedAt} />
                </td>
                <td className="px-4 py-3.5">
                  <StatusBadge tone={mapStatusToTone(o.status)} label={o.status.replace(/_/g, " ")} />
                </td>
                <td className="px-4 py-3.5 text-right font-medium tabular-nums text-[var(--foreground)]">
                  <Money paise={o.grandTotal} />
                </td>
                <td className="px-4 py-3.5 text-right">
                  <Link
                    href={`/account/orders/${o.id}`}
                    className="text-xs font-semibold text-[var(--brand-ink)] hover:underline"
                  >
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

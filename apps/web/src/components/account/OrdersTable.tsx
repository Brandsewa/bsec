import React from "react";
import Link from "next/link";
import { StatusBadge, Money, RelativeTime } from "@bs/ui";
import type { CustomerOrderSummary } from "@bs/domain";
import { describeOrderStatus } from "@/components/orders/order-labels.ts";

const TONE = { good: "success", bad: "destructive", neutral: "neutral" } as const;

function Status({ status, fulfillmentStatus }: { status: string; fulfillmentStatus: string }) {
  // a parcel the courier is sending back reads "On its way" by order status alone, which would mislead
  if (fulfillmentStatus === "rto" || fulfillmentStatus === "rto_delivered") {
    return <StatusBadge tone="neutral" label={fulfillmentStatus === "rto" ? "Returning to seller" : "Returned to seller"} />;
  }
  const s = describeOrderStatus(status);
  return <StatusBadge tone={TONE[s.tone]} label={s.label} />;
}

/** Order, date, status, total and a View link: cards on phones, a table from md up. Shared by the dashboard and the orders list. */
export function OrdersTable({ orders }: { orders: CustomerOrderSummary[] }) {
  return (
    <div className="space-y-4">
      <ul className="space-y-3 md:hidden">
        {orders.map((o) => (
          <li key={o.id}>
            <Link
              href={`/account/orders/${o.id}`}
              className="flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--muted)] p-4 transition-colors hover:bg-[var(--background)]"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-[var(--foreground)]">{o.number}</span>
                <Status status={o.status} fulfillmentStatus={o.fulfillmentStatus} />
              </div>
              <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
                <RelativeTime date={o.placedAt} />
                <span className="text-sm font-semibold text-[var(--foreground)]">
                  <Money paise={o.grandTotal} />
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      <div className="hidden overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--muted)] md:block">
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
              <tr key={o.id} className="transition-colors hover:bg-[var(--background)]">
                <td className="px-4 py-3.5 font-semibold text-[var(--foreground)]">
                  <Link href={`/account/orders/${o.id}`} className="transition-opacity hover:opacity-70">
                    {o.number}
                  </Link>
                </td>
                <td className="px-4 py-3.5 text-xs text-[var(--muted-foreground)]">
                  <RelativeTime date={o.placedAt} />
                </td>
                <td className="px-4 py-3.5">
                  <Status status={o.status} fulfillmentStatus={o.fulfillmentStatus} />
                </td>
                <td className="px-4 py-3.5 text-right font-medium tabular-nums text-[var(--foreground)]">
                  <Money paise={o.grandTotal} />
                </td>
                <td className="px-4 py-3.5 text-right">
                  <Link href={`/account/orders/${o.id}`} className="text-xs font-semibold text-[var(--brand-ink)] transition-opacity hover:opacity-70">
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

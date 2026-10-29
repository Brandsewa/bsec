import React from "react";
import Link from "next/link";
import { getCustomerReturnableOrders, getCustomerReturns } from "@bs/domain";
import { accountContext } from "@/server/customer-session.ts";
import { StatusBadge, Money, RelativeTime } from "@bs/ui";
import { ReturnRequestDialog } from "@/components/account/ReturnRequestDialog.tsx";
import { describeReturnStatus } from "@/components/account/return-labels.ts";

export default async function ReturnsPage({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  const ctx = await accountContext();
  if (!ctx) return null;
  const { request } = await searchParams;
  const db = ctx.store.rt._db.db;
  const [eligible, mine] = await Promise.all([
    getCustomerReturnableOrders(db, ctx.store.tenantId, ctx.customer.id),
    getCustomerReturns(db, ctx.store.tenantId, ctx.customer.id),
  ]);

  return (
    <div className="space-y-8" data-testid="returns-page">
      <section>
        <h2 className="mb-1 text-lg font-bold">Eligible for return</h2>
        <p className="mb-3 text-sm text-[var(--muted-foreground)]">Delivered orders with items you can still send back.</p>
        {!eligible.enabled ? (
          <p className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-4 text-sm text-[var(--muted-foreground)]">
            This store is not taking returns online right now. Please contact the store if you need help with an order.
          </p>
        ) : eligible.orders.length === 0 ? (
          <p className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-4 text-sm text-[var(--muted-foreground)]">
            Nothing to return yet. Orders show up here once they are delivered.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border-soft)] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--muted)]">
            {eligible.orders.map((o) => (
              <li key={o.orderId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <Link href={`/account/orders/${o.orderId}`} className="font-semibold text-[var(--foreground)] hover:opacity-70">
                    {o.number}
                  </Link>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    <RelativeTime date={o.placedAt} /> · {o.returnableUnits} {o.returnableUnits === 1 ? "item" : "items"} returnable
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-medium tabular-nums">
                    <Money paise={o.grandTotal} />
                  </span>
                  <ReturnRequestDialog orderId={o.orderId} orderNumber={o.number} autoOpen={request === o.orderId} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">My returns</h2>
        {mine.length === 0 ? (
          <p className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-4 text-sm text-[var(--muted-foreground)]" data-testid="no-returns">
            You have not asked to return anything.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--muted)]">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[var(--border)] text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                <tr>
                  <th className="px-4 py-3">Return</th>
                  <th className="hidden px-4 py-3 sm:table-cell">Order</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-soft)]">
                {mine.map((r) => {
                  const st = describeReturnStatus(r.status);
                  return (
                    <tr key={r.id} className="transition-colors hover:bg-[var(--background)]">
                      <td className="px-4 py-3.5 font-semibold text-[var(--foreground)]">
                        <Link href={`/account/returns/${r.id}`} className="hover:opacity-70">
                          {r.number}
                        </Link>
                        <p className="text-xs font-normal text-[var(--muted-foreground)]">
                          {r.units} {r.units === 1 ? "item" : "items"} · {r.resolution === "replacement" ? "Exchange" : "Refund"}
                        </p>
                      </td>
                      <td className="hidden px-4 py-3.5 text-xs sm:table-cell">
                        <Link href={`/account/orders/${r.orderId}`} className="text-[var(--muted-foreground)] hover:opacity-70">
                          {r.orderNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-3.5 text-xs text-[var(--muted-foreground)]">
                        <RelativeTime date={r.createdAt} />
                      </td>
                      <td className="px-4 py-3.5">
                        <StatusBadge tone={st.tone} label={st.label} />
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <Link href={`/account/returns/${r.id}`} className="text-xs font-semibold text-[var(--brand-ink)] hover:opacity-70">
                          View
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

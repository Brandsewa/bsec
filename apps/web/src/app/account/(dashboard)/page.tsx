import React from "react";
import Link from "next/link";
import { getCustomerOrders } from "@bs/domain";
import { accountContext } from "@/server/customer-session.ts";
import { Money, RelativeTime } from "@bs/ui";

const shortcuts = [
  { href: "/account/orders", label: "Purchase History", hint: "Track and review your orders" },
  { href: "/account/reviews", label: "My Reviews", hint: "What you have said about products" },
  { href: "/account/addresses", label: "Address", hint: "Where we deliver" },
  { href: "/account/profile", label: "Profile", hint: "Your details and password" },
];

export default async function AccountDashboardPage() {
  const ctx = await accountContext();
  if (!ctx) return null;
  const orders = await getCustomerOrders(ctx.store.rt._db.db, ctx.store.tenantId, ctx.customer.id);
  const spent = orders.reduce((sum, o) => sum + o.grandTotal, 0);
  const recent = orders.slice(0, 3);
  return (
    <div className="space-y-8" data-testid="account-dashboard">
      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <div className="rounded-xl bg-[var(--muted)] p-4">
          <p className="text-xs text-[var(--muted-foreground)]">Orders</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{orders.length}</p>
        </div>
        <div className="rounded-xl bg-[var(--muted)] p-4">
          <p className="text-xs text-[var(--muted-foreground)]">Total spent</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">
            <Money paise={spent} />
          </p>
        </div>
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">Recent orders</h2>
          {orders.length > 0 && (
            <Link href="/account/orders" className="text-sm font-semibold text-[var(--brand-ink)] hover:underline">
              View all
            </Link>
          )}
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            You have not placed any orders yet.{" "}
            <Link href="/collections" className="font-semibold text-[var(--brand-ink)] hover:underline">
              Start shopping
            </Link>
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border-soft)] rounded-xl bg-[var(--muted)]/50">
            {recent.map((o) => (
              <li key={o.id}>
                <Link href={`/account/orders/${o.id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-[var(--muted)]">
                  <span className="font-semibold">{o.number}</span>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    <RelativeTime date={o.placedAt} />
                  </span>
                  <span className="font-medium tabular-nums">
                    <Money paise={o.grandTotal} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        {shortcuts.map((s) => (
          <Link key={s.href} href={s.href} className="rounded-xl bg-[var(--muted)]/50 p-4 transition-colors hover:bg-[var(--muted)]">
            <p className="text-sm font-semibold">{s.label}</p>
            <p className="text-xs text-[var(--muted-foreground)]">{s.hint}</p>
          </Link>
        ))}
      </section>
    </div>
  );
}

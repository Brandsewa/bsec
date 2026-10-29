import React from "react";
import Link from "next/link";
import { getCustomerOrders, getCustomerDashboardStats } from "@bs/domain";
import { accountContext } from "@/server/customer-session.ts";
import { OrdersTable } from "@/components/account/OrdersTable.tsx";

const shortcuts = [
  { href: "/account/orders", label: "Orders", hint: "Track and review your orders" },
  { href: "/account/reviews", label: "My Reviews", hint: "What you have said about products" },
  { href: "/account/addresses", label: "Address", hint: "Where we deliver" },
  { href: "/account/profile", label: "Profile", hint: "Your details and password" },
];

export default async function AccountDashboardPage() {
  const ctx = await accountContext();
  if (!ctx) return null;
  const orders = await getCustomerOrders(ctx.store.rt._db.db, ctx.store.tenantId, ctx.customer.id);
  const stats = await getCustomerDashboardStats(ctx.store.rt._db.db, ctx.store.tenantId, ctx.customer.id);
  const cards = [
    { label: "Active orders", value: stats.active },
    { label: "In transit", value: stats.inTransit },
    { label: "In return", value: stats.inReturn },
    { label: "Delivered", value: stats.delivered },
  ];
  const recent = orders.slice(0, 3);
  return (
    <div className="space-y-8" data-testid="account-dashboard">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-4">
            <p className="text-xs text-[var(--muted-foreground)]">{c.label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{c.value}</p>
          </div>
        ))}
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">Recent orders</h2>
          {orders.length > 0 && (
            <Link href="/account/orders" className="text-sm font-semibold text-[var(--brand-ink)] hover:opacity-70 transition-opacity">
              View all
            </Link>
          )}
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            You have not placed any orders yet.{" "}
            <Link href="/collections" className="font-semibold text-[var(--brand-ink)] hover:opacity-70 transition-opacity">
              Start shopping
            </Link>
          </p>
        ) : (
          <OrdersTable orders={recent} />
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        {shortcuts.map((s) => (
          <Link key={s.href} href={s.href} className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-4 transition-colors hover:bg-[var(--background)]">
            <p className="text-sm font-semibold">{s.label}</p>
            <p className="text-xs text-[var(--muted-foreground)]">{s.hint}</p>
          </Link>
        ))}
      </section>
    </div>
  );
}

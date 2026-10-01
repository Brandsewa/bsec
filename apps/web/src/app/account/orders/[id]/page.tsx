import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCustomerOrderDetail } from "@bs/domain";
import { accountContext } from "@/server/customer-session.ts";

const money = (paise: number) => `₹${(paise / 100).toFixed(2)}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function addressLines(raw: unknown): string[] {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return [s(a.fullName), s(a.addressLine1), s(a.addressLine2), [s(a.city), s(a.state), s(a.pincode)].filter(Boolean).join(", ")].filter(Boolean);
}

export default async function AccountOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await accountContext();
  if (!ctx) return null;
  if (!UUID.test(id)) notFound();
  const order = await getCustomerOrderDetail(ctx.store.rt._db.db, ctx.store.tenantId, ctx.customer.id, id);
  if (!order) notFound();

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
      <div className="flex flex-col gap-2 border-b border-border pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Order</span>
          <h2 className="text-2xl font-extrabold text-foreground">{order.number}</h2>
          <p className="text-xs text-muted-foreground">Placed {order.placedAt.toISOString().slice(0, 10)}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase text-primary">{order.status.replace(/_/g, " ")}</span>
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">Payment: {order.paymentStatus.replace(/_/g, " ")}</span>
        </div>
      </div>

      <div className="mt-6 divide-y divide-border">
        {order.items.map((item) => (
          <div key={item.id} className="flex items-center justify-between py-3 text-sm">
            <div>
              <div className="font-medium text-foreground">{item.productTitle}</div>
              {item.variantTitle && item.variantTitle !== "Default" ? <div className="text-xs text-muted-foreground">{item.variantTitle}</div> : null}
              <div className="text-xs text-muted-foreground">Qty: {item.quantity}</div>
            </div>
            <div className="font-semibold text-foreground">{money(item.total)}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 space-y-2 border-t border-border pt-4 text-sm">
        <div className="flex justify-between text-muted-foreground">
          <span>Subtotal</span>
          <span>{money(order.subtotal)}</span>
        </div>
        {(order.discountTotal ?? 0) > 0 ? (
          <div className="flex justify-between text-muted-foreground">
            <span>Discount</span>
            <span>−{money(order.discountTotal ?? 0)}</span>
          </div>
        ) : null}
        {order.shippingTotal > 0 ? (
          <div className="flex justify-between text-muted-foreground">
            <span>Shipping</span>
            <span>{money(order.shippingTotal)}</span>
          </div>
        ) : null}
        <div className="flex justify-between border-t border-border pt-2 text-base font-bold text-foreground">
          <span>Grand Total</span>
          <span>{money(order.grandTotal)}</span>
        </div>
      </div>

      <div className="mt-6 border-t border-border pt-4 text-sm">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Delivering to</h3>
        {addressLines(order.shippingAddress).map((l) => (
          <div key={l} className="text-foreground">
            {l}
          </div>
        ))}
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
        <Link href="/account" className="text-sm font-medium text-primary hover:underline">
          ← All orders
        </Link>
        {/* Opens the order's tracking and returns page; the link mints its secret on click, so it must not be prefetched. */}
        <Link
          href={`/account/orders/${order.id}/track`}
          prefetch={false}
          className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted"
        >
          Track order or request a return
        </Link>
      </div>
    </div>
  );
}

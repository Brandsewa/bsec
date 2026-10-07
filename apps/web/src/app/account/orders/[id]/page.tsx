import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCustomerOrderDetail } from "@bs/domain";
import { accountContext } from "@/server/customer-session.ts";
import { StatusBadge, Badge, Money, type StatusTone, buttonVariants } from "@bs/ui";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-xs sm:p-8">
      <div className="flex flex-col gap-3 border-b border-[var(--border)] pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Order</span>
          <h2 className="text-2xl font-bold tracking-tight text-[var(--foreground)]">{order.number}</h2>
          <p className="text-xs text-[var(--muted-foreground)]">Placed {order.placedAt.toISOString().slice(0, 10)}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge tone={mapStatusToTone(order.status)} label={order.status.replace(/_/g, " ")} />
          <Badge variant="secondary">
            Payment: {order.paymentStatus.replace(/_/g, " ")}
          </Badge>
        </div>
      </div>

      <div className="mt-6 divide-y divide-[var(--border-soft)]">
        {order.items.map((item) => (
          <div key={item.id} className="flex items-center justify-between py-3.5 text-sm">
            <div>
              <div className="font-semibold text-[var(--foreground)]">{item.productTitle}</div>
              {item.variantTitle && item.variantTitle !== "Default" ? <div className="text-xs text-[var(--muted-foreground)]">{item.variantTitle}</div> : null}
              <div className="text-xs text-[var(--muted-foreground)]">Qty: {item.quantity}</div>
            </div>
            <div className="font-medium tabular-nums text-[var(--foreground)]">
              <Money paise={item.total} />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 space-y-2 border-t border-[var(--border)] pt-4 text-sm">
        <div className="flex justify-between text-[var(--muted-foreground)]">
          <span>Subtotal</span>
          <span className="tabular-nums"><Money paise={order.subtotal} /></span>
        </div>
        {(order.discountTotal ?? 0) > 0 ? (
          <div className="flex justify-between text-[var(--muted-foreground)]">
            <span>Discount</span>
            <span className="tabular-nums text-[var(--success)]">−<Money paise={order.discountTotal ?? 0} /></span>
          </div>
        ) : null}
        {order.shippingTotal > 0 ? (
          <div className="flex justify-between text-[var(--muted-foreground)]">
            <span>Shipping</span>
            <span className="tabular-nums"><Money paise={order.shippingTotal} /></span>
          </div>
        ) : null}
        <div className="flex justify-between border-t border-[var(--border)] pt-3 text-base font-bold text-[var(--foreground)]">
          <span>Grand Total</span>
          <span className="tabular-nums"><Money paise={order.grandTotal} /></span>
        </div>
      </div>

      <div className="mt-6 border-t border-[var(--border)] pt-4 text-sm">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Delivering to</h3>
        {addressLines(order.shippingAddress).map((l) => (
          <div key={l} className="text-[var(--foreground)] leading-relaxed">
            {l}
          </div>
        ))}
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-6">
        <Link href="/account" className="text-sm font-semibold text-[var(--brand-ink)] hover:underline">
          ← All orders
        </Link>
        {/* Opens the order's tracking and returns page; the link mints its secret on click, so it must not be prefetched. */}
        <Link
          href={`/account/orders/${order.id}/track`}
          prefetch={false}
          className={buttonVariants({ variant: "secondary", size: "sm" })}
        >
          Track order or request a return
        </Link>
      </div>
    </div>
  );
}

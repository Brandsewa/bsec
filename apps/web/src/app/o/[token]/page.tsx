import React from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { evaluateStorefrontAccess, getOrderByActionToken, getOrderReturnsByToken } from "@bs/domain";
import { StatusBadge, Money } from "@bs/ui";
import { ReturnRequestForm } from "@/components/orders/ReturnRequestForm.tsx";
import { describeOrderStatus, describePayment } from "@/components/orders/order-labels.ts";
import { server } from "@/server/runtime.ts";

interface OrderTrackingPageProps {
  params: Promise<{ token: string }>;
}

export const metadata: Metadata = {
  title: "Order Status",
  description: "View your order status and details",
};

export default async function OrderTrackingPage({ params }: OrderTrackingPageProps) {
  const { token } = await params;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";

  const { rt } = server();
  const access = await evaluateStorefrontAccess(rt, host, { headers: h });

  if (!access.tenantId) {
    notFound();
  }

  const order = await getOrderByActionToken(rt._db.db, access.tenantId, token);
  if (!order) {
    notFound();
  }

  const returnsView = await getOrderReturnsByToken(rt, access.tenantId, token);
  const status = describeOrderStatus(order.status);
  const statusToneMap: Record<"good" | "bad" | "neutral", "success" | "destructive" | "neutral"> = {
    good: "success",
    bad: "destructive",
    neutral: "neutral",
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-border pb-6 gap-2">
          <div>
            <span className="text-xs uppercase font-semibold tracking-wider text-muted-foreground">Order</span>
            <h1 className="text-2xl font-extrabold text-foreground">{order.number}</h1>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge tone={statusToneMap[status.tone]}>
              {status.label}
            </StatusBadge>
            <span className="inline-flex items-center rounded-md bg-muted text-muted-foreground px-2.5 py-1 text-xs font-medium">
              Payment: {describePayment(order.paymentStatus)}
            </span>
          </div>
        </div>

        {order.shipsOn && (
          <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-950 dark:text-amber-200">
            <span className="font-semibold">Dispatch date:</span> Ships on or after{" "}
            <span className="font-medium text-amber-900 dark:text-amber-100">
              {order.shipsOn >= new Date().toISOString().slice(0, 10)
                ? new Date(`${order.shipsOn}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                : "Ships soon"}
            </span>
          </div>
        )}

        <div className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">Items</h2>
          <div className="divide-y divide-border">
            {order.items.map((item) => (
              <div key={item.id} className="py-3 flex justify-between items-center text-sm">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{item.productTitle}</span>
                    {item.shipsOn ? (
                      <span className="inline-flex items-center rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                        Pre-order
                      </span>
                    ) : null}
                  </div>
                  {item.variantTitle && <div className="text-xs text-muted-foreground">{item.variantTitle}</div>}
                  <div className="text-xs text-muted-foreground">Qty: {item.quantity}</div>
                </div>
                <div className="font-semibold text-foreground">
                  <Money paise={item.total} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 border-t border-border pt-4 space-y-2 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal</span>
            <span><Money paise={order.subtotal} /></span>
          </div>
          {(order.discountTotal ?? 0) > 0 && (
            <div className="flex justify-between text-muted-foreground">
              <span>Discount</span>
              <span>−<Money paise={order.discountTotal ?? 0} /></span>
            </div>
          )}
          {order.shippingTotal > 0 && (
            <div className="flex justify-between text-muted-foreground">
              <span>Shipping</span>
              <span><Money paise={order.shippingTotal} /></span>
            </div>
          )}
          <div className="flex justify-between font-bold text-base text-foreground pt-2 border-t border-border">
            <span>Grand Total</span>
            <span><Money paise={order.grandTotal} /></span>
          </div>
        </div>

        {returnsView && (returnsView.returns.length > 0 || returnsView.canRequest) && (
          <div className="mt-8 space-y-4 border-t border-border pt-6">
            <ReturnRequestForm
              token={token}
              items={returnsView.items}
              reasons={returnsView.reasons}
              allowExchanges={returnsView.allowExchanges}
              policyText={returnsView.policyText}
              instructions={returnsView.instructions}
              existingReturns={returnsView.returns}
            />
          </div>
        )}

        <div className="mt-8 pt-6 border-t border-border flex justify-between items-center">
          <Link
            href="/"
            className="text-sm font-medium text-primary hover:underline"
          >
            ← Continue Shopping
          </Link>
        </div>
      </div>
    </div>
  );
}

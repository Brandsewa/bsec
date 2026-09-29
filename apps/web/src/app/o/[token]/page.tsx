import React from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { evaluateStorefrontAccess, getOrderByActionToken } from "@bs/domain";
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

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-border pb-6 gap-2">
          <div>
            <span className="text-xs uppercase font-semibold tracking-wider text-muted-foreground">Order</span>
            <h1 className="text-2xl font-extrabold text-foreground">{order.number}</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-semibold uppercase">
              {order.status}
            </span>
            <span className="inline-flex items-center rounded-full bg-muted text-muted-foreground px-3 py-1 text-xs font-semibold">
              Payment: {order.paymentStatus}
            </span>
          </div>
        </div>

        <div className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">Items</h2>
          <div className="divide-y divide-border">
            {order.items.map((item) => (
              <div key={item.id} className="py-3 flex justify-between items-center text-sm">
                <div>
                  <div className="font-medium text-foreground">{item.productTitle}</div>
                  {item.variantTitle && <div className="text-xs text-muted-foreground">{item.variantTitle}</div>}
                  <div className="text-xs text-muted-foreground">Qty: {item.quantity}</div>
                </div>
                <div className="font-semibold text-foreground">
                  ₹{(item.total / 100).toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 border-t border-border pt-4 space-y-2 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal</span>
            <span>₹{(order.subtotal / 100).toFixed(2)}</span>
          </div>
          {order.shippingTotal > 0 && (
            <div className="flex justify-between text-muted-foreground">
              <span>Shipping</span>
              <span>₹{(order.shippingTotal / 100).toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-base text-foreground pt-2 border-t border-border">
            <span>Grand Total</span>
            <span>₹{(order.grandTotal / 100).toFixed(2)}</span>
          </div>
        </div>

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

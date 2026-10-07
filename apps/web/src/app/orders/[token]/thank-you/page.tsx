import React from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { evaluateStorefrontAccess, getOrderByActionToken } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { describeOrderStatus, describePayment } from "@/components/orders/order-labels.ts";
import { StatusBadge, Money, Button } from "@bs/ui";
import { CreateAccountCard } from "@/components/orders/CreateAccountCard.tsx";

interface ThankYouPageProps {
  params: Promise<{ token: string }>;
}

export const metadata: Metadata = {
  title: "Thank You for Your Order",
  description: "Order confirmation",
};

export default async function ThankYouPage({ params }: ThankYouPageProps) {
  const { token } = await params;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";

  const { rt } = server();
  const access = await evaluateStorefrontAccess(rt, host, { headers: h });
  if (!access.tenantId) notFound();

  const order = await getOrderByActionToken(rt._db.db, access.tenantId, token);
  if (!order) notFound();

  const status = describeOrderStatus(order.status);
  const cancelled = order.status === "cancelled";
  const statusToneMap: Record<"good" | "bad" | "neutral", "success" | "destructive" | "neutral"> = {
    good: "success",
    bad: "destructive",
    neutral: "neutral",
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8 text-center">
      <div
        className={`mx-auto flex h-20 w-20 items-center justify-center rounded-full mb-6 ${
          cancelled ? "bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400" : "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
        }`}
      >
        <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
          <path strokeLinecap="round" strokeLinejoin="round" d={cancelled ? "M6 18L18 6M6 6l12 12" : "M5 13l4 4L19 7"} />
        </svg>
      </div>

      <h1 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
        {cancelled ? "This order was cancelled" : "Thank you for your order!"}
      </h1>

      <p className="mt-3 text-base text-muted-foreground">
        {cancelled
          ? "No payment is due for this order."
          : `We have received your order and will send updates to ${order.email}.`}
      </p>

      <div className="mt-8 rounded-xl border border-border bg-card p-6 text-left shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">Order Details</h2>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Order number:</span>
            <span className="font-mono font-bold text-foreground" data-testid="order-number">{order.number}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Status:</span>
            <StatusBadge tone={statusToneMap[status.tone]}>
              {status.label}
            </StatusBadge>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Payment:</span>
            <span className="font-medium text-foreground">{cancelled ? "No payment due" : describePayment(order.paymentStatus)}</span>
          </div>
          {(order.discountTotal ?? 0) > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Discount:</span>
              <span className="font-medium text-emerald-700 dark:text-emerald-400">
                −<Money paise={order.discountTotal ?? 0} />
              </span>
            </div>
          )}
          {order.shipsOn && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Estimated dispatch:</span>
              <span className="font-semibold text-amber-700 dark:text-amber-400">
                {order.shipsOn >= new Date().toISOString().slice(0, 10)
                  ? `Ships on or after ${new Date(`${order.shipsOn}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
                  : "Ships soon"}
              </span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total:</span>
            <span className="font-bold text-foreground"><Money paise={order.grandTotal} /></span>
          </div>
        </div>

        <div className="mt-5 divide-y divide-border border-t border-border">
          {order.items.map((item) => (
            <div key={item.id} className="flex justify-between items-center py-2.5 text-sm">
              <span className="text-foreground flex items-center gap-1.5 flex-wrap">
                {item.productTitle}
                {item.variantTitle && item.variantTitle !== "Default" ? ` (${item.variantTitle})` : ""} × {item.quantity}
                {item.shipsOn ? (
                  <span className="inline-flex items-center rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                    Pre-order
                  </span>
                ) : null}
              </span>
              <span className="text-muted-foreground"><Money paise={item.total} /></span>
            </div>
          ))}
        </div>
      </div>

      <CreateAccountCard email={order.email} phone={order.phone} />

      <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Link href={`/o/${token}`}>
          <Button variant="outline">
            View order status
          </Button>
        </Link>
        <Link href="/">
          <Button variant="primary">
            Continue Shopping
          </Button>
        </Link>
      </div>
    </div>
  );
}


import React from "react";
import type { CustomerOrderDetail, TrackingConfig } from "@bs/domain";
import { StatusBadge, Money } from "@bs/ui";
import { OrderTrackingView, OrderUpdates } from "./OrderTrackingView.tsx";
import { describeOrderStatus, describePayment } from "./order-labels.ts";

function addressLines(raw: unknown): string[] {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const t = (k: string) => (typeof a[k] === "string" && (a[k] as string).trim() !== "" ? (a[k] as string).trim() : "");
  return [t("companyName"), t("fullName") || t("name"), t("addressLine1"), t("addressLine2"), [t("city"), t("state"), t("pincode")].filter(Boolean).join(", "), t("taxId") ? `GSTIN: ${t("taxId")}` : ""].filter(Boolean);
}

const TONE = { good: "success", bad: "destructive", neutral: "neutral" } as const;
// the account area defines --acct-surface (light grey, like its navigation); elsewhere the theme card colour is used
const card = "rounded-lg border border-border bg-[var(--acct-surface,var(--card,var(--background)))]";
const label = "mb-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground";

/**
 * One order, two columns: customer and items on the left, tracking and updates on the right (tracking first on phones).
 * Shared by the emailed order link (/o/{token}) and the signed-in account order page, so the two never drift apart.
 * `afterTracking` is a card for the page's own actions, such as the return request form.
 */
export function OrderDetailLayout({
  order,
  trackingConfig,
  afterTracking,
  headerAside,
}: {
  order: CustomerOrderDetail;
  trackingConfig: TrackingConfig;
  afterTracking?: React.ReactNode;
  /** Sits at the right of the page header, such as the account page's return prompt. */
  headerAside?: React.ReactNode;
}) {
  const status = describeOrderStatus(order.status);
  const shipLines = addressLines(order.shippingAddress);
  const billLines = addressLines(order.billingAddress);
  const sameBilling = billLines.length === 0 || JSON.stringify(billLines) === JSON.stringify(shipLines);
  const ship = (order.shippingAddress && typeof order.shippingAddress === "object" ? order.shippingAddress : {}) as Record<string, unknown>;
  const customerName = [ship["fullName"], ship["name"]].find((v): v is string => typeof v === "string" && v.trim() !== "") ?? null;

  return (
    <div>
      <div className="flex flex-col items-start justify-between gap-4 pb-6 lg:flex-row lg:items-center">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold text-foreground">{order.number}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
            <span>Placed {new Date(order.placedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}</span>
            <StatusBadge tone={TONE[status.tone]}>{status.label}</StatusBadge>
            <span>Payment: {describePayment(order.paymentStatus)}</span>
          </div>
        </div>
        {headerAside ? <div className="shrink-0">{headerAside}</div> : null}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
        {/* tracking comes first on phones, but sits on the right on wide screens */}
        <div className="space-y-6 lg:order-2">
          <div className={`${card} p-5 sm:p-6`}>
            {order.shipsOn && (
              <div className="mb-5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-950 dark:text-amber-200">
                <span className="font-semibold">Dispatch date:</span> Ships on or after{" "}
                <span className="font-medium text-amber-900 dark:text-amber-100">
                  {order.shipsOn >= new Date().toISOString().slice(0, 10)
                    ? new Date(`${order.shipsOn}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                    : "Ships soon"}
                </span>
              </div>
            )}
            <OrderTrackingView status={order.status} tracking={order.tracking} config={trackingConfig} showUpdates={false} />
          </div>

          {trackingConfig.showTimeline && order.status !== "cancelled" ? (
            <div className={`${card} p-5 sm:p-6`}>
              <OrderUpdates tracking={order.tracking} config={trackingConfig} />
            </div>
          ) : null}

          {afterTracking ? <div className={`${card} p-5 sm:p-6`}>{afterTracking}</div> : null}
        </div>

        <div className="space-y-6 lg:order-1">
          <div className={`${card} p-5 text-sm`}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Customer</h2>
            <div>
              {customerName ? <p className="font-medium text-foreground">{customerName}</p> : null}
              <p className="break-all text-foreground">{order.email}</p>
              {order.phone ? <p className="text-muted-foreground">{order.phone}</p> : null}
            </div>
            <hr className="my-3 border-border" />
            <p className={label}>Shipping address</p>
            {shipLines.length > 0 ? shipLines.map((l, i) => <div key={i} className="text-foreground">{l}</div>) : <p className="text-muted-foreground">No address on file.</p>}
            <hr className="my-3 border-border" />
            <p className={label}>Billing address</p>
            {sameBilling ? <p className="text-muted-foreground">Same as shipping address</p> : billLines.map((l, i) => <div key={i} className="text-foreground">{l}</div>)}
          </div>

          <div className={`${card} p-5 text-sm`}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Items</h2>
            <div className="divide-y divide-border">
              {order.items.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{item.productTitle}</span>
                      {item.shipsOn ? <span className="inline-flex items-center rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">Pre-order</span> : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {[item.variantTitle && item.variantTitle !== "Default" ? item.variantTitle : null, `Qty ${item.quantity}`].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div className="shrink-0 font-semibold text-foreground">
                    <Money paise={item.total} currency={order.currency} />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 space-y-1.5 border-t border-border pt-3">
              <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span><Money paise={order.subtotal} currency={order.currency} /></span></div>
              {(order.discountTotal ?? 0) > 0 && (
                <div className="flex justify-between text-muted-foreground"><span>Discount</span><span>−<Money paise={order.discountTotal ?? 0} currency={order.currency} /></span></div>
              )}
              {order.shippingTotal > 0 && (
                <div className="flex justify-between text-muted-foreground"><span>Shipping</span><span><Money paise={order.shippingTotal} currency={order.currency} /></span></div>
              )}
              <div className="flex justify-between border-t border-border pt-2 text-base font-bold text-foreground"><span>Grand Total</span><span><Money paise={order.grandTotal} currency={order.currency} /></span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

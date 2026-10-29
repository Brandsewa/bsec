import type { OrderTracking, TrackingConfig, TrackingShipment } from "@bs/domain";

/** The store settings that change what a shopper sees. */
export type TrackingViewConfig = Pick<TrackingConfig, "showTimeline" | "showCarrierDetails" | "estimatedDeliveryDays" | "message">;
import { CopyButton } from "./CopyButton.tsx";

const STEPS = ["Placed", "Confirmed", "Shipped", "Out for delivery", "Delivered"] as const;

const when = (d: Date | string | null) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : null;

const SHIPMENT_LABEL: Record<string, string> = {
  pending: "Being packed",
  label_created: "Ready to ship",
  picked_up: "Picked up",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  rto: "Returning to the seller",
  rto_delivered: "Returned to the seller",
};

/** How far along the order is, 0 (placed) to 4 (delivered), from the order status and its parcels. */
function stageOf(orderStatus: string, tracking: OrderTracking): number {
  if (orderStatus === "delivered") return 4;
  const ships = tracking.shipments;
  if (ships.length > 0 && tracking.unshipped.length === 0 && ships.every((s) => s.status === "delivered")) return 4;
  if (ships.some((s) => s.status === "out_for_delivery" || s.status === "delivered")) return 3;
  if (ships.length > 0) return 2;
  return orderStatus === "pending" ? 0 : 1;
}

function Stepper({ stage }: { stage: number }) {
  return (
    <ol className="grid grid-cols-5 gap-1" aria-label="Order progress">
      {STEPS.map((label, i) => {
        const done = i <= stage;
        return (
          <li key={label} aria-current={i === stage ? "step" : undefined} className="flex flex-col items-center gap-1.5 text-center">
            <span className="flex w-full items-center">
              <span className={`h-0.5 flex-1 ${i === 0 ? "bg-transparent" : i <= stage ? "bg-[var(--color-primary,var(--brand-ink))]" : "bg-border"}`} />
              <span className={`size-3 shrink-0 rounded-full border-2 ${done ? "border-[var(--color-primary,var(--brand-ink))] bg-[var(--color-primary,var(--brand-ink))]" : "border-border bg-card"}`} />
              <span className={`h-0.5 flex-1 ${i === STEPS.length - 1 ? "bg-transparent" : i < stage ? "bg-[var(--color-primary,var(--brand-ink))]" : "bg-border"}`} />
            </span>
            <span className={`text-[11px] leading-tight sm:text-xs ${done ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Parcel({ s, index, total, config }: { s: TrackingShipment; index: number; total: number; config: TrackingViewConfig }) {
  const latest = config.showTimeline ? s.events[0] : undefined;
  const eta =
    config.estimatedDeliveryDays && s.shippedAt && !s.deliveredAt && s.status !== "rto" && s.status !== "rto_delivered"
      ? new Date(new Date(s.shippedAt).getTime() + config.estimatedDeliveryDays * 86_400_000).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })
      : null;
  return (
    <div className="rounded-lg border border-border p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-foreground">{total > 1 ? `Parcel ${index + 1} of ${total}` : "Shipment"}</p>
        <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground">{SHIPMENT_LABEL[s.status] ?? s.status.replace(/_/g, " ")}</span>
      </div>
      <dl className="mt-3 grid gap-1.5 text-muted-foreground">
        {config.showCarrierDetails && s.carrier ? (
          <div className="flex gap-2">
            <dt className="w-24 shrink-0">Carrier</dt>
            <dd className="text-foreground">{s.carrier}</dd>
          </div>
        ) : null}
        {config.showCarrierDetails && s.awb ? (
          <div className="flex items-center gap-2">
            <dt className="w-24 shrink-0">Tracking no.</dt>
            <dd className="flex items-center gap-2 text-foreground">
              <span className="font-mono">{s.awb}</span>
              <CopyButton value={s.awb} label={`Copy tracking number ${s.awb}`} />
            </dd>
          </div>
        ) : null}
        {s.shippedAt ? (
          <div className="flex gap-2">
            <dt className="w-24 shrink-0">Shipped</dt>
            <dd className="text-foreground">{when(s.shippedAt)}</dd>
          </div>
        ) : null}
        {s.deliveredAt ? (
          <div className="flex gap-2">
            <dt className="w-24 shrink-0">Delivered</dt>
            <dd className="text-foreground">{when(s.deliveredAt)}</dd>
          </div>
        ) : null}
        {eta ? (
          <div className="flex gap-2">
            <dt className="w-24 shrink-0">Estimated</dt>
            <dd className="text-foreground">By {eta}</dd>
          </div>
        ) : null}
      </dl>
      <ul className="mt-3 space-y-0.5 text-foreground">
        {s.items.map((i) => (
          <li key={i.orderItemId}>
            {i.productTitle}
            {i.variantTitle ? <span className="text-muted-foreground"> · {i.variantTitle}</span> : null}
            <span className="text-muted-foreground"> × {i.quantity}</span>
          </li>
        ))}
      </ul>
      {latest && s.status !== "delivered" ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Latest update: {latest.message}
          {latest.location ? ` (${latest.location})` : ""} · {when(latest.occurredAt)}
        </p>
      ) : null}
      {config.showCarrierDetails && s.trackingUrl ? (
        <a
          href={s.trackingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
        >
          Track with {s.carrier ?? "the carrier"}
        </a>
      ) : null}
    </div>
  );
}

/**
 * The shopper's tracking view: progress, one card per parcel, what has not shipped yet, and a timeline.
 * One component for the emailed link, the account order page and (later) the public lookup, so they never drift apart.
 */
export function OrderTrackingView({ status, tracking, config }: { status: string; tracking: OrderTracking; config: TrackingViewConfig }) {
  if (status === "cancelled") {
    return (
      <section aria-label="Tracking" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-foreground">
        This order was cancelled, so nothing will be shipped.
      </section>
    );
  }
  const stage = stageOf(status, tracking);
  const { shipments, unshipped, timeline } = tracking;
  return (
    <section aria-label="Tracking" className="space-y-5">
      {config.message ? <p className="rounded-lg bg-muted p-3 text-sm text-foreground">{config.message}</p> : null}
      <Stepper stage={stage} />
      {shipments.length > 0 ? (
        <div className="space-y-3">
          {shipments.map((s, i) => (
            <Parcel key={s.id} s={s} index={i} total={shipments.length} config={config} />
          ))}
        </div>
      ) : null}
      {shipments.length > 0 && unshipped.length > 0 ? (
        <div className="rounded-lg border border-dashed border-border p-4 text-sm">
          <p className="font-semibold text-foreground">Not shipped yet</p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {unshipped.map((i) => (
              <li key={i.orderItemId}>
                {i.productTitle}
                {i.variantTitle ? ` · ${i.variantTitle}` : ""} × {i.quantity}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">These will get their own tracking number when they ship.</p>
        </div>
      ) : null}
      {config.showTimeline ? (
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Updates</h3>
        <ol className="ml-1.5 space-y-3 border-l-2 border-border pl-4 text-sm">
          {timeline.map((e, i) => (
            <li key={`${e.label}-${i}`}>
              <p className="font-medium text-foreground">{e.label}</p>
              <p className="text-xs text-muted-foreground">{when(e.at)}</p>
            </li>
          ))}
        </ol>
      </div>
      ) : null}
    </section>
  );
}

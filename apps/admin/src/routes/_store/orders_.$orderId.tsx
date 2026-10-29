import { createFileRoute, useNavigate, useRouteContext } from "@tanstack/react-router";
import { Archive, ArchiveRestore, CheckCircle2, ChevronDown, Clock, FileText, MoreHorizontal, PackageCheck, Trash2, Truck, Undo2, XCircle } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, ConfirmDialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, EmptyState, PageContainer, PageHeader, PageSkeleton, toast } from "@bs/ui";
import { Alert } from "@bs/ui";
import { Button } from "@bs/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@bs/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@bs/ui";
import { Checkbox, Field, FieldLabel, SimpleSelect, Switch } from "@bs/ui";
import { Input } from "@bs/ui";
import { Skeleton } from "@bs/ui";
import { orpc } from "../../lib/orpc.ts";
import { errorMessage } from "../../lib/errors.ts";
import { StatusBadge, money } from "../../components/order-parts.tsx";

export const Route = createFileRoute("/_store/orders_/$orderId")({
  pendingComponent: () => <PageSkeleton />,
  component: OrderDetailPage,
});

const CARRIERS = ["Bluedart", "Delhivery", "DTDC", "India Post", "Xpressbees", "Ecom Express", "Shadowfax", "Own delivery"] as const;
const OTHER_CARRIER = "Other";

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? "text-sm font-semibold text-foreground" : "text-foreground"}>{value}</span>
    </div>
  );
}

const ADDRESS_ORDER = ["fullName", "name", "addressLine1", "addressLine2", "city", "state", "pincode", "country"] as const;

function AddressLines({ address }: { address: unknown }) {
  const a = (address && typeof address === "object" ? address : {}) as Record<string, unknown>;
  const text = (k: string) => (typeof a[k] === "string" && (a[k] as string).length > 0 ? (a[k] as string) : null);
  // A business order adds the company and its GSTIN; a separate delivery address adds its own contact.
  const lines = [text("companyName"), ...ADDRESS_ORDER.map((k) => text(k)), text("taxId") ? `GSTIN: ${text("taxId")}` : null, text("phone") ? `Phone: ${text("phone")}` : null, text("email") ? `Email: ${text("email")}` : null].filter(
    (v): v is string => v !== null,
  );
  if (lines.length === 0) return <p className="text-muted-foreground">No address on file.</p>;
  return (
    <address className="not-italic">
      {lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </address>
  );
}

/** True when the billing address says something the shipping address does not (a company, a GSTIN, or another place). */
function billingDiffers(billing: unknown, shipping: unknown): boolean {
  if (!billing || typeof billing !== "object") return false;
  const b = billing as Record<string, unknown>;
  if (b["companyName"] || b["taxId"]) return true;
  const s = (shipping && typeof shipping === "object" ? shipping : {}) as Record<string, unknown>;
  return ["addressLine1", "city", "state", "pincode"].some((k) => (b[k] ?? "") !== (s[k] ?? ""));
}

function OrderDetailPage() {
  const { orderId } = Route.useParams();
  const navigate = useNavigate();
  const routeContext = useRouteContext({ strict: false }) as
    | { store?: { permissions?: string[]; role?: string } }
    | undefined;
  const canDeleteOrders = (routeContext?.store?.permissions ?? []).includes("orders.delete");

  const queryClient = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [note, setNote] = useState("");
  const [fulfillOpen, setFulfillOpen] = useState(false);
  const [carrier, setCarrier] = useState<string>(CARRIERS[0]);
  const [otherCarrier, setOtherCarrier] = useState("");
  const [awb, setAwb] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [notify, setNotify] = useState(false);
  const [pick, setPick] = useState<Record<string, { on: boolean; qty: number }>>({});
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundRupees, setRefundRupees] = useState("");
  const [refundReason, setRefundReason] = useState("");

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTypedText, setDeleteTypedText] = useState("");

  const detail = useQuery(orpc.admin.orders.get.queryOptions({ input: { id: orderId } }));
  // staff without the settings permission just get the standard carrier list
  const trackingSettings = useQuery(orpc.admin.orderSettings.get.queryOptions()).data?.tracking;
  const carrierOptions = trackingSettings && trackingSettings.carriers.length > 0 ? trackingSettings.carriers.map((c) => c.name) : [...CARRIERS];
  const carrierHasLink = Boolean(trackingSettings?.carriers.find((c) => c.name === carrier && c.urlTemplate));

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.admin.orders.list.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.admin.orders.get.key({ input: { id: orderId } }) });
  };
  const onError = (e: unknown) => toast.error(errorMessage(e));

  const archive = useMutation(
    orpc.admin.orders.archive.mutationOptions({
      onSuccess: (r) => {
        const res = r.results[0];
        if (res?.ok) {
          toast.success("Order archived.");
          refresh();
        } else {
          toast.error(res?.reason ?? "Could not archive order.");
        }
      },
      onError,
    }),
  );

  const unarchive = useMutation(
    orpc.admin.orders.unarchive.mutationOptions({
      onSuccess: (r) => {
        const res = r.results[0];
        if (res?.ok) {
          toast.success("Order unarchived.");
          refresh();
        } else {
          toast.error(res?.reason ?? "Could not unarchive order.");
        }
      },
      onError,
    }),
  );

  const deleteOrder = useMutation(
    orpc.admin.orders.delete.mutationOptions({
      onSuccess: (r) => {
        const res = r.results[0];
        if (res?.ok) {
          toast.success("Order permanently deleted.");
          void queryClient.invalidateQueries({ queryKey: orpc.admin.orders.list.key() });
          void navigate({ to: "/orders" });
        } else {
          toast.error(res?.reason ?? "Could not delete order.");
        }
      },
      onError,
    }),
  );

  const confirmOrder = useMutation(
    orpc.admin.orders.confirm.mutationOptions({
      onSuccess: () => { toast.success("Order confirmed."); refresh(); },
      onError,
    }),
  );
  const advance = useMutation(
    orpc.admin.orders.advance.mutationOptions({
      onSuccess: (r) => { toast.success(r.status === "delivered" ? "Marked as delivered." : "Marked as shipped."); refresh(); },
      onError,
    }),
  );
  const ship = useMutation(
    orpc.admin.orders.ship.mutationOptions({
      onSuccess: (r) => {
        toast.success(r.fullyShipped ? "Marked as fulfilled." : "Marked as partially fulfilled.");
        setFulfillOpen(false);
        refresh();
      },
      onError,
    }),
  );
  const refund = useMutation(
    orpc.admin.orders.refund.mutationOptions({
      onSuccess: () => {
        toast.success("Refund recorded.");
        setRefundOpen(false);
        setRefundReason("");
        refresh();
      },
      onError,
    }),
  );
  const invoice = useMutation(
    orpc.admin.orders.createInvoice.mutationOptions({
      onSuccess: (r) => { toast.success(`Invoice ${r.invoiceNumber} created.`); refresh(); },
      onError,
    }),
  );
  const cancel = useMutation(
    orpc.admin.orders.cancel.mutationOptions({
      onSuccess: () => { toast.success("Order cancelled."); setCancelOpen(false); setCancelReason(""); refresh(); },
      onError,
    }),
  );
  const addNote = useMutation(
    orpc.admin.orders.addNote.mutationOptions({
      onSuccess: () => { setNote(""); refresh(); },
      onError,
    }),
  );
  const releasePreorder = useMutation(
    orpc.admin.preorders.releaseNow.mutationOptions({
      onSuccess: () => {
        toast.success("Pre-order released for shipping.");
        refresh();
      },
      onError,
    }),
  );

  if (detail.isLoading) {
    return (
      <PageContainer>
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-8 w-72" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </PageContainer>
    );
  }

  if (detail.isError || !detail.data) {
    return (
      <PageContainer size="small">
        <EmptyState
          title="Could not load this order"
          description={detail.error ? errorMessage(detail.error) : "It may have been removed."}
          action={<Button onClick={() => void detail.refetch()}>Try again</Button>}
        />
      </PageContainer>
    );
  }

  const { order, items, fulfillments, invoices, events, notes } = detail.data;
  const cancelled = order.status === "cancelled";
  const isEligibleForDelete = Boolean(order.archivedAt) && (order.status === "cancelled" || order.status === "draft") && !["captured", "paid", "partially_refunded", "refunded"].includes(order.paymentStatus) && order.fulfillmentStatus === "unfulfilled";
  const today = new Date().toISOString().slice(0, 10);
  const isPreorderHold = Boolean(order.shipsOn && order.shipsOn > today && !order.preorderReleasedAt);
  const remaining = items.filter((it) => it.quantity - it.fulfilledQty > 0);
  const openFulfil = () => {
    setPick(Object.fromEntries(remaining.map((it) => [it.id, { on: true, qty: it.quantity - it.fulfilledQty }])));
    setCarrier(carrierOptions[0] ?? CARRIERS[0]);
    setOtherCarrier("");
    setAwb("");
    setTrackingUrl("");
    setNotify(trackingSettings?.notifyByDefault ?? false);
    setFulfillOpen(true);
  };
  const chosen = remaining.filter((it) => pick[it.id]?.on && (pick[it.id]?.qty ?? 0) > 0);
  const shipsEverything = chosen.length === remaining.length && chosen.every((it) => (pick[it.id]?.qty ?? 0) === it.quantity - it.fulfilledQty);
  const carrierName = carrier === OTHER_CARRIER ? otherCarrier.trim() : carrier;
  const urlInvalid = trackingUrl.trim() !== "" && !/^https?:\/\/\S+$/i.test(trackingUrl.trim());
  const canShip = ["pending", "confirmed", "processing", "partially_fulfilled"].includes(order.status) && remaining.length > 0;
  const canDeliver = ["pending", "confirmed", "processing", "partially_fulfilled", "fulfilled"].includes(order.status);
  const canRefund = ["captured", "paid", "partially_refunded", "cod_collected"].includes(order.paymentStatus);
  const shipAddr = (order.shippingAddress && typeof order.shippingAddress === "object" ? order.shippingAddress : {}) as Record<string, unknown>;
  const customerName = [shipAddr["fullName"], shipAddr["name"]].find((v): v is string => typeof v === "string" && v.length > 0) ?? null;
  const fulfilmentBusy = advance.isPending || confirmOrder.isPending;
  const fulfilmentLabel = ["fulfilled", "delivered"].includes(order.status)
    ? order.status === "delivered" ? "Delivered" : "Fulfilled"
    : order.status === "partially_fulfilled"
      ? "Partially fulfilled"
      : order.status === "confirmed" || order.status === "processing"
        ? "In progress"
        : "Unfulfilled";

  return (
    <PageContainer>
      <PageHeader
        back={{ href: "/orders", label: "Orders" }}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {order.number}
            <StatusBadge status={order.paymentStatus} />
            <StatusBadge status={order.fulfillmentStatus} />
            {cancelled ? <StatusBadge status="cancelled" /> : null}
            {order.archivedAt ? <Badge variant="secondary">Archived</Badge> : null}
          </span>
        }
        description={`Placed on ${new Date(order.placedAt).toLocaleString()}`}
        aside={
          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" disabled={cancelled || order.status === "returned" || fulfilmentBusy} />}>
                {fulfilmentLabel}
                <ChevronDown className="ml-1.5 size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-52">
                <DropdownMenuItem disabled>
                  <Clock className="mr-2 size-4" /> Unfulfilled
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={order.status !== "pending" || isPreorderHold}
                  onClick={() => confirmOrder.mutate({ id: orderId })}
                >
                  <CheckCircle2 className="mr-2 size-4" /> In progress
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!canShip || isPreorderHold}
                  onClick={openFulfil}
                >
                  <Truck className="mr-2 size-4" /> {order.status === "partially_fulfilled" ? "Ship remaining items" : "Mark as fulfilled"}
                </DropdownMenuItem>
                {canDeliver ? (
                  <DropdownMenuItem onClick={() => advance.mutate({ id: orderId, to: "delivered" })}>
                    <PackageCheck className="mr-2 size-4" /> Mark delivered{order.paymentStatus === "cod_pending" ? " and cash collected" : ""}
                  </DropdownMenuItem>
                ) : null}
                {isPreorderHold ? (
                  <DropdownMenuItem onClick={() => releasePreorder.mutate({ id: order.id })}>
                    <Clock className="mr-2 size-4" /> Release pre-order now
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              disabled={!canRefund}
              title={canRefund ? undefined : "Nothing has been paid on this order yet."}
              onClick={() => {
                setRefundRupees(String(order.grandTotal / 100));
                setRefundOpen(true);
              }}
            >
              <Undo2 className="mr-1.5 size-4" /> Refund
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="More actions" />}>
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-48">
                <DropdownMenuItem disabled={invoice.isPending} onClick={() => invoice.mutate({ id: orderId })}>
                  <FileText className="mr-2 size-4" /> Create GST invoice
                </DropdownMenuItem>
                {order.archivedAt ? (
                  <DropdownMenuItem disabled={unarchive.isPending} onClick={() => unarchive.mutate({ ids: [orderId] })}>
                    <ArchiveRestore className="mr-2 size-4" /> Unarchive order
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem disabled={archive.isPending} onClick={() => archive.mutate({ ids: [orderId] })}>
                    <Archive className="mr-2 size-4" /> Archive order
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem variant="destructive" disabled={cancelled} onClick={() => setCancelOpen(true)}>
                  <XCircle className="mr-2 size-4" /> Cancel order
                </DropdownMenuItem>
                {Boolean(order.archivedAt) && canDeleteOrders ? (
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={!isEligibleForDelete || deleteOrder.isPending}
                    onClick={() => {
                      setDeleteTypedText("");
                      setDeleteOpen(true);
                    }}
                  >
                    <Trash2 className="mr-2 size-4" /> Delete order
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid gap-4">
          {order.shipsOn ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-amber-950 dark:text-amber-200">
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div>
                  <p className="text-sm font-semibold">
                    Pre-order · Ships on {new Date(order.shipsOn).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                  <p className="text-xs text-amber-800 dark:text-amber-300">
                    {order.preorderReleasedAt
                      ? `Released early for fulfillment on ${new Date(order.preorderReleasedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`
                      : isPreorderHold
                        ? "Held for fulfillment until the ship date or until released early."
                        : "Ship date reached. Ready for fulfillment."}
                  </p>
                </div>
              </div>
              {isPreorderHold && (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-amber-500/30 bg-background/50 hover:bg-amber-500/20"
                  disabled={releasePreorder.isPending}
                  onClick={() => releasePreorder.mutate({ id: order.id })}
                >
                  {releasePreorder.isPending ? "Releasing..." : "Release now"}
                </Button>
              )}
            </div>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Items</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-0 divide-y divide-border">
              {items.map((it) => (
                <div key={it.id} className="grid gap-0.5 py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-4">
                    <p className="min-w-0 truncate font-medium text-foreground">{it.productTitle}</p>
                    <p className="shrink-0 text-foreground">
                      <span className="text-muted-foreground">
                        {money(it.unitPrice)} × {it.quantity}
                      </span>
                      <span className="ml-3 font-medium">{money(it.total)}</span>
                    </p>
                  </div>
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span>{[it.variantTitle, it.sku].filter(Boolean).join(" · ") || "Default"}</span>
                    {it.shipsOn ? <span className="rounded bg-amber-500/10 px-1.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">Pre-order</span> : null}
                    {it.fulfilledQty > 0 ? <span>{it.fulfilledQty} of {it.quantity} fulfilled</span> : null}
                    {it.returnedQty > 0 ? <span>{it.returnedQty} returned</span> : null}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          {invoices.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Invoices</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2">
                {invoices.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between">
                    <span className="font-medium text-foreground">{inv.number}</span>
                    <span className="text-muted-foreground">
                      {inv.type.replace(/_/g, " ")} · FY {inv.fy} · {new Date(inv.issuedAt).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              <Row label="Subtotal" value={money(order.subtotal)} />
              {order.discountTotal > 0 ? <Row label="Discount" value={`−${money(order.discountTotal)}`} /> : null}
              <Row label="Shipping" value={money(order.shippingTotal)} />
              {order.codFee > 0 ? <Row label="COD fee" value={money(order.codFee)} /> : null}
              <Row label="Tax" value={money(order.taxTotal)} />
              <div className="border-t border-border pt-2">
                <Row label="Total" value={money(order.grandTotal)} strong />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (note.trim()) addNote.mutate({ id: orderId, body: note.trim() });
                }}
              >
                <Input aria-label="Add a note" placeholder="Add a note (visible to staff only)" value={note} onChange={(e) => setNote(e.target.value)} />
                <Button type="submit" variant="outline" disabled={!note.trim() || addNote.isPending}>
                  Add note
                </Button>
              </form>
              {notes.map((n) => (
                <div key={n.id} className="rounded-md border border-border bg-muted p-3">
                  <p className="text-foreground">{n.body}</p>
                  <p className="text-muted-foreground">{new Date(n.createdAt).toLocaleString()} · note</p>
                </div>
              ))}
              <div className="ml-2 grid gap-4 border-l-2 border-border pl-4">
                {events.length > 0 ? (
                  events.map((ev) => (
                    <div key={ev.id}>
                      <p className="font-medium text-foreground">{ev.message}</p>
                      <p className="text-muted-foreground">
                        {new Date(ev.createdAt).toLocaleString()} · {ev.actorType}
                      </p>
                    </div>
                  ))
                ) : (
                  <div>
                    <p className="font-medium text-foreground">Order placed</p>
                    <p className="text-muted-foreground">{new Date(order.placedAt).toLocaleString()}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Customer</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div>
                {customerName ? <p className="font-medium text-foreground">{customerName}</p> : null}
                <p className="text-foreground">{order.email}</p>
                <p className="text-muted-foreground">{order.phone}</p>
              </div>
              <hr className="border-border" />
              <div>
                <p className="mb-1 text-[0.625rem] font-semibold tracking-wider text-muted-foreground uppercase">Shipping address</p>
                <AddressLines address={order.shippingAddress} />
              </div>
              <hr className="border-border" />
              <div>
                <p className="mb-1 text-[0.625rem] font-semibold tracking-wider text-muted-foreground uppercase">Billing address</p>
                {billingDiffers(order.billingAddress, order.shippingAddress) ? (
                  <AddressLines address={order.billingAddress} />
                ) : (
                  <p className="text-muted-foreground">Same as shipping address</p>
                )}
              </div>
            </CardContent>
          </Card>

          {fulfillments.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Shipments</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                {fulfillments.map((f) => (
                  <div key={f.id} className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-foreground">{f.carrier ?? "Carrier pending"}{f.awb ? ` · ${f.awb}` : ""}</p>
                      {f.deliveredAt ? (
                        <p className="text-muted-foreground">Delivered {new Date(f.deliveredAt).toLocaleString()}</p>
                      ) : f.shippedAt ? (
                        <p className="text-muted-foreground">Shipped {new Date(f.shippedAt).toLocaleString()}</p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={f.status} />
                      {f.trackingUrl ? (
                        <Button variant="outline" size="sm" nativeButton={false} render={<a href={f.trackingUrl} target="_blank" rel="noreferrer" />}>
                          Track
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

        </div>
      </div>

      <Dialog open={fulfillOpen} onOpenChange={setFulfillOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Fulfill items</DialogTitle>
            <DialogDescription>Choose what is in this parcel. Anything left out can be shipped later with its own tracking number.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {remaining.map((it) => {
              const left = it.quantity - it.fulfilledQty;
              const row = pick[it.id] ?? { on: false, qty: left };
              return (
                <div key={it.id} className="flex items-center gap-3 rounded-md bg-muted px-3 py-2">
                  <Checkbox
                    aria-label={`Include ${it.productTitle}`}
                    checked={row.on}
                    onCheckedChange={(v) => setPick((p) => ({ ...p, [it.id]: { on: v === true, qty: row.qty } }))}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">{it.productTitle}</p>
                    <p className="truncate text-xs text-muted-foreground">{[it.variantTitle, it.sku].filter(Boolean).join(" · ") || "Default"}</p>
                  </div>
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Input
                      aria-label={`Quantity of ${it.productTitle}`}
                      className="h-8 w-16 text-center"
                      inputMode="numeric"
                      disabled={!row.on}
                      value={String(row.qty)}
                      onChange={(e) => {
                        const n = Math.min(left, Math.max(0, Math.floor(Number(e.target.value.replace(/\D/g, "")) || 0)));
                        setPick((p) => ({ ...p, [it.id]: { on: row.on, qty: n } }));
                      }}
                    />
                    of {left}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="fulfil-awb">Tracking number</FieldLabel>
              <Input id="fulfil-awb" value={awb} onChange={(e) => setAwb(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="fulfil-carrier">Shipping carrier</FieldLabel>
              <SimpleSelect id="fulfil-carrier" value={carrier} onChange={setCarrier} options={[...carrierOptions, OTHER_CARRIER].map((c) => ({ value: c, label: c }))} />
            </Field>
          </div>
          {carrier === OTHER_CARRIER ? (
            <Field>
              <FieldLabel htmlFor="fulfil-other">Carrier name</FieldLabel>
              <Input id="fulfil-other" value={otherCarrier} onChange={(e) => setOtherCarrier(e.target.value)} />
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor="fulfil-url">Tracking URL</FieldLabel>
            <Input id="fulfil-url" inputMode="url" placeholder={carrierHasLink ? "Created from the tracking number" : "https://"} value={trackingUrl} onChange={(e) => setTrackingUrl(e.target.value)} aria-invalid={urlInvalid} />
            {urlInvalid ? <p className="text-xs text-destructive">Enter a full link starting with http:// or https://</p> : null}
          </Field>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Switch checked={notify} onCheckedChange={setNotify} aria-label="Notify customer" />
            Notify customer
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFulfillOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={ship.isPending || chosen.length === 0 || urlInvalid || (carrier === OTHER_CARRIER && !carrierName)}
              onClick={() =>
                ship.mutate({
                  id: orderId,
                  items: chosen.map((it) => ({ orderItemId: it.id, quantity: pick[it.id]?.qty ?? 0 })),
                  ...(carrierName ? { carrier: carrierName } : {}),
                  ...(awb.trim() ? { awb: awb.trim() } : {}),
                  ...(trackingUrl.trim() ? { trackingUrl: trackingUrl.trim() } : {}),
                  notify,
                })
              }
            >
              {ship.isPending ? "Saving..." : shipsEverything ? "Mark as fulfilled" : "Mark as partially fulfilled"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={refundOpen} onOpenChange={setRefundOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Refund {order.number}</DialogTitle>
            <DialogDescription>Order total {money(order.grandTotal)}. Enter the amount to refund in rupees.</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="refund-amount">Amount (₹)</FieldLabel>
            <Input id="refund-amount" inputMode="decimal" value={refundRupees} onChange={(e) => setRefundRupees(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="refund-reason">Reason</FieldLabel>
            <Input id="refund-reason" value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder="Optional" />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={refund.isPending || !(Number(refundRupees) > 0)}
              onClick={() => refund.mutate({ id: orderId, amount: Math.round(Number(refundRupees) * 100), ...(refundReason.trim() ? { reason: refundReason.trim() } : {}) })}
            >
              {refund.isPending ? "Refunding..." : "Refund"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel {order.number}?</DialogTitle>
            <DialogDescription>This stops fulfillment and releases reserved stock. It cannot be undone.</DialogDescription>
          </DialogHeader>
          {cancel.isError ? <Alert variant="destructive">{errorMessage(cancel.error)}</Alert> : null}
          <Field>
            <FieldLabel htmlFor="cancel-reason">Reason</FieldLabel>
            <Input id="cancel-reason" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Cancelled by store staff" />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Keep order
            </Button>
            <Button
              variant="destructive"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate({ id: orderId, reason: cancelReason.trim() || "Cancelled by store staff" })}
            >
              {cancel.isPending ? "Cancelling..." : "Cancel order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete order ${order.number}?`}
        description={`This permanently deletes ${order.number} and all associated records. This action cannot be undone. Type "${order.number}" to confirm.`}
        confirmLabel="Delete order"
        confirmDisabled={deleteTypedText.trim() !== order.number}
        pending={deleteOrder.isPending}
        destructive
        onConfirm={() => deleteOrder.mutate({ ids: [orderId] })}
      >
        <div className="pt-2">
          <Input
            aria-label="Confirm deletion"
            placeholder={order.number}
            value={deleteTypedText}
            onChange={(e) => setDeleteTypedText(e.target.value)}
          />
        </div>
      </ConfirmDialog>
    </PageContainer>
  );
}

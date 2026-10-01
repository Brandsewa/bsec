import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, FileText, PackageCheck, RotateCcw, Truck, XCircle } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EmptyState, PageBreadcrumbs, PageContainer, PageHeader, PageSkeleton, toast } from "@bs/ui";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { orpc } from "../../lib/orpc.ts";
import { errorMessage } from "../../lib/errors.ts";
import { StatusBadge, money } from "../../components/order-parts.tsx";

export const Route = createFileRoute("/_store/orders_/$orderId")({
  pendingComponent: () => <PageSkeleton />,
  component: OrderDetailPage,
});

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
  const lines = ADDRESS_ORDER.map((k) => a[k]).filter((v): v is string => typeof v === "string" && v.length > 0);
  if (lines.length === 0) return <p className="text-muted-foreground">No address on file.</p>;
  return (
    <address className="not-italic">
      {lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </address>
  );
}

function OrderDetailPage() {
  const { orderId } = Route.useParams();
  const queryClient = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [note, setNote] = useState("");

  const detail = useQuery(orpc.admin.orders.get.queryOptions({ input: { id: orderId } }));

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.admin.orders.list.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.admin.orders.get.key({ input: { id: orderId } }) });
  };
  const onError = (e: unknown) => toast.error(errorMessage(e));

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
        <PageBreadcrumbs items={[{ label: "Orders", href: "/orders" }, { label: "Order" }]} />
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

  return (
    <PageContainer>
      <PageBreadcrumbs items={[{ label: "Orders", href: "/orders" }, { label: order.number }]} />
      <PageHeader
        title={order.number}
        description={`Placed on ${new Date(order.placedAt).toLocaleString()}`}
        aside={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={order.paymentStatus} />
            <StatusBadge status={order.fulfillmentStatus} />
            {cancelled ? <StatusBadge status="cancelled" /> : null}
          </div>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Items</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-0 divide-y divide-border">
              {items.map((it) => (
                <div key={it.id} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div>
                    <p className="font-medium text-foreground">{it.productTitle}</p>
                    <p className="text-muted-foreground">{it.variantTitle ?? it.sku ?? "Default"}</p>
                    <p className="text-muted-foreground">
                      {money(it.unitPrice)} × {it.quantity}
                      {it.fulfilledQty > 0 ? ` · ${it.fulfilledQty} fulfilled` : ""}
                      {it.returnedQty > 0 ? ` · ${it.returnedQty} returned` : ""}
                    </p>
                  </div>
                  <span className="font-medium text-foreground">{money(it.total)}</span>
                </div>
              ))}
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
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              {order.status === "pending" ? (
                <Button disabled={confirmOrder.isPending} onClick={() => confirmOrder.mutate({ id: orderId })}>
                  <CheckCircle2 className="mr-1.5" /> Confirm order
                </Button>
              ) : null}
              {["pending", "confirmed", "processing", "partially_fulfilled"].includes(order.status) ? (
                <Button disabled={advance.isPending} onClick={() => advance.mutate({ id: orderId, to: "shipped" })}>
                  <Truck className="mr-1.5" /> Mark shipped
                </Button>
              ) : null}
              {["pending", "confirmed", "processing", "partially_fulfilled", "fulfilled"].includes(order.status) ? (
                <Button variant="outline" disabled={advance.isPending} onClick={() => advance.mutate({ id: orderId, to: "delivered" })}>
                  <PackageCheck className="mr-1.5" /> Mark delivered{order.paymentStatus === "cod_pending" ? " & cash collected" : ""}
                </Button>
              ) : null}
              <Button variant="outline" disabled={invoice.isPending} onClick={() => invoice.mutate({ id: orderId })}>
                <FileText className="mr-1.5" /> GST invoice
              </Button>
              {order.status === "delivered" ? (
                <Button variant="ghost" size="sm" nativeButton={false} render={<Link to="/returns" />}>
                  <RotateCcw className="mr-1.5" /> Returns for this store
                </Button>
              ) : null}
              <Button variant="destructive" disabled={cancelled} onClick={() => setCancelOpen(true)}>
                <XCircle className="mr-1.5" /> Cancel order
              </Button>
            </CardContent>
          </Card>

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
              <CardTitle>Customer</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div>
                <p className="text-foreground">{order.email}</p>
                <p className="text-muted-foreground">{order.phone}</p>
              </div>
              <div>
                <p className="mb-1 text-[0.625rem] font-semibold tracking-wider text-muted-foreground uppercase">Shipping address</p>
                <AddressLines address={order.shippingAddress} />
              </div>
            </CardContent>
          </Card>

          <Button variant="ghost" size="sm" className="justify-start" nativeButton={false} render={<Link to="/orders" />}>
            <RotateCcw className="mr-1.5 rotate-180" /> Back to orders
          </Button>
        </div>
      </div>

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
    </PageContainer>
  );
}

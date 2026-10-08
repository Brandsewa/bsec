import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Archive,
  Camera,
  CheckCircle2,
  ExternalLink,
  PackageCheck,
  RotateCcw,
  Trash2,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  PageBreadcrumbs,
  PageContainer,
  PageHeader,
  PageSkeleton,
  SimpleSelect,
  Textarea,
  toast,
} from "@bs/ui";
import { StatusBadge } from "../../components/order-parts.tsx";
import { errorMessage } from "../../lib/errors.ts";
import { client, orpc } from "../../lib/orpc.ts";

export const Route = createFileRoute("/_store/returns_/$returnId")({
  pendingComponent: () => <PageSkeleton />,
  component: ReturnDetailPage,
});

function inr(amount: number) {
  return `₹${(amount / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

type ActionKind = "approve" | "reject" | "pick_up" | "receive" | "refund" | "replace" | "close";

export function ReturnDetailPage() {
  const { returnId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const detailQuery = useQuery(
    orpc.admin.returns.get.queryOptions({
      input: { id: returnId },
    }),
  );

  const [toDelete, setToDelete] = useState(false);
  const [actionDialog, setActionDialog] = useState<ActionKind | null>(null);
  const [dialogFields, setDialogFields] = useState<{
    resolution: "refund" | "replacement";
    decisionMessage: string;
    adminNote: string;
    restock: boolean;
    refundAmount: string;
    refundMethod: "upi" | "bank_transfer" | "cash" | "original_payment_method" | "other";
    refundReference: string;
    exchangeNote: string;
    exchangeOrderId: string;
  }>({
    resolution: "refund",
    decisionMessage: "",
    adminNote: "",
    restock: true,
    refundAmount: "",
    refundMethod: "upi",
    refundReference: "",
    exchangeNote: "",
    exchangeOrderId: "",
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.admin.returns.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.admin.returns.get.key({ input: { id: returnId } }) });
  };

  const actMutation = useMutation(
    orpc.admin.returns.act.mutationOptions({
      onSuccess: () => {
        toast.success("Return status updated");
        setActionDialog(null);
        refresh();
      },
      onError: (err) => toast.error(errorMessage(err)),
    }),
  );

  const archiveMutation = useMutation({
    mutationFn: (id: string) => client.admin.returns.archive({ id }),
    onSuccess: () => {
      toast.success("Return archived");
      refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => client.admin.returns.restore({ id }),
    onSuccess: () => {
      toast.success("Return restored");
      refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => client.admin.returns.delete({ id }),
    onSuccess: () => {
      toast.success("Return deleted permanently");
      void queryClient.invalidateQueries({ queryKey: orpc.admin.returns.key() });
      void navigate({ to: "/returns" });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  function openAction(action: ActionKind) {
    if (!detailQuery.data) return;
    const d = detailQuery.data;
    const isExchange = d.requestedResolution === "replacement" || d.resolution === "replacement";
    const defaultAmount = ((d.refundAmount ?? d.computedRefundAmount) / 100).toFixed(2);
    setDialogFields({
      resolution: isExchange ? "replacement" : "refund",
      decisionMessage: "",
      adminNote: "",
      restock: true,
      refundAmount: defaultAmount,
      refundMethod: "upi",
      refundReference: "",
      exchangeNote: d.exchangeRequest ?? "",
      exchangeOrderId: "",
    });
    setActionDialog(action);
  }

  function handleDialogSubmit() {
    if (!actionDialog || !detailQuery.data) return;
    const action = actionDialog;

    if (action === "reject" && !dialogFields.decisionMessage.trim()) {
      toast.error("Please provide a reason for rejection.");
      return;
    }

    if (action === "refund") {
      const parsedAmount = Math.round(parseFloat(dialogFields.refundAmount) * 100);
      if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
        toast.error("Please enter a valid refund amount.");
        return;
      }
      actMutation.mutate({
        id: returnId,
        action: "refund",
        refundAmount: parsedAmount,
        refundMethod: dialogFields.refundMethod,
        refundReference: dialogFields.refundReference.trim() || undefined,
        note: dialogFields.adminNote.trim() || undefined,
      });
      return;
    }

    if (action === "replace") {
      actMutation.mutate({
        id: returnId,
        action: "replace",
        exchangeNote: dialogFields.exchangeNote.trim() || undefined,
        exchangeOrderId: dialogFields.exchangeOrderId.trim() || undefined,
        note: dialogFields.adminNote.trim() || undefined,
      });
      return;
    }

    if (action === "receive") {
      actMutation.mutate({
        id: returnId,
        action: "receive",
        restock: dialogFields.restock,
        note: dialogFields.adminNote.trim() || undefined,
      });
      return;
    }

    actMutation.mutate({
      id: returnId,
      action,
      resolution: action === "approve" ? dialogFields.resolution : undefined,
      decisionMessage: action === "approve" || action === "reject" ? dialogFields.decisionMessage.trim() || undefined : undefined,
      note: dialogFields.adminNote.trim() || undefined,
    });
  }

  if (detailQuery.isLoading) {
    return (
      <PageContainer>
        <PageSkeleton />
      </PageContainer>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <PageContainer size="small">
        <PageBreadcrumbs items={[{ label: "Returns", href: "/returns" }, { label: "Return" }]} />
        <EmptyState
          icon={RotateCcw}
          title="Could not load return"
          description={detailQuery.error ? errorMessage(detailQuery.error) : "This return request could not be found."}
          action={<Button onClick={() => void detailQuery.refetch()}>Try again</Button>}
        />
      </PageContainer>
    );
  }

  const d = detailQuery.data;

  return (
    <PageContainer>
      <PageBreadcrumbs items={[{ label: "Returns", href: "/returns" }, { label: d.number }]} />
      <PageHeader
        title={d.number}
        description={`Requested on ${new Date(d.createdAt).toLocaleString("en-IN")}`}
        aside={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={d.status} />
            <Badge variant="outline" className="capitalize">
              {d.resolution === "replacement" ? "Exchange" : "Refund"}
            </Badge>
          </div>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* Left main content */}
        <div className="grid gap-4">
          {/* Order Details Card */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Order details</CardTitle>
              {d.order?.id ? (
                <Link
                  to="/orders/$orderId"
                  params={{ orderId: d.order.id }}
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <span>{d.order.number}</span>
                  <ExternalLink className="size-3" />
                </Link>
              ) : null}
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-muted-foreground">Customer:</span>{" "}
                <span className="font-medium text-foreground">{d.order?.customerName || "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Email:</span>{" "}
                <span className="font-medium text-foreground">{d.order?.customerEmail || "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Order total:</span>{" "}
                <span className="font-medium text-foreground">{inr(d.order?.grandTotal ?? 0)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Payment:</span>{" "}
                <span className="font-medium text-foreground uppercase">{d.order?.paymentMethod || "—"}</span>
              </div>
            </CardContent>
          </Card>

          {/* Returned Items Card */}
          <Card>
            <CardHeader>
              <CardTitle>Items in this return</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-0 divide-y divide-border">
              {(d.items ?? []).map((item) => (
                <div key={item.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0 text-xs">
                  <div>
                    <p className="font-medium text-foreground">{item.title}</p>
                    {item.variantTitle && <p className="text-muted-foreground">{item.variantTitle}</p>}
                    <p className="text-muted-foreground">
                      Qty: {item.quantity} × {inr(item.unitPrice ?? 0)}
                    </p>
                  </div>
                  <span className="font-semibold text-foreground">{inr(item.lineTotal ?? 0)}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Reason & Request details */}
          <Card>
            <CardHeader>
              <CardTitle>Reason & Request Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-0 divide-y divide-border text-xs">
              <div className="py-2.5 first:pt-0 flex justify-between">
                <span className="text-muted-foreground">Reason:</span>
                <span className="font-medium text-foreground">{d.reason}</span>
              </div>
              <div className="py-2.5 flex justify-between">
                <span className="text-muted-foreground">Resolution preference:</span>
                <span className="font-medium text-foreground capitalize">{d.resolution}</span>
              </div>
              {d.exchangeRequest && (
                <div className="py-2.5 space-y-1">
                  <span className="text-muted-foreground">Customer exchange request:</span>
                  <p className="font-medium text-foreground bg-muted/50 p-2 rounded">{d.exchangeRequest}</p>
                </div>
              )}
              {d.customerComment && (
                <div className="py-2.5 space-y-1">
                  <span className="text-muted-foreground">Customer comments:</span>
                  <p className="text-foreground">{d.customerComment}</p>
                </div>
              )}
              {d.decisionMessage && (
                <div className="py-2.5 space-y-1 bg-blue-50/50 dark:bg-blue-950/20 px-2 rounded">
                  <span className="text-blue-700 dark:text-blue-300 font-semibold">Message to customer:</span>
                  <p className="text-foreground">{d.decisionMessage}</p>
                </div>
              )}
              {d.adminNote && (
                <div className="py-2.5 space-y-1 bg-muted/40 px-2 rounded">
                  <span className="text-muted-foreground font-semibold">Staff internal note:</span>
                  <p className="text-foreground">{d.adminNote}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Photo Proof Gallery */}
          {Array.isArray(d.photos) && d.photos.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5 text-sm">
                  <Camera className="size-4" /> Photo Proof ({d.photos.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {d.photos.map((p, idx) => {
                    const url = typeof p === "string" ? p : p.url;
                    const id = typeof p === "string" ? idx : (p.id ?? idx);
                    return (
                      <a
                        key={id}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted/30 hover:opacity-90"
                      >
                        <img src={url} alt={`Return photo ${idx + 1}`} className="h-full w-full object-cover" />
                        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                          <ExternalLink className="size-5 text-white" />
                        </div>
                      </a>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Resolution Outcome Card */}
          {(d.refundAmount || d.refundMethod || d.exchangeNote || d.exchangeOrderId) && (
            <Card>
              <CardHeader>
                <CardTitle>Resolution Record</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-xs">
                {d.refundAmount && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Refunded amount:</span>
                    <span className="font-bold text-foreground">{inr(d.refundAmount)}</span>
                  </div>
                )}
                {d.refundMethod && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Refund method:</span>
                    <span className="font-medium text-foreground uppercase">{d.refundMethod.replace(/_/g, " ")}</span>
                  </div>
                )}
                {d.refundReference && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Reference / UTR:</span>
                    <span className="font-mono text-foreground">{d.refundReference}</span>
                  </div>
                )}
                {d.refundedAt && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Refunded date:</span>
                    <span className="text-foreground">{new Date(d.refundedAt).toLocaleString("en-IN")}</span>
                  </div>
                )}
                {d.exchangeNote && (
                  <div className="space-y-1">
                    <span className="text-muted-foreground">Exchange fulfillment note:</span>
                    <p className="font-medium text-foreground">{d.exchangeNote}</p>
                  </div>
                )}
                {d.exchangeOrderId && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Replacement Order:</span>
                    <span className="font-mono text-foreground">{d.exchangeOrderId}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column: Actions & Navigation */}
        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              {d.status === "requested" && (
                <>
                  <Button size="sm" onClick={() => openAction("approve")}>
                    <CheckCircle2 className="mr-1.5 size-3.5" /> Approve return
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => openAction("reject")}>
                    <XCircle className="mr-1.5 size-3.5" /> Reject return
                  </Button>
                </>
              )}
              {d.status === "approved" && (
                <Button size="sm" onClick={() => openAction("pick_up")}>
                  <PackageCheck className="mr-1.5 size-3.5" /> Mark picked up
                </Button>
              )}
              {(d.status === "approved" || d.status === "picked_up") && (
                <Button size="sm" variant={d.status === "picked_up" ? "default" : "outline"} onClick={() => openAction("receive")}>
                  <PackageCheck className="mr-1.5 size-3.5" /> Mark received & inspect
                </Button>
              )}
              {d.status === "received" && (
                <>
                  <Button size="sm" onClick={() => openAction("refund")}>
                    Record refund
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openAction("replace")}>
                    Record exchange
                  </Button>
                </>
              )}
              {(d.status === "refunded" || d.status === "replaced" || d.status === "rejected" || d.status === "cancelled") && (
                <Button size="sm" variant="outline" onClick={() => openAction("close")}>
                  Close case
                </Button>
              )}

              {d.status !== "archived" ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={archiveMutation.isPending}
                  onClick={() => archiveMutation.mutate(returnId)}
                >
                  <Archive className="mr-1.5 size-3.5" /> Archive return
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={restoreMutation.isPending}
                    onClick={() => restoreMutation.mutate(returnId)}
                  >
                    <RotateCcw className="mr-1.5 size-3.5" /> Restore return
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={deleteMutation.isPending}
                    onClick={() => setToDelete(true)}
                  >
                    <Trash2 className="mr-1.5 size-3.5" /> Delete permanently
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          <Button variant="ghost" size="sm" className="justify-start" nativeButton={false} render={<Link to="/returns" />}>
            <RotateCcw className="mr-1.5 rotate-180 size-3.5" /> Back to returns
          </Button>
        </div>
      </div>

      {/* Mobile Sticky Actions Bar */}
      <div className="lg:hidden sticky bottom-0 z-20 -mx-4 -mb-4 mt-4 bg-background/95 backdrop-blur border-t p-3 flex flex-wrap items-center gap-2 shadow-lg">
        {d.status === "requested" && (
          <>
            <Button size="sm" className="flex-1" onClick={() => openAction("approve")}>
              <CheckCircle2 className="mr-1.5 size-3.5" /> Approve return
            </Button>
            <Button size="sm" variant="destructive" onClick={() => openAction("reject")}>
              <XCircle className="mr-1.5 size-3.5" /> Reject
            </Button>
          </>
        )}
        {d.status === "approved" && (
          <Button size="sm" className="w-full" onClick={() => openAction("pick_up")}>
            <PackageCheck className="mr-1.5 size-3.5" /> Mark picked up
          </Button>
        )}
        {(d.status === "approved" || d.status === "picked_up") && (
          <Button size="sm" className="w-full" variant={d.status === "picked_up" ? "default" : "outline"} onClick={() => openAction("receive")}>
            <PackageCheck className="mr-1.5 size-3.5" /> Mark received & inspect
          </Button>
        )}
        {d.status === "received" && (
          <>
            <Button size="sm" className="flex-1" onClick={() => openAction("refund")}>
              Record refund
            </Button>
            <Button size="sm" variant="outline" className="flex-1" onClick={() => openAction("replace")}>
              Record exchange
            </Button>
          </>
        )}
        {(d.status === "refunded" || d.status === "replaced" || d.status === "rejected" || d.status === "cancelled") && (
          <Button size="sm" variant="outline" className="w-full" onClick={() => openAction("close")}>
            Close case
          </Button>
        )}
      </div>

      {/* Action Dialog */}
      {actionDialog && (
        <Dialog open={actionDialog !== null} onOpenChange={(o) => !o && setActionDialog(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {actionDialog === "approve" && "Approve Return Request"}
                {actionDialog === "reject" && "Reject Return Request"}
                {actionDialog === "pick_up" && "Mark Items Picked Up"}
                {actionDialog === "receive" && "Receive & Inspect Items"}
                {actionDialog === "refund" && "Record Refund"}
                {actionDialog === "replace" && "Record Replacement / Exchange"}
                {actionDialog === "close" && "Close Return Case"}
              </DialogTitle>
              <DialogDescription>
                {actionDialog === "approve" && "Approve this request and send return instructions to the customer."}
                {actionDialog === "reject" && "Provide a clear reason explaining why this request cannot be fulfilled."}
                {actionDialog === "pick_up" && "Confirm that courier or pickup agent has collected the package."}
                {actionDialog === "receive" && "Verify items have arrived back at the warehouse/store."}
                {actionDialog === "refund" && "Record the refund details issued to the customer."}
                {actionDialog === "replace" && "Link or note the replacement order provided to the customer."}
                {actionDialog === "close" && "Mark this return request case as completed and closed."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {actionDialog === "approve" && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Approved resolution</label>
                    <SimpleSelect
                      value={dialogFields.resolution}
                      onChange={(val) => setDialogFields((prev) => ({ ...prev, resolution: val as "refund" | "replacement" }))}
                      options={[
                        { value: "refund", label: "Approve for Refund" },
                        { value: "replacement", label: "Approve for Exchange / Replacement" },
                      ]}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Instructions message (sent to customer)</label>
                    <Textarea
                      rows={3}
                      placeholder="Optional custom instructions for packaging and pickup..."
                      value={dialogFields.decisionMessage}
                      onChange={(e) => setDialogFields((prev) => ({ ...prev, decisionMessage: e.target.value }))}
                    />
                  </div>
                </>
              )}

              {actionDialog === "reject" && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Reason for Rejection (required)</label>
                    <Textarea
                      rows={3}
                      required
                      placeholder="Explain to the customer why this request cannot be accepted."
                      value={dialogFields.decisionMessage}
                      onChange={(e) => setDialogFields((prev) => ({ ...prev, decisionMessage: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Staff note (internal)</label>
                    <Input
                      placeholder="Internal reason"
                      value={dialogFields.adminNote}
                      onChange={(e) => setDialogFields((prev) => ({ ...prev, adminNote: e.target.value }))}
                    />
                  </div>
                </>
              )}

              {actionDialog === "receive" && (
                <>
                  <div className="flex items-center justify-between rounded-lg border border-border p-3">
                    <div className="space-y-0.5">
                      <label htmlFor="restock-returned-items" className="font-medium text-foreground cursor-pointer">Restock returned items</label>
                      <p className="text-xs text-muted-foreground">Add returned quantities back to inventory on hand.</p>
                    </div>
                    <Checkbox
                      id="restock-returned-items"
                      checked={dialogFields.restock}
                      onCheckedChange={(checked) => setDialogFields((prev) => ({ ...prev, restock: Boolean(checked) }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Inspection note (internal)</label>
                    <Input
                      placeholder="e.g. Item inspected, tags intact, approved for restock."
                      value={dialogFields.adminNote}
                      onChange={(e) => setDialogFields((prev) => ({ ...prev, adminNote: e.target.value }))}
                    />
                  </div>
                </>
              )}

              {actionDialog === "refund" && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Refund Amount (INR)</label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={dialogFields.refundAmount}
                      onChange={(e) => setDialogFields((prev) => ({ ...prev, refundAmount: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Payment Method</label>
                    <SimpleSelect
                      value={dialogFields.refundMethod}
                      onChange={(val) => setDialogFields((prev) => ({ ...prev, refundMethod: val as "upi" | "bank_transfer" | "cash" | "original_payment_method" | "other" }))}
                      options={[
                        { value: "upi", label: "UPI" },
                        { value: "bank_transfer", label: "Bank Transfer (NEFT/IMPS)" },
                        { value: "cash", label: "Cash" },
                        { value: "original_payment_method", label: "Original Payment Method" },
                        { value: "other", label: "Other" },
                      ]}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Reference / Transaction ID</label>
                    <Input
                      placeholder="e.g. UPI Ref # or Bank UTR"
                      value={dialogFields.refundReference}
                      onChange={(e) => setDialogFields((prev) => ({ ...prev, refundReference: e.target.value }))}
                    />
                  </div>
                </>
              )}

              {actionDialog === "replace" && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Exchange fulfillment note</label>
                    <Textarea
                      rows={2}
                      placeholder="e.g. Sent replacement Size L via Bluedart AWB 12345"
                      value={dialogFields.exchangeNote}
                      onChange={(e) => setDialogFields((prev) => ({ ...prev, exchangeNote: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Replacement Order ID (optional)</label>
                    <Input
                      placeholder="e.g. Order # or ID"
                      value={dialogFields.exchangeOrderId}
                      onChange={(e) => setDialogFields((prev) => ({ ...prev, exchangeOrderId: e.target.value }))}
                    />
                  </div>
                </>
              )}

              {(actionDialog === "pick_up" || actionDialog === "close") && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Internal staff note (optional)</label>
                  <Input
                    placeholder="Staff notes..."
                    value={dialogFields.adminNote}
                    onChange={(e) => setDialogFields((prev) => ({ ...prev, adminNote: e.target.value }))}
                  />
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setActionDialog(null)}>
                Cancel
              </Button>
              <Button
                disabled={actMutation.isPending}
                variant={actionDialog === "reject" ? "destructive" : "default"}
                onClick={handleDialogSubmit}
              >
                {actMutation.isPending ? "Saving..." : "Confirm"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={toDelete}
        onOpenChange={setToDelete}
        title={`Delete return "${d.number}"?`}
        description="This will permanently delete this return record and cannot be undone."
        confirmLabel="Delete permanently"
        cancelLabel="Keep in archive"
        destructive
        onConfirm={() => deleteMutation.mutate(returnId)}
      />
    </PageContainer>
  );
}
export default ReturnDetailPage;

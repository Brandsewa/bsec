import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button, PageBreadcrumbs, PageContainer, PageHeader, PageSection, PageSkeleton, TableSkeleton } from "@bs/ui";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../../lib/orpc.ts";

export const Route = createFileRoute("/_store/returns")({
  pendingComponent: () => (
    <PageSkeleton>
      <TableSkeleton rows={6} columns={5} />
    </PageSkeleton>
  ),
  component: ReturnsPage,
});

type Action = "approve" | "reject" | "pick_up" | "receive" | "refund" | "close";

/** The next step(s) a merchant can take from each return status. */
const NEXT: Record<string, Array<{ action: Action; label: string; primary?: boolean; askNote?: boolean }>> = {
  requested: [
    { action: "approve", label: "Approve", primary: true },
    { action: "reject", label: "Reject", askNote: true },
  ],
  approved: [{ action: "pick_up", label: "Mark picked up", primary: true }],
  picked_up: [{ action: "receive", label: "Mark received (restock)", primary: true }],
  received: [{ action: "refund", label: "Refund", primary: true }],
  refunded: [{ action: "close", label: "Close" }],
  replaced: [{ action: "close", label: "Close" }],
};

const FILTERS = [
  { id: "", label: "All" },
  { id: "requested", label: "New" },
  { id: "approved", label: "Approved" },
  { id: "picked_up", label: "On the way" },
  { id: "received", label: "Received" },
  { id: "refunded", label: "Refunded" },
];

const inr = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export function ReturnsPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery(orpc.admin.returns.list.queryOptions({ input: status ? { status } : {} }));
  const act = useMutation(
    orpc.admin.returns.act.mutationOptions({
      onSuccess: () => {
        setError(null);
        queryClient.invalidateQueries({ queryKey: orpc.admin.returns.list.key() });
      },
      onError: (err: Error) => setError(err.message || "That didn't work"),
    }),
  );

  const run = (id: string, step: (typeof NEXT)[string][number], refundAmount: number) => {
    let note: string | undefined;
    if (step.askNote) {
      const answer = window.prompt("Reason shown to the shopper (optional)") ;
      if (answer === null) return;
      note = answer || undefined;
    }
    if (step.action === "refund" && !window.confirm(`Record a refund of ${inr(refundAmount)}? For cash on delivery, send the money to the shopper yourself.`)) return;
    act.mutate({ id, action: step.action, note });
  };

  const items = data?.items ?? [];

  return (
    <PageContainer>
      <PageBreadcrumbs items={[{ label: "Returns" }]} />
      <PageHeader title="Returns" description="Requests from shoppers whose orders were delivered." />
      {error && <div className="mb-3 rounded-md bg-rose-500/10 p-3 text-sm text-rose-600">{error}</div>}
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button key={f.id} size="sm" variant={status === f.id ? "primary" : "default"} onClick={() => setStatus(f.id)}>
            {f.label}
          </Button>
        ))}
      </div>
      <PageSection>
        {isLoading ? (
          <TableSkeleton rows={4} columns={5} />
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-sm text-foreground-muted">No returns here. When a shopper asks to return a delivered order it shows up in this list.</p>
        ) : (
          <div className="divide-y divide-surface-200">
            {items.map((r) => (
              <div key={r.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">{r.number}</span>
                    <span className="rounded-full bg-surface-200 px-2 py-0.5 text-xs font-semibold uppercase">{r.status.replace(/_/g, " ")}</span>
                  </div>
                  <div className="text-sm text-foreground-muted">
                    Order {r.orderNumber}
                    {r.customerEmail ? ` · ${r.customerEmail}` : ""} · {new Date(r.createdAt).toLocaleDateString()}
                  </div>
                  <div className="text-sm">{r.items.map((i) => `${i.quantity} × ${i.title}`).join(", ")}</div>
                  <div className="text-sm text-foreground-muted">“{r.reason}”</div>
                  {r.adminNote && <div className="text-xs text-foreground-muted">Your note: {r.adminNote}</div>}
                  <div className="text-sm font-medium">Refund value: {inr(r.refundAmount)}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(NEXT[r.status] ?? []).map((step) => (
                    <Button
                      key={step.action}
                      size="sm"
                      variant={step.primary ? "primary" : "default"}
                      disabled={act.isPending}
                      onClick={() => run(r.id, step, r.refundAmount)}
                    >
                      {step.label}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </PageSection>
    </PageContainer>
  );
}

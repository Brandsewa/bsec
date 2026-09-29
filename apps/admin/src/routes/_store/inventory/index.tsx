import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowUpDown, Box, Warehouse } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FilterBar,
  Input,
  Label,
  MetricCard,
  MetricCardSkeleton,
  PageBreadcrumbs,
  PageContainer,
  PageHeader,
  PageSection,
  PageSkeleton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TableSkeleton,
  toast,
  type ColumnDef,
} from "@bs/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../../../lib/orpc.ts";

export const INVENTORY_PAGE_SIZE = 50;

type Reason = "received" | "sold" | "damaged" | "returned" | "correction" | "transfer";

export const Route = createFileRoute("/_store/inventory/")({
  pendingComponent: () => (
    <PageSkeleton>
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </div>
      <TableSkeleton rows={10} columns={6} />
    </PageSkeleton>
  ),
  component: InventoryRoute,
});

function InventoryRoute() {
  const navigate = useNavigate();
  return <InventoryPage navigate={(to) => void navigate({ to })} />;
}

export function InventoryPage({ navigate }: { navigate?: (to: string) => void }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const listQuery = useQuery(
    orpc.admin.inventory.list.queryOptions({
      input: {
        search: debounced ? debounced : undefined,
        limit: INVENTORY_PAGE_SIZE,
        offset: page * INVENTORY_PAGE_SIZE,
      },
    }),
  );

  const items = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;
  type Row = (typeof items)[number];

  const [adjustItem, setAdjustItem] = useState<Row | null>(null);
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState<Reason>("received");
  const [note, setNote] = useState("");
  const [deltaError, setDeltaError] = useState<string | null>(null);

  const closeDialog = () => {
    setAdjustItem(null);
    setDelta("");
    setNote("");
    setReason("received");
    setDeltaError(null);
  };

  const adjustMutation = useMutation(
    orpc.admin.inventory.adjust.mutationOptions({
      onSuccess: (res) => {
        toast.success(`Stock adjusted. New on-hand quantity: ${res.newOnHand}`);
        void queryClient.invalidateQueries({ queryKey: orpc.admin.inventory.list.key() });
        closeDialog();
      },
      onError: (err: Error) => toast.error(err.message || "Failed to adjust stock"),
    }),
  );

  const handleAdjustSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustItem) return;
    const qty = Number(delta);
    if (delta.trim() === "" || !Number.isInteger(qty)) {
      setDeltaError("Enter a whole number, e.g. 10 or -5");
      return;
    }
    if (qty === 0) {
      setDeltaError("Adjustment cannot be zero");
      return;
    }
    if (adjustItem.onHand + qty < 0) {
      setDeltaError(`Cannot remove more than the ${adjustItem.onHand} units on hand`);
      return;
    }
    setDeltaError(null);
    adjustMutation.mutate({
      variantId: adjustItem.variantId,
      locationId: adjustItem.locationId,
      quantityDelta: qty,
      reason,
      ...(note.trim() ? { notes: note.trim() } : {}),
    });
  };

  const paged = total > items.length;
  const suffix = paged ? " (this page)" : "";
  const totalOnHand = items.reduce((acc, r) => acc + r.onHand, 0);
  const totalReserved = items.reduce((acc, r) => acc + r.reserved, 0);
  const totalAvailable = items.reduce((acc, r) => acc + r.available, 0);

  const columns: ColumnDef<Row>[] = [
    {
      header: "Item & Variant",
      cell: (item) => (
        <div className="flex flex-col">
          <span className="font-medium text-foreground">{item.productTitle ?? item.variantTitle ?? "Variant"}</span>
          <span className="text-xs text-foreground-lighter">
            {[item.variantTitle, item.variantSku].filter(Boolean).join(" · ")}
          </span>
        </div>
      ),
    },
    {
      header: "Location",
      cell: (item) => (
        <span className="flex items-center gap-1.5 text-xs text-foreground-muted">
          <Warehouse className="size-3.5" aria-hidden />
          {item.locationName ?? "—"}
        </span>
      ),
    },
    {
      header: "On Hand",
      className: "text-right",
      headerClassName: "text-right",
      cell: (item) => <span className="font-mono text-sm text-foreground">{item.onHand}</span>,
    },
    {
      header: "Reserved",
      className: "text-right",
      headerClassName: "text-right",
      cell: (item) => <span className="font-mono text-sm text-foreground-lighter">{item.reserved}</span>,
    },
    {
      header: "Available",
      className: "text-right",
      headerClassName: "text-right",
      cell: (item) => (
        <span className={`font-mono text-sm font-medium ${item.available <= 5 ? "text-amber-500" : "text-emerald-500"}`}>
          {item.available}
        </span>
      ),
    },
    {
      header: "Actions",
      className: "text-right",
      headerClassName: "text-right",
      cell: (item) => (
        <Button variant="default" size="sm" onClick={() => setAdjustItem(item)}>
          <ArrowUpDown className="mr-1.5 size-3" aria-hidden />
          Adjust
        </Button>
      ),
    },
  ];

  const from = total === 0 ? 0 : page * INVENTORY_PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * INVENTORY_PAGE_SIZE);
  const hasFilters = debounced.length > 0 || search.length > 0;

  let metrics = (
    <div className="grid gap-4 sm:grid-cols-3">
      <MetricCardSkeleton />
      <MetricCardSkeleton />
      <MetricCardSkeleton />
    </div>
  );
  let body;
  if (listQuery.isError) {
    metrics = <></>;
    body = (
      <EmptyState
        icon={AlertTriangle}
        title="Could not load inventory"
        description={listQuery.error instanceof Error ? listQuery.error.message : "Something went wrong."}
        action={
          <Button variant="default" size="sm" onClick={() => void listQuery.refetch()}>
            Retry
          </Button>
        }
      />
    );
  } else if (listQuery.isLoading) {
    body = <TableSkeleton rows={5} columns={6} />;
  } else {
    metrics = (
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label={`Total On Hand${suffix}`} value={totalOnHand} icon={Box} />
        <MetricCard label={`Available to Sell${suffix}`} value={totalAvailable} />
        <MetricCard label={`Reserved${suffix}`} value={totalReserved} />
      </div>
    );
    if (total === 0 && !hasFilters) {
      metrics = <></>;
      body = (
        <EmptyState
          icon={Warehouse}
          title="No inventory yet"
          description="Inventory levels appear here once products with tracked variants exist. Create a product to get started."
          action={
            <Button variant="primary" size="sm" onClick={() => navigate?.("/products/new")}>
              Add a product
            </Button>
          }
        />
      );
    } else {
      body = (
        <>
          <DataTable
            data={items}
            columns={columns}
            keyExtractor={(item) => item.id}
            emptyTitle="No inventory levels match"
            emptyDescription="Try a different SKU or product name."
          />
          <div className="flex items-center justify-between text-xs text-foreground-muted">
            <span>
              {from}-{to} of {total}
            </span>
            <div className="flex gap-2">
              <Button variant="default" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button
                variant="default"
                size="sm"
                disabled={(page + 1) * INVENTORY_PAGE_SIZE >= total}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      );
    }
  }

  return (
    <PageContainer size="full">
      <PageBreadcrumbs items={[{ label: "Inventory" }]} />

      <PageHeader
        title="Inventory"
        description="Track on-hand stock and record inventory adjustments across warehouse locations."
      />

      {metrics}

      <PageSection>
        <div className="grid gap-4">
          <FilterBar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search by SKU or product..."
            hasActiveFilters={hasFilters}
            onReset={() => {
              setSearch("");
              setDebounced("");
              setPage(0);
            }}
          />
          {body}
        </div>
      </PageSection>

      {adjustItem ? (
        <Dialog open onOpenChange={(open) => !open && closeDialog()}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Adjust Stock Level</DialogTitle>
              <DialogDescription>
                Recording a stock movement for {adjustItem.productTitle ?? adjustItem.variantTitle ?? "this variant"}
                {adjustItem.variantSku ? ` (${adjustItem.variantSku})` : ""}. Currently {adjustItem.onHand} on hand.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleAdjustSubmit} className="grid gap-4 py-2" noValidate>
              <div className="grid gap-1.5">
                <Label htmlFor="qty-delta">Adjustment quantity *</Label>
                <Input
                  id="qty-delta"
                  type="number"
                  value={delta}
                  onChange={(e) => setDelta(e.target.value)}
                  placeholder="e.g. 10 or -5"
                  aria-invalid={Boolean(deltaError)}
                />
                {deltaError ? (
                  <p role="alert" className="text-xs text-rose-500">
                    {deltaError}
                  </p>
                ) : null}
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="adj-reason">Reason *</Label>
                <Select value={reason} onValueChange={(val) => setReason((val as Reason | null) ?? "received")}>
                  <SelectTrigger id="adj-reason">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="received">Received from supplier</SelectItem>
                    <SelectItem value="sold">Sold</SelectItem>
                    <SelectItem value="damaged">Damaged stock</SelectItem>
                    <SelectItem value="returned">Customer return</SelectItem>
                    <SelectItem value="correction">Inventory count correction</SelectItem>
                    <SelectItem value="transfer">Warehouse transfer</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="adj-note">Note (optional)</Label>
                <Input
                  id="adj-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Audit reference or reason details..."
                />
              </div>

              <DialogFooter>
                <Button type="button" variant="default" onClick={closeDialog}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={adjustMutation.isPending}>
                  {adjustMutation.isPending ? "Adjusting..." : "Confirm Adjustment"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </PageContainer>
  );
}

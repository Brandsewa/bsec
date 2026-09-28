import { createFileRoute } from "@tanstack/react-router";
import { ArrowUpDown, Box, Check, Warehouse } from "lucide-react";
import { useState } from "react";
import {
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  type ColumnDef,
} from "@bs/ui";

interface InventoryRow {
  id: string;
  variantId: string;
  variantTitle: string;
  sku: string;
  locationName: string;
  onHand: number;
  reserved: number;
  available: number;
}

const initialInventory: InventoryRow[] = [
  {
    id: "inv-1",
    variantId: "0199a000-0000-7000-8000-000000000505",
    variantTitle: "Small / Black",
    sku: "TSHIRT-BLK-S",
    locationName: "Main Warehouse",
    onHand: 42,
    reserved: 2,
    available: 40,
  },
  {
    id: "inv-2",
    variantId: "0199a000-0000-7000-8000-000000000506",
    variantTitle: "Medium / Black",
    sku: "TSHIRT-BLK-M",
    locationName: "Main Warehouse",
    onHand: 15,
    reserved: 0,
    available: 15,
  },
];

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
  component: InventoryPage,
});

function InventoryPage() {
  const [items, setItems] = useState<InventoryRow[]>(initialInventory);
  const [search, setSearch] = useState("");
  const [adjustItem, setAdjustItem] = useState<InventoryRow | null>(null);
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState<string>("received");
  const [note, setNote] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);

  const filteredItems = items.filter(
    (item) =>
      item.sku.toLowerCase().includes(search.toLowerCase()) ||
      item.variantTitle.toLowerCase().includes(search.toLowerCase()),
  );

  const totalOnHand = items.reduce((acc, curr) => acc + curr.onHand, 0);
  const totalReserved = items.reduce((acc, curr) => acc + curr.reserved, 0);
  const totalAvailable = items.reduce((acc, curr) => acc + curr.available, 0);

  const handleAdjustSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustItem) return;
    const qtyDelta = parseInt(delta, 10);
    if (isNaN(qtyDelta)) return;

    setItems((prev) =>
      prev.map((item) => {
        if (item.id === adjustItem.id) {
          const newOnHand = Math.max(0, item.onHand + qtyDelta);
          return {
            ...item,
            onHand: newOnHand,
            available: newOnHand - item.reserved,
          };
        }
        return item;
      }),
    );

    setIsSuccess(true);
    setTimeout(() => {
      setIsSuccess(false);
      setAdjustItem(null);
      setDelta("");
      setNote("");
    }, 400);
  };

  const columns: ColumnDef<InventoryRow>[] = [
    {
      header: "Item & Variant",
      cell: (item) => (
        <div className="flex flex-col">
          <span className="font-medium text-foreground">{item.variantTitle}</span>
          <span className="text-xs text-foreground-lighter">{item.sku}</span>
        </div>
      ),
    },
    {
      header: "Location",
      cell: (item) => (
        <span className="flex items-center gap-1.5 text-xs text-foreground-muted">
          <Warehouse className="size-3.5" aria-hidden />
          {item.locationName}
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

  return (
    <PageContainer size="full">
      <PageBreadcrumbs items={[{ label: "Inventory" }]} />

      <PageHeader
        title="Inventory"
        description="Track on-hand stock and record inventory adjustments across warehouse locations."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="Total On Hand" value={totalOnHand} icon={Box} />
        <MetricCard label="Available to Sell" value={totalAvailable} />
        <MetricCard label="Reserved" value={totalReserved} />
      </div>

      <PageSection>
        <div className="grid gap-4">
          <FilterBar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search by SKU or variant title..."
            hasActiveFilters={search.length > 0}
            onReset={() => setSearch("")}
          />

          <DataTable
            data={filteredItems}
            columns={columns}
            keyExtractor={(item) => item.id}
            emptyTitle="No inventory levels found"
            emptyDescription="Ensure product variants have inventory tracking enabled."
          />
        </div>
      </PageSection>

      {adjustItem ? (
        <Dialog open onOpenChange={(open) => !open && setAdjustItem(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Adjust Stock Level</DialogTitle>
              <DialogDescription>
                Recording a stock movement for {adjustItem.variantTitle} ({adjustItem.sku}).
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleAdjustSubmit} className="grid gap-4 py-2">
              <div className="grid gap-1.5">
                <Label htmlFor="qty-delta">Adjustment Quantity Delta *</Label>
                <Input
                  id="qty-delta"
                  type="number"
                  value={delta}
                  onChange={(e) => setDelta(e.target.value)}
                  placeholder="e.g. +10 or -5"
                  required
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="adj-reason">Reason *</Label>
                <Select value={reason} onValueChange={(val) => setReason(val ?? "received")}>
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
                <Label htmlFor="adj-note">Note (Optional)</Label>
                <Input
                  id="adj-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Audit reference or reason details..."
                />
              </div>

              <DialogFooter>
                <Button type="button" variant="default" onClick={() => setAdjustItem(null)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={!delta || isSuccess}>
                  {isSuccess ? <Check className="mr-1.5 size-3.5" aria-hidden /> : null}
                  {isSuccess ? "Adjusted" : "Confirm Adjustment"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </PageContainer>
  );
}

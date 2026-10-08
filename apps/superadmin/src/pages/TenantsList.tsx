import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Building2,
  Plus,
  Search,
  ShieldAlert,
  Sliders,
} from "lucide-react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  PageContainer,
  PageHeader,
  PageSkeleton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@bs/ui";
import { client } from "../lib/orpc.ts";
import { messageOf } from "../lib/errors.ts";

function statusBadge(status: string) {
  switch (status) {
    case "active":
      return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">Active</span>;
    case "trial":
      return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-blue-700 dark:text-blue-400">Trial</span>;
    case "past_due":
      return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-700 dark:text-amber-400">Past Due</span>;
    case "suspended":
      return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-700 dark:text-red-400">Suspended</span>;
    case "archived":
      return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-500/10 text-gray-700 dark:text-gray-400">Archived</span>;
    case "deletion_requested":
      return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-rose-500/10 text-rose-700 dark:text-rose-400">Deletion Queued</span>;
    default:
      return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">{status}</span>;
  }
}

export function TenantsList() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Bulk action modals
  const [bulkSuspendOpen, setBulkSuspendOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");
  const [bulkTierOpen, setBulkTierOpen] = useState(false);
  const [selectedTier, setSelectedTier] = useState<string>("S");
  const [actionLoading, setActionLoading] = useState(false);
  const [suspendConfirm, setSuspendConfirm] = useState("");
  const [tierConfirm, setTierConfirm] = useState("");

  const { data: quotaMatrix } = useQuery({
    queryKey: ["platform", "quotas", "matrix"],
    queryFn: () => client.quotas.matrix(),
  });

  const activeTiers = useMemo(() => {
    return (quotaMatrix?.tiers ?? []).filter((t) => t.isActive);
  }, [quotaMatrix]);

  const effectiveTier = activeTiers.some((t) => t.code === selectedTier)
    ? selectedTier
    : (activeTiers[0]?.code ?? "S");

  const getTierProductsLimit = (tierCode: string) => {
    const lim = quotaMatrix?.limits?.find((l) => l.tierCode === tierCode && l.quotaKey === "products_max");
    return lim?.value;
  };

  const { data: tenants, isLoading, refetch } = useQuery({
    queryKey: ["platform", "tenants", { search, status: statusFilter }],
    queryFn: () =>
      client.tenants.list({
        search: search.trim() || undefined,
        status: statusFilter !== "all" ? statusFilter : undefined,
      }),
  });

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const selectAll = () => {
    if (!tenants) return;
    if (selectedIds.length === tenants.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(tenants.map((t) => t.id));
    }
  };

  const handleBulkSuspend = async () => {
    if (!suspendReason.trim()) {
      toast.error("Reason is required for bulk suspension");
      return;
    }
    setActionLoading(true);
    try {
      const res = await client.tenants.bulkSuspend({
        tenantIds: selectedIds,
        reason: suspendReason,
        confirmation: suspendConfirm,
      });
      toast.success(`Successfully suspended ${res.suspendedCount} store(s)`);
      setBulkSuspendOpen(false);
      setSuspendReason("");
      setSuspendConfirm("");
      setSelectedIds([]);
      refetch();
    } catch (err) {
      toast.error(messageOf(err, "Failed to suspend stores"));
    } finally {
      setActionLoading(false);
    }
  };

  const handleBulkChangeTier = async () => {
    setActionLoading(true);
    try {
      const res = await client.tenants.bulkChangeTier({
        tenantIds: selectedIds,
        tier: effectiveTier,
        confirmation: tierConfirm,
      });
      toast.success(`Updated ${res.updatedCount} store(s) to tier ${res.tier}`);
      setBulkTierOpen(false);
      setTierConfirm("");
      setSelectedIds([]);
      refetch();
    } catch (err) {
      toast.error(messageOf(err, "Failed to change tier"));
    } finally {
      setActionLoading(false);
    }
  };

  if (isLoading) return <PageSkeleton />;

  return (
    <PageContainer size="full">
      <PageHeader
        title="Tenants & Stores"
        description="All hosted storefronts on the platform, managed with explicit tenant isolation."
        aside={
          <Link to={"/tenants/create"}>
            <Button size="sm">
              <Plus className="mr-1.5 h-4 w-4" />
              Create Store
            </Button>
          </Link>
        }
      />

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by store name, slug, domain, owner email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>

        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px] h-9 text-xs">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="trial">Trial</SelectItem>
              <SelectItem value="past_due">Past Due</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Bulk Action Banner when rows selected */}
      {selectedIds.length > 0 && (
        <div className="flex items-center justify-between bg-primary/5 border border-primary/20 rounded-lg p-3 mb-4">
          <span className="text-xs font-medium">
            {selectedIds.length} store(s) selected
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={() => setBulkTierOpen(true)}
              className="h-7 text-xs"
            >
              <Sliders className="mr-1 h-3.5 w-3.5" />
              Change Tier
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setBulkSuspendOpen(true)}
              className="h-7 text-xs"
            >
              <ShieldAlert className="mr-1 h-3.5 w-3.5" />
              Suspend
            </Button>
          </div>
        </div>
      )}

      {/* Tenants Table */}
      {!tenants || tenants.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No stores found"
          description={
            search || statusFilter !== "all"
              ? "No stores matched your current search or status filter."
              : "No stores have been provisioned on this platform yet. Use the Create Store button to provision the first merchant."
          }
        />
      ) : (
        <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="w-12 px-4">
                  <div className="flex items-center justify-center">
                    <Checkbox
                      checked={selectedIds.length === tenants.length && tenants.length > 0}
                      onCheckedChange={selectAll}
                      aria-label="Select all stores"
                    />
                  </div>
                </TableHead>
                <TableHead>Store Name / Slug</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Owner Email</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right px-4">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.map((t) => (
                <TableRow key={t.id} className="hover:bg-muted/30 transition-colors">
                  <TableCell className="px-4">
                    <div className="flex items-center justify-center">
                      <Checkbox
                        checked={selectedIds.includes(t.id)}
                        onCheckedChange={() => toggleSelect(t.id)}
                        aria-label={`Select ${t.name}`}
                      />
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <Link
                        to={`/tenants/${t.id}`}
                        className="font-medium hover:underline text-sm text-foreground"
                      >
                        {t.name}
                      </Link>
                      <span className="text-xs text-muted-foreground font-mono">
                        {t.slug}.bcom.si
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>{statusBadge(t.status)}</TableCell>
                  <TableCell className="text-xs">
                    {t.ownerEmail ? (
                      <span className="text-foreground">{t.ownerEmail}</span>
                    ) : (
                      <span className="text-muted-foreground italic">No owner assigned</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs capitalize font-medium">
                    {t.planId ? "Subscribed" : "Starter (comped)"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {t.createdAt ? new Date(t.createdAt).toLocaleDateString("en-IN") : "—"}
                  </TableCell>
                  <TableCell className="text-right px-4">
                    <Link to={`/tenants/${t.id}`}>
                      <Button variant="ghost" size="sm" className="h-7 px-2.5 text-xs">
                        Manage
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Bulk Suspend Dialog */}
      <Dialog open={bulkSuspendOpen} onOpenChange={setBulkSuspendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk Suspend Stores</DialogTitle>
            <DialogDescription>
              This will suspend storefront checkout and mark {selectedIds.length} store(s) as suspended. Every change is audited.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <label className="text-xs font-medium">Suspension Reason (Required for audit log)</label>
            <Input
              placeholder="e.g. Terms violation or requested non-payment hold"
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
            />
            <label className="text-xs font-medium">
              To confirm, type <span className="font-mono select-all">SUSPEND {selectedIds.length}</span>
            </label>
            <Input value={suspendConfirm} onChange={(e) => setSuspendConfirm(e.target.value)} placeholder={`SUSPEND ${selectedIds.length}`} />
          </div>
          <DialogFooter>
            <Button variant="default" onClick={() => setBulkSuspendOpen(false)} disabled={actionLoading}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleBulkSuspend} disabled={actionLoading || suspendConfirm !== `SUSPEND ${selectedIds.length}`}>
              {actionLoading ? "Suspending..." : "Confirm Bulk Suspend"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Tier Change Dialog */}
      <Dialog open={bulkTierOpen} onOpenChange={setBulkTierOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk Change Resource Tier</DialogTitle>
            <DialogDescription>
              Update the resource tier for {selectedIds.length} selected store(s).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <label className="text-xs font-medium">Target Size Tier</label>
            <Select
              value={effectiveTier}
              onValueChange={(val) => {
                setSelectedTier(val);
                setTierConfirm("");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a tier" />
              </SelectTrigger>
              <SelectContent>
                {activeTiers.map((t) => {
                  const productsLimit = getTierProductsLimit(t.code);
                  const priceText =
                    t.priceMonthlyPaise > 0
                      ? `₹${(t.priceMonthlyPaise / 100).toLocaleString("en-IN")}/mo`
                      : "Free";
                  return (
                    <SelectItem key={t.code} value={t.code}>
                      {t.code} — {t.name} ({priceText}{productsLimit !== undefined ? `, ${productsLimit.toLocaleString()} products` : ""})
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <label className="text-xs font-medium">
              To confirm, type <span className="font-mono select-all">TIER {effectiveTier} {selectedIds.length}</span>
            </label>
            <Input value={tierConfirm} onChange={(e) => setTierConfirm(e.target.value)} placeholder={`TIER ${effectiveTier} ${selectedIds.length}`} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkTierOpen(false)} disabled={actionLoading}>
              Cancel
            </Button>
            <Button onClick={handleBulkChangeTier} disabled={actionLoading || tierConfirm !== `TIER ${effectiveTier} ${selectedIds.length}`}>
              {actionLoading ? "Updating..." : "Apply Tier"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}

import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Layers,
  TableProperties,
  Plus,
  Pencil,
  AlertTriangle,
  RotateCcw,
  Check,
  Building2,
  ExternalLink,
  Info,
} from "lucide-react";
import {
  PageContainer,
  PageHeader,
  PageSkeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Button,
  Badge,
  Input,
  Textarea,
  Label,
  Switch,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  ConfirmDialog,
  toast,
} from "@bs/ui";
import { client } from "../lib/orpc.ts";
import { useHasRole } from "../lib/user-context.tsx";
import { messageOf } from "../lib/errors.ts";
import type {
  QuotaTierView,
  QuotaDefinitionView,
} from "@bs/contracts";

function formatINR(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(rupees);
}

export function Quotas() {
  const queryClient = useQueryClient();
  const isAdmin = useHasRole("platform_admin");

  const [activeTab, setActiveTab] = useState<"tiers" | "matrix">("tiers");

  // Load matrix data (tiers, definitions, limits)
  const {
    data: matrixData,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["platform", "quotas", "matrix"],
    queryFn: () => client.quotas.matrix(),
  });

  // Tier Drawer State
  const [tierSheetOpen, setTierSheetOpen] = useState(false);
  const [editingTier, setEditingTier] = useState<QuotaTierView | null>(null);
  const [tierCode, setTierCode] = useState("");
  const [tierName, setTierName] = useState("");
  const [tierDesc, setTierDesc] = useState("");
  const [tierSort, setTierSort] = useState(0);
  const [tierPriceMonthly, setTierPriceMonthly] = useState("0");
  const [tierPriceYearly, setTierPriceYearly] = useState("0");
  const [tierIsPublic, setTierIsPublic] = useState(true);
  const [tierIsActive, setTierIsActive] = useState(true);
  const [tierSubmitting, setTierSubmitting] = useState(false);

  // Deactivate Tier Confirmation State
  const [deactivateTierTarget, setDeactivateTierTarget] = useState<QuotaTierView | null>(null);
  const [deactivateLoading, setDeactivateLoading] = useState(false);

  // Quota Definition Metadata Dialog State
  const [defDialogOpen, setDefDialogOpen] = useState(false);
  const [editingDef, setEditingDef] = useState<QuotaDefinitionView | null>(null);
  const [defDesc, setDefDesc] = useState("");
  const [defUnit, setDefUnit] = useState("");
  const [defEnforcement, setDefEnforcement] = useState<"hard" | "soft" | "notify">("hard");
  const [defSubmitting, setDefSubmitting] = useState(false);

  // Limits Matrix Local State & Dirty Tracking (storing only user overrides)
  // Key format: `${tierCode}:${quotaKey}`
  const [limitsOverrides, setLimitsOverrides] = useState<Record<string, number>>({});
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);
  const [savingLimits, setSavingLimits] = useState(false);

  // Server limits map for comparison
  const serverLimitsMap = useMemo(() => {
    const map: Record<string, number> = {};
    if (matrixData?.limits) {
      for (const lim of matrixData.limits) {
        map[`${lim.tierCode}:${lim.quotaKey}`] = lim.value;
      }
    }
    return map;
  }, [matrixData]);

  // Compute dirty limits
  const dirtyChanges = useMemo(() => {
    if (!matrixData) return [];
    const changes: Array<{
      tierCode: string;
      quotaKey: string;
      oldLimit: number;
      newLimit: number;
    }> = [];

    for (const [key, newLimit] of Object.entries(limitsOverrides)) {
      const oldLimit = serverLimitsMap[key] ?? 0;
      if (newLimit !== oldLimit) {
        const parts = key.split(":");
        if (parts.length === 2 && parts[0] && parts[1]) {
          changes.push({
            tierCode: parts[0],
            quotaKey: parts[1],
            oldLimit,
            newLimit,
          });
        }
      }
    }
    return changes;
  }, [limitsOverrides, serverLimitsMap, matrixData]);

  const hasUnsavedChanges = dirtyChanges.length > 0;

  // Affected stores calculation for the confirmation modal
  const affectedStoresStats = useMemo(() => {
    if (!matrixData || dirtyChanges.length === 0) {
      return { totalStores: 0, tiers: [] as string[] };
    }
    const modifiedTiersSet = new Set(dirtyChanges.map((c) => c.tierCode));
    const modifiedTiers = Array.from(modifiedTiersSet);
    let totalStores = 0;
    for (const t of matrixData.tiers) {
      if (modifiedTiersSet.has(t.code)) {
        totalStores += t.storeCount;
      }
    }
    return {
      totalStores,
      tiers: modifiedTiers,
    };
  }, [matrixData, dirtyChanges]);

  // Handlers for Tier Drawer
  const openCreateTier = () => {
    setEditingTier(null);
    setTierCode("");
    setTierName("");
    setTierDesc("");
    setTierSort((matrixData?.tiers.length ?? 0) * 10);
    setTierPriceMonthly("0");
    setTierPriceYearly("0");
    setTierIsPublic(true);
    setTierIsActive(true);
    setTierSheetOpen(true);
  };

  const openEditTier = (tier: QuotaTierView) => {
    setEditingTier(tier);
    setTierCode(tier.code);
    setTierName(tier.name);
    setTierDesc(tier.description || "");
    setTierSort(tier.sort);
    setTierPriceMonthly((tier.priceMonthlyPaise / 100).toString());
    setTierPriceYearly((tier.priceYearlyPaise / 100).toString());
    setTierIsPublic(tier.isPublic);
    setTierIsActive(tier.isActive);
    setTierSheetOpen(true);
  };

  const handleSaveTier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;

    const monthlyPaise = Math.round((parseFloat(tierPriceMonthly) || 0) * 100);
    const yearlyPaise = Math.round((parseFloat(tierPriceYearly) || 0) * 100);

    if (monthlyPaise < 0 || yearlyPaise < 0) {
      toast.error("Prices must be non-negative");
      return;
    }

    setTierSubmitting(true);
    try {
      if (editingTier) {
        await client.quotas.updateTier({
          code: editingTier.code,
          name: tierName.trim(),
          description: tierDesc.trim() || null,
          sort: tierSort,
          priceMonthlyPaise: monthlyPaise,
          priceYearlyPaise: yearlyPaise,
          isPublic: tierIsPublic,
          isActive: tierIsActive,
        });
        toast.success(`Updated tier '${editingTier.code}'`);
      } else {
        const cleanCode = tierCode.trim().toUpperCase();
        if (!cleanCode) {
          toast.error("Tier code is required");
          setTierSubmitting(false);
          return;
        }
        await client.quotas.createTier({
          code: cleanCode,
          name: tierName.trim() || cleanCode,
          description: tierDesc.trim() || undefined,
          sort: tierSort,
          priceMonthlyPaise: monthlyPaise,
          priceYearlyPaise: yearlyPaise,
          isPublic: tierIsPublic,
        });
        toast.success(`Created tier '${cleanCode}'`);
      }
      setTierSheetOpen(false);
      refetch();
      queryClient.invalidateQueries({ queryKey: ["platform", "quotas"] });
    } catch (err) {
      toast.error(messageOf(err, "Failed to save tier"));
    } finally {
      setTierSubmitting(false);
    }
  };

  const handleDeactivateTier = async () => {
    if (!deactivateTierTarget || !isAdmin) return;
    setDeactivateLoading(true);
    try {
      await client.quotas.deactivateTier({ code: deactivateTierTarget.code });
      toast.success(`Deactivated tier '${deactivateTierTarget.code}'`);
      refetch();
      queryClient.invalidateQueries({ queryKey: ["platform", "quotas"] });
    } catch (err) {
      toast.error(messageOf(err, "Failed to deactivate tier"));
    } finally {
      setDeactivateLoading(false);
      setDeactivateTierTarget(null);
    }
  };

  // Handlers for Quota Definition Dialog
  const openEditDef = (def: QuotaDefinitionView) => {
    setEditingDef(def);
    setDefDesc(def.description || "");
    setDefUnit(def.unit);
    setDefEnforcement(def.enforcement as "hard" | "soft" | "notify");
    setDefDialogOpen(true);
  };

  const handleSaveDef = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDef || !isAdmin) return;
    setDefSubmitting(true);
    try {
      await client.quotas.updateDefinition({
        key: editingDef.key,
        description: defDesc.trim() || null,
        unit: defUnit.trim() || "count",
        enforcement: defEnforcement,
      });
      toast.success(`Updated definition '${editingDef.key}'`);
      setDefDialogOpen(false);
      refetch();
      queryClient.invalidateQueries({ queryKey: ["platform", "quotas"] });
    } catch (err) {
      toast.error(messageOf(err, "Failed to update definition"));
    } finally {
      setDefSubmitting(false);
    }
  };

  // Handlers for Limits Matrix
  const handleLimitChange = (tierCode: string, quotaKey: string, valStr: string) => {
    const val = parseInt(valStr, 10);
    const num = isNaN(val) || val < 0 ? 0 : val;
    const key = `${tierCode}:${quotaKey}`;
    setLimitsOverrides((prev) => {
      if (num === (serverLimitsMap[key] ?? 0)) {
        const next: Record<string, number> = {};
        for (const [k, v] of Object.entries(prev)) {
          if (k !== key) next[k] = v;
        }
        return next;
      }
      return { ...prev, [key]: num };
    });
  };

  const handleDiscardLimits = () => {
    setLimitsOverrides({});
  };

  const handleApplyLimits = async () => {
    if (!isAdmin || dirtyChanges.length === 0) return;
    setSavingLimits(true);
    try {
      await client.quotas.updateLimits({
        updates: dirtyChanges.map((c) => ({
          tierCode: c.tierCode,
          quotaKey: c.quotaKey,
          value: c.newLimit,
        })),
      });
      toast.success(`Saved ${dirtyChanges.length} quota limit change(s)`);
      setSaveConfirmOpen(false);
      setLimitsOverrides({});
      await refetch();
      queryClient.invalidateQueries({ queryKey: ["platform", "quotas"] });
    } catch (err) {
      toast.error(messageOf(err, "Failed to save limits"));
    } finally {
      setSavingLimits(false);
    }
  };

  if (isLoading || !matrixData) return <PageSkeleton />;

  const { tiers, definitions } = matrixData;

  return (
    <PageContainer size="full">
      <PageHeader
        title="Quotas & Resource Tiers"
        description="Configure size tiers (XS, S, M, L, custom), display catalogue pricing, and ceiling definitions resolved as tenant override → size tier → plan."
        aside={
          activeTab === "tiers" && isAdmin ? (
            <Button size="sm" onClick={openCreateTier} className="shadow-2xs">
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Tier
            </Button>
          ) : null
        }
      />

      {/* Cross-link to Tenants page for per-tenant customization */}
      <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
        <Info className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
        <div className="flex-1 leading-relaxed">
          <span className="font-semibold text-foreground">Tenant overrides: </span>
          Each tenant is assigned a size tier (defaulting to XS). Individual tenant size tier assignments and per-tenant ceiling overrides can be configured directly in{" "}
          <Link to="/tenants" className="inline-flex items-center font-medium text-primary hover:underline">
            Tenants <ExternalLink className="ml-1 h-3 w-3 inline" />
          </Link>{" "}
          under the store's <em>Usage</em> tab.
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex items-center gap-1 border-b mb-6 overflow-x-auto">
        <button
          onClick={() => setActiveTab("tiers")}
          className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium border-b-2 whitespace-nowrap transition-colors ${
            activeTab === "tiers"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Layers className="h-3.5 w-3.5" />
          Tiers & Pricing ({tiers.length})
        </button>
        <button
          onClick={() => setActiveTab("matrix")}
          className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium border-b-2 whitespace-nowrap transition-colors ${
            activeTab === "matrix"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <TableProperties className="h-3.5 w-3.5" />
          Limits Matrix ({definitions.length} Resources)
          {hasUnsavedChanges && (
            <span className="ml-1.5 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
              {dirtyChanges.length} modified
            </span>
          )}
        </button>
      </div>

      {/* TAB 1: TIERS */}
      {activeTab === "tiers" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
            <p>
              Size tiers define resource ceiling brackets. Display pricing is informational for store comparison and catalog presentation (ADR-025: not wired to payment collection).
            </p>
          </div>

          <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="px-4">Tier</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Monthly Price</TableHead>
                  <TableHead>Yearly Price</TableHead>
                  <TableHead>Active Stores</TableHead>
                  <TableHead>Public</TableHead>
                  <TableHead>Status</TableHead>
                  {isAdmin && <TableHead className="text-right px-4">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {tiers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={isAdmin ? 8 : 7} className="text-center py-8 text-xs text-muted-foreground">
                      No quota tiers found in database.
                    </TableCell>
                  </TableRow>
                ) : (
                  tiers.map((t) => (
                    <TableRow key={t.code} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-foreground">{t.code}</span>
                          <span className="text-xs text-muted-foreground font-medium">({t.name})</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                        {t.description || "—"}
                      </TableCell>
                      <TableCell className="text-xs font-semibold font-mono text-foreground">
                        {formatINR(t.priceMonthlyPaise)}
                        <span className="text-[10px] text-muted-foreground font-normal ml-1">/ mo</span>
                      </TableCell>
                      <TableCell className="text-xs font-semibold font-mono text-foreground">
                        {formatINR(t.priceYearlyPaise)}
                        <span className="text-[10px] text-muted-foreground font-normal ml-1">/ yr</span>
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="flex items-center gap-1.5 font-medium">
                          <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>{t.storeCount}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        {t.isPublic ? (
                          <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20">
                            Public
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">
                            Private
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {t.isActive ? (
                          <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20">
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20">
                            Inactive
                          </Badge>
                        )}
                      </TableCell>
                      {isAdmin && (
                        <TableCell className="text-right px-4 space-x-2">
                          <Button size="sm" variant="ghost" onClick={() => openEditTier(t)} className="h-7 px-2 text-xs">
                            <Pencil className="mr-1 h-3 w-3" /> Edit
                          </Button>
                          {t.isActive ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setDeactivateTierTarget(t)}
                              className="h-7 px-2 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/20"
                            >
                              Deactivate
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setEditingTier(t);
                                setTierCode(t.code);
                                setTierName(t.name);
                                setTierDesc(t.description || "");
                                setTierSort(t.sort);
                                setTierPriceMonthly((t.priceMonthlyPaise / 100).toString());
                                setTierPriceYearly((t.priceYearlyPaise / 100).toString());
                                setTierIsPublic(t.isPublic);
                                setTierIsActive(true);
                                setTierSheetOpen(true);
                              }}
                              className="h-7 px-2 text-xs text-emerald-600 hover:text-emerald-700"
                            >
                              Activate
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* TAB 2: LIMITS MATRIX */}
      {activeTab === "matrix" && (
        <div className="space-y-4">
          {/* Dirty changes warning bar */}
          {hasUnsavedChanges && (
            <div className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 shadow-md backdrop-blur-sm">
              <div className="flex items-center gap-2 text-xs font-medium text-amber-900 dark:text-amber-200">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>
                  You have <strong>{dirtyChanges.length}</strong> unsaved quota limit changes.
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={handleDiscardLimits} className="h-7 text-xs shadow-2xs">
                  <RotateCcw className="mr-1 h-3 w-3" /> Discard
                </Button>
                <Button size="sm" onClick={() => setSaveConfirmOpen(true)} className="h-7 text-xs shadow-2xs bg-amber-600 hover:bg-amber-700 text-white">
                  <Check className="mr-1 h-3 w-3" /> Save Changes
                </Button>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-border bg-card shadow-xs overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="px-4 min-w-[220px]">Quota Resource</TableHead>
                  <TableHead className="min-w-[80px]">Unit</TableHead>
                  <TableHead className="min-w-[100px]">Enforcement</TableHead>
                  {tiers.map((t) => (
                    <TableHead key={t.code} className="min-w-[130px] text-center">
                      <div className="flex flex-col items-center py-1">
                        <span className="font-mono font-bold text-foreground text-xs">{t.code}</span>
                        <span className="text-[10px] text-muted-foreground font-normal">
                          {t.storeCount} {t.storeCount === 1 ? "store" : "stores"}
                        </span>
                      </div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {definitions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3 + tiers.length} className="text-center py-8 text-xs text-muted-foreground">
                      No quota definitions found in database.
                    </TableCell>
                  </TableRow>
                ) : (
                  definitions.map((def) => (
                    <TableRow key={def.key} className="hover:bg-muted/20 transition-colors">
                      <TableCell className="px-4">
                        <div className="flex items-center justify-between gap-2">
                          <div className="space-y-0.5">
                            <div className="font-mono text-xs font-semibold text-foreground">{def.key}</div>
                            <div className="text-[11px] text-muted-foreground line-clamp-1">{def.description || "—"}</div>
                          </div>
                          {isAdmin && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openEditDef(def)}
                              className="h-6 w-6 p-0 shrink-0 text-muted-foreground hover:text-foreground"
                              title="Edit quota metadata"
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">{def.unit}</TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
                            def.enforcement === "hard"
                              ? "bg-red-500/10 text-red-700 dark:text-red-400 font-semibold"
                              : def.enforcement === "notify"
                              ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                              : "bg-blue-500/10 text-blue-700 dark:text-blue-400"
                          }`}
                        >
                          {def.enforcement}
                        </span>
                      </TableCell>
                      {tiers.map((t) => {
                        const cellKey = `${t.code}:${def.key}`;
                        const currentVal = limitsOverrides[cellKey] ?? serverLimitsMap[cellKey] ?? 0;
                        const isDirty = cellKey in limitsOverrides && limitsOverrides[cellKey] !== (serverLimitsMap[cellKey] ?? 0);

                        return (
                          <TableCell key={t.code} className="text-center p-2">
                            <Input
                              type="number"
                              min={0}
                              value={currentVal}
                              disabled={!isAdmin || !t.isActive}
                              onChange={(e) => handleLimitChange(t.code, def.key, e.target.value)}
                              className={`h-7 w-24 mx-auto text-center font-mono text-xs ${
                                isDirty
                                  ? "border-amber-500 bg-amber-50/50 dark:bg-amber-950/20 font-bold text-amber-900 dark:text-amber-200"
                                  : ""
                              }`}
                            />
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* TIER ADD / EDIT DRAWER (SHEET) */}
      <Sheet open={tierSheetOpen} onOpenChange={setTierSheetOpen}>
        <SheetContent className="w-[35vw] md:min-w-[480px] max-w-full overflow-y-auto p-0 flex flex-col bg-background text-foreground">
          <SheetHeader className="p-6 border-b border-border">
            <SheetTitle className="text-base font-bold">
              {editingTier ? `Edit Tier: ${editingTier.code}` : "Create Resource Tier"}
            </SheetTitle>
            <SheetDescription className="text-xs text-muted-foreground">
              Define the tier code, name, catalogue pricing, and visibility settings.
            </SheetDescription>
          </SheetHeader>

          <form onSubmit={handleSaveTier} className="flex-1 flex flex-col">
            <div className="p-6 space-y-4 flex-1">
              <div>
                <Label htmlFor="tier-code" className="text-xs font-semibold">Tier Code</Label>
                <Input
                  id="tier-code"
                  disabled={Boolean(editingTier)}
                  value={tierCode}
                  onChange={(e) => setTierCode(e.target.value.toUpperCase())}
                  placeholder="e.g. XL, ENTERPRISE"
                  className="mt-1 font-mono text-xs uppercase"
                  required
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Uppercase unique identifier (e.g. XS, S, M, L, XL). Cannot be altered once created.
                </p>
              </div>

              <div>
                <Label htmlFor="tier-name" className="text-xs font-semibold">Display Name</Label>
                <Input
                  id="tier-name"
                  value={tierName}
                  onChange={(e) => setTierName(e.target.value)}
                  placeholder="e.g. Extra Large"
                  className="mt-1 text-xs"
                  required
                />
              </div>

              <div>
                <Label htmlFor="tier-desc" className="text-xs font-semibold">Description</Label>
                <Textarea
                  id="tier-desc"
                  value={tierDesc}
                  onChange={(e) => setTierDesc(e.target.value)}
                  placeholder="Target audience or tier purpose..."
                  className="mt-1 text-xs"
                  rows={2}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="tier-price-monthly" className="text-xs font-semibold">Monthly Price (₹)</Label>
                  <Input
                    id="tier-price-monthly"
                    type="number"
                    step="any"
                    min="0"
                    value={tierPriceMonthly}
                    onChange={(e) => setTierPriceMonthly(e.target.value)}
                    className="mt-1 font-mono text-xs"
                    required
                  />
                  <p className="text-[10px] text-muted-foreground mt-0.5">Stored as integer paise</p>
                </div>

                <div>
                  <Label htmlFor="tier-price-yearly" className="text-xs font-semibold">Yearly Price (₹)</Label>
                  <Input
                    id="tier-price-yearly"
                    type="number"
                    step="any"
                    min="0"
                    value={tierPriceYearly}
                    onChange={(e) => setTierPriceYearly(e.target.value)}
                    className="mt-1 font-mono text-xs"
                    required
                  />
                  <p className="text-[10px] text-muted-foreground mt-0.5">Stored as integer paise</p>
                </div>
              </div>

              <div>
                <Label htmlFor="tier-sort" className="text-xs font-semibold">Sort Order</Label>
                <Input
                  id="tier-sort"
                  type="number"
                  value={tierSort}
                  onChange={(e) => setTierSort(parseInt(e.target.value, 10) || 0)}
                  className="mt-1 font-mono text-xs"
                />
              </div>

              <div className="pt-2 space-y-3">
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <Label className="text-xs font-semibold cursor-pointer">Public Tier</Label>
                    <p className="text-[11px] text-muted-foreground">Visible on public plans and comparison tables</p>
                  </div>
                  <Switch checked={tierIsPublic} onCheckedChange={setTierIsPublic} />
                </div>

                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <Label className="text-xs font-semibold cursor-pointer">Active Tier</Label>
                    <p className="text-[11px] text-muted-foreground">Available for tenant assignment</p>
                  </div>
                  <Switch checked={tierIsActive} onCheckedChange={setTierIsActive} />
                </div>
              </div>
            </div>

            <SheetFooter className="p-4 border-t border-border bg-muted/20 flex items-center justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setTierSheetOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={tierSubmitting}>
                {tierSubmitting ? "Saving..." : editingTier ? "Update Tier" : "Create Tier"}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      {/* DEACTIVATE CONFIRMATION DIALOG */}
      <ConfirmDialog
        open={Boolean(deactivateTierTarget)}
        onOpenChange={(open) => !open && setDeactivateTierTarget(null)}
        title={deactivateTierTarget ? `Deactivate Tier '${deactivateTierTarget.code}'?` : "Deactivate Tier"}
        description={
          deactivateTierTarget
            ? deactivateTierTarget.storeCount > 0
              ? `Warning: There are ${deactivateTierTarget.storeCount} stores currently assigned to tier '${deactivateTierTarget.code}'. Deactivating a tier with assigned stores will be refused by the system.`
              : `Are you sure you want to deactivate tier '${deactivateTierTarget.code}'? Inactive tiers cannot be assigned to new stores.`
            : ""
        }
        confirmLabel="Deactivate Tier"
        destructive={true}
        pending={deactivateLoading}
        onConfirm={handleDeactivateTier}
      />

      {/* DEFINITION METADATA DIALOG */}
      <Dialog open={defDialogOpen} onOpenChange={setDefDialogOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">
              Edit Quota Definition: <span className="font-mono text-primary">{editingDef?.key}</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Quota keys are code-defined. You can update description, unit, and enforcement type.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveDef} className="space-y-4 py-2">
            <div>
              <Label className="text-xs font-semibold">Quota Key</Label>
              <Input value={editingDef?.key || ""} disabled className="mt-1 font-mono text-xs bg-muted/50" />
            </div>

            <div>
              <Label htmlFor="def-desc" className="text-xs font-semibold">Description</Label>
              <Input
                id="def-desc"
                value={defDesc}
                onChange={(e) => setDefDesc(e.target.value)}
                placeholder="e.g. Maximum active products"
                className="mt-1 text-xs"
              />
            </div>

            <div>
              <Label htmlFor="def-unit" className="text-xs font-semibold">Unit</Label>
              <Input
                id="def-unit"
                value={defUnit}
                onChange={(e) => setDefUnit(e.target.value)}
                placeholder="e.g. count, bytes, rpm"
                className="mt-1 font-mono text-xs"
                required
              />
            </div>

            <div>
              <Label className="text-xs font-semibold">Enforcement Mode</Label>
              <Select value={defEnforcement} onValueChange={(val) => setDefEnforcement(val as "hard" | "soft" | "notify")}>
                <SelectTrigger className="mt-1 w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hard">hard (Strict ceiling: operations refused when reached)</SelectItem>
                  <SelectItem value="soft">soft (Soft ceiling: allows overage with warnings)</SelectItem>
                  <SelectItem value="notify">notify (Informational only: alerts staff)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setDefDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={defSubmitting}>
                {defSubmitting ? "Saving..." : "Update Definition"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* SAVE LIMITS CONFIRMATION MODAL ("N stores affected") */}
      <Dialog open={saveConfirmOpen} onOpenChange={setSaveConfirmOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Confirm Quota Limits Update</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Review batch changes before applying them to the platform.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Impact Banner */}
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-900 dark:text-amber-200">
              <div className="font-semibold flex items-center gap-1.5 text-sm mb-1">
                <Building2 className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <span>
                  {affectedStoresStats.totalStores} {affectedStoresStats.totalStores === 1 ? "store" : "stores"} affected
                </span>
              </div>
              <p className="text-[11px] leading-relaxed">
                You are updating limits across tier(s):{" "}
                <strong>{affectedStoresStats.tiers.join(", ")}</strong>. These updated limits will take effect immediately on subsequent quota checks for all affected stores.
              </p>
            </div>

            {/* Changed Limits List */}
            <div className="max-h-60 overflow-y-auto rounded-lg border border-border p-2 space-y-1 bg-muted/20">
              <div className="text-[11px] font-semibold text-muted-foreground px-2 py-1 border-b border-border mb-1">
                {dirtyChanges.length} Modified Limit(s)
              </div>
              {dirtyChanges.map((c) => (
                <div
                  key={`${c.tierCode}:${c.quotaKey}`}
                  className="flex items-center justify-between text-xs px-2 py-1 rounded hover:bg-muted/40 font-mono"
                >
                  <div>
                    <span className="font-semibold text-foreground">{c.quotaKey}</span>
                    <span className="text-muted-foreground ml-1.5">({c.tierCode})</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground line-through">{c.oldLimit}</span>
                    <span>→</span>
                    <span className="font-bold text-amber-600 dark:text-amber-400">{c.newLimit}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSaveConfirmOpen(false)}
              disabled={savingLimits}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleApplyLimits}
              disabled={savingLimits}
              className="shadow-2xs"
            >
              {savingLimits ? "Applying..." : "Confirm & Apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}

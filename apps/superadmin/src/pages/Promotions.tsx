import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import {
  Button,
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
  SimpleSelect,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@bs/ui";
import type { PromotionView } from "@bs/contracts";
import { client } from "../lib/orpc.ts";
import { messageOf } from "../lib/errors.ts";
import { useHasRole } from "../lib/user-context.tsx";

const PLAN_CODES = [
  { code: "starter", label: "Starter" },
  { code: "growth", label: "Growth" },
  { code: "pro", label: "Pro" },
];

export function describePromotion(p: Pick<PromotionView, "kind" | "percentOff" | "durationMonths">): string {
  return p.kind === "free_months" ? `Free for ${p.durationMonths} month${p.durationMonths === 1 ? "" : "s"}` : `${p.percentOff}% off for ${p.durationMonths} month${p.durationMonths === 1 ? "" : "s"}`;
}

export function Promotions() {
  const isOwner = useHasRole("platform_owner");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({ queryKey: ["platform", "promotions"], queryFn: () => client.promotions.list() });

  async function setActive(p: PromotionView, isActive: boolean) {
    setBusyId(p.id);
    try {
      await client.promotions.update({ id: p.id, isActive });
      toast.success(`${p.code} ${isActive ? "turned on" : "turned off"}`);
      void refetch();
    } catch (err) {
      toast.error(messageOf(err, "Could not update the promotion"));
    } finally {
      setBusyId(null);
    }
  }

  if (isLoading) return <PageSkeleton />;

  return (
    <PageContainer size="full">
      <PageHeader
        title="Promotions"
        description="Discounts and free periods for new and existing stores. A promotion lasts at most 12 months. Only the platform owner can create or grant them."
        aside={
          isOwner ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> New promotion
            </Button>
          ) : undefined
        }
      />

      {!data || data.length === 0 ? (
        <EmptyState title="No promotions yet" description="Create a promo code for signups, or grant a free period to a store from its Billing tab." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="px-4">Code</TableHead>
                <TableHead>Offer</TableHead>
                <TableHead>Plans</TableHead>
                <TableHead>Used</TableHead>
                <TableHead>Valid</TableHead>
                <TableHead className="px-4 text-right">On</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((p) => (
                <TableRow key={p.id} className="hover:bg-muted/30">
                  <TableCell className="px-4">
                    <div className="font-mono text-xs font-semibold text-foreground">{p.code}</div>
                    <div className="text-[11px] text-muted-foreground">{p.name}</div>
                  </TableCell>
                  <TableCell className="text-xs text-foreground">{describePromotion(p)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{p.appliesToPlanCodes.length === 0 ? "All plans" : p.appliesToPlanCodes.join(", ")}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {p.redeemedCount}
                    {p.maxRedemptions ? ` / ${p.maxRedemptions}` : ""}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {p.validFrom ? new Date(p.validFrom).toLocaleDateString("en-IN") : "Now"} to {p.validUntil ? new Date(p.validUntil).toLocaleDateString("en-IN") : "No end"}
                  </TableCell>
                  <TableCell className="px-4 text-right">
                    <Switch
                      checked={p.isActive}
                      disabled={!isOwner || busyId === p.id}
                      onCheckedChange={(c) => void setActive(p, Boolean(c))}
                      aria-label={`${p.code} active`}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          void refetch();
        }}
      />
    </PageContainer>
  );
}

function CreateDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"percent_off" | "free_months">("percent_off");
  const [percent, setPercent] = useState("20");
  const [months, setMonths] = useState("12");
  const [plans, setPlans] = useState<string[]>([]);
  const [max, setMax] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const m = Number(months);
    if (!Number.isInteger(m) || m < 1 || m > 12) return setError("A promotion lasts 1 to 12 months.");
    if (kind === "percent_off" && !(Number.isInteger(Number(percent)) && Number(percent) >= 1 && Number(percent) <= 100)) return setError("Enter a whole percentage from 1 to 100.");
    setError(null);
    setBusy(true);
    try {
      await client.promotions.create({
        code,
        name,
        kind,
        ...(kind === "percent_off" ? { percentOff: Number(percent) } : {}),
        durationMonths: m,
        appliesToPlanCodes: plans,
        maxRedemptions: max.trim() ? Number(max) : null,
        validUntil: validUntil ? new Date(`${validUntil}T23:59:59`).toISOString() : null,
      });
      toast.success(`Promotion ${code.toUpperCase()} created`);
      setCode("");
      setName("");
      onCreated();
    } catch (err) {
      setError(messageOf(err, "Could not create the promotion"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New promotion</DialogTitle>
          <DialogDescription>Stores can enter the code at signup, or you can grant it from a store's Billing tab. The terms cannot be changed afterwards.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <label htmlFor="promo-code" className="font-semibold">Code</label>
              <Input id="promo-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="LAUNCH2026" maxLength={32} />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="promo-name" className="font-semibold">Name</label>
              <Input id="promo-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Launch offer" maxLength={80} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <span className="font-semibold">Type</span>
              <SimpleSelect ariaLabel="Promotion type" value={kind} onChange={(v) => setKind(v as typeof kind)} options={[{ value: "percent_off", label: "Percent off" }, { value: "free_months", label: "Free months" }]} />
            </div>
            {kind === "percent_off" ? (
              <div className="grid gap-1.5">
                <label htmlFor="promo-pct" className="font-semibold">Percent off</label>
                <Input id="promo-pct" type="number" min={1} max={100} value={percent} onChange={(e) => setPercent(e.target.value)} />
              </div>
            ) : (
              <div />
            )}
            <div className="grid gap-1.5">
              <label htmlFor="promo-months" className="font-semibold">Lasts (months, max 12)</label>
              <Input id="promo-months" type="number" min={1} max={12} value={months} onChange={(e) => setMonths(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <span className="font-semibold">Plans it applies to</span>
            <div className="flex flex-wrap gap-3">
              {PLAN_CODES.map((p) => (
                <label key={p.code} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={plans.includes(p.code)}
                    onChange={(e) => setPlans((prev) => (e.target.checked ? [...prev, p.code] : prev.filter((c) => c !== p.code)))}
                  />
                  {p.label}
                </label>
              ))}
              <span className="text-muted-foreground">None ticked means every plan.</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <label htmlFor="promo-max" className="font-semibold">Redemption limit (optional)</label>
              <Input id="promo-max" type="number" min={1} value={max} onChange={(e) => setMax(e.target.value)} placeholder="No limit" />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="promo-until" className="font-semibold">Valid until (optional)</label>
              <Input id="promo-until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </div>
          </div>
          {error ? (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-2.5 font-medium text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !code.trim() || !name.trim()}>
            {busy ? "Creating..." : "Create promotion"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

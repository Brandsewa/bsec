import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Gift } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  SimpleSelect,
  toast,
} from "@bs/ui";
import type { TenantPromotionView, TermQuoteView } from "@bs/contracts";
import { formatMoney } from "@bs/contracts/money";
import { client } from "../lib/orpc.ts";
import { messageOf } from "../lib/errors.ts";
import { useHasRole } from "../lib/user-context.tsx";
import { describePromotion } from "./Promotions.tsx";

const inr = (paise: number, currency = "INR") => formatMoney(paise, currency);

/** Promotions of one store: what is active, what ended, and (platform owner) give or cancel one. Shown on the Billing tab. */
export function TenantPromotions({ tenantId, planCode }: { tenantId: string; planCode: string }) {
  const isOwner = useHasRole("platform_owner");
  const [granting, setGranting] = useState(false);
  const { data, refetch } = useQuery({ queryKey: ["platform", "tenant-promotions", tenantId], queryFn: () => client.promotions.listForTenant({ tenantId }) });
  const active = (data ?? []).find((g) => g.status === "active");

  async function cancel(g: TenantPromotionView) {
    try {
      await client.promotions.cancelGrant({ id: g.id });
      toast.success("Promotion cancelled. The store is back on list price.");
      void refetch();
    } catch (err) {
      toast.error(messageOf(err, "Could not cancel the promotion"));
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-xs">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Gift className="h-4 w-4 text-muted-foreground" aria-hidden /> Promotions and free periods
        </h3>
        {isOwner && !active ? (
          <Button size="sm" variant="outline" onClick={() => setGranting(true)}>
            Grant promotion
          </Button>
        ) : null}
      </div>

      {(data ?? []).length === 0 ? (
        <p className="text-xs text-muted-foreground">No promotions for this store.</p>
      ) : (
        <ul className="divide-y divide-border/60 text-xs">
          {(data ?? []).map((g) => (
            <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
              <div>
                <div className="font-medium text-foreground">
                  {describePromotion(g)}
                  {g.promotionCode ? <span className="ml-2 font-mono text-muted-foreground">{g.promotionCode}</span> : <span className="ml-2 text-muted-foreground">custom</span>}
                </div>
                <div className="text-muted-foreground">
                  {g.source === "code" ? "Redeemed at signup" : "Granted by staff"} · {g.termMonths}-month prepaid term · {new Date(g.startsAt).toLocaleDateString("en-IN")} to {new Date(g.endsAt).toLocaleDateString("en-IN")}
                  {g.note ? ` · ${g.note}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={g.status === "active" ? "rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400" : "rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium capitalize text-muted-foreground"}>
                  {g.status}
                </span>
                {g.status === "active" && isOwner ? (
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void cancel(g)}>
                    Cancel
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {active?.kind === "free_months" ? (
        <p className="mt-3 text-[11px] text-muted-foreground">
          When the free period ends on {new Date(active.endsAt).toLocaleDateString("en-IN")}, the store is suspended until its owner chooses a plan, unless it has started paying.
        </p>
      ) : null}

      <GrantDialog
        open={granting}
        tenantId={tenantId}
        planCode={planCode}
        onClose={() => setGranting(false)}
        onGranted={() => {
          setGranting(false);
          void refetch();
        }}
      />
    </div>
  );
}

function GrantDialog({ open, tenantId, planCode, onClose, onGranted }: { open: boolean; tenantId: string; planCode: string; onClose: () => void; onGranted: () => void }) {
  const [mode, setMode] = useState<"promotion" | "custom">("custom");
  const [promotionId, setPromotionId] = useState("");
  const [kind, setKind] = useState<"free_months" | "percent_off">("free_months");
  const [percent, setPercent] = useState("50");
  const [months, setMonths] = useState("12");
  const [term, setTerm] = useState("12");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const promos = useQuery({ queryKey: ["platform", "promotions"], queryFn: () => client.promotions.list(), enabled: open });
  const activePromos = (promos.data ?? []).filter((p) => p.isActive);

  const terms = (): { promotionId: string } | { custom: { kind: "free_months" | "percent_off"; percentOff?: number; durationMonths: number } } | null => {
    if (mode === "promotion") return promotionId ? { promotionId } : null;
    const m = Number(months);
    if (!Number.isInteger(m) || m < 1 || m > 12) return null;
    if (kind === "percent_off") {
      const p = Number(percent);
      if (!Number.isInteger(p) || p < 1 || p > 100) return null;
      return { custom: { kind, percentOff: p, durationMonths: m } };
    }
    return { custom: { kind, durationMonths: m } };
  };

  // Live preview of what the prepaid term costs with these terms.
  const t0 = terms();
  const quoteQuery = useQuery({
    queryKey: ["platform", "promotion-quote", planCode, term, JSON.stringify(t0)],
    queryFn: () => client.promotions.quote({ planCode, termMonths: Number(term) as 6 | 12 | 36, ...(t0 as NonNullable<typeof t0>) }),
    enabled: open && t0 !== null,
    retry: false,
  });
  const quote: TermQuoteView | null = t0 !== null && quoteQuery.data ? quoteQuery.data : null;

  async function submit() {
    const t = terms();
    if (!t) return setError("Check the promotion terms: 1 to 12 months, and a percentage from 1 to 100.");
    setError(null);
    setBusy(true);
    try {
      await client.promotions.grant({ tenantId, termMonths: Number(term) as 6 | 12 | 36, note: note.trim() || undefined, ...t });
      toast.success("Promotion granted");
      onGranted();
    } catch (err) {
      setError(messageOf(err, "Could not grant the promotion"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Grant a promotion</DialogTitle>
          <DialogDescription>The store keeps the promotion if it changes plan. One promotion at a time, at most 12 months.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2 text-xs">
          <div className="grid gap-1.5">
            <span className="font-semibold">Use</span>
            <SimpleSelect ariaLabel="Promotion source" value={mode} onChange={(v) => setMode(v as typeof mode)} options={[{ value: "custom", label: "Custom terms (for example a free year)" }, { value: "promotion", label: "An existing promotion" }]} />
          </div>
          {mode === "promotion" ? (
            <div className="grid gap-1.5">
              <span className="font-semibold">Promotion</span>
              <SimpleSelect ariaLabel="Promotion" value={promotionId} onChange={setPromotionId} placeholder="Choose..." options={activePromos.map((p) => ({ value: p.id, label: `${p.code}: ${describePromotion(p)}` }))} />
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-1.5">
                <span className="font-semibold">Type</span>
                <SimpleSelect ariaLabel="Type" value={kind} onChange={(v) => setKind(v as typeof kind)} options={[{ value: "free_months", label: "Free months" }, { value: "percent_off", label: "Percent off" }]} />
              </div>
              {kind === "percent_off" ? (
                <div className="grid gap-1.5">
                  <label htmlFor="grant-pct" className="font-semibold">Percent off</label>
                  <Input id="grant-pct" type="number" min={1} max={100} value={percent} onChange={(e) => setPercent(e.target.value)} />
                </div>
              ) : (
                <div />
              )}
              <div className="grid gap-1.5">
                <label htmlFor="grant-months" className="font-semibold">Months (max 12)</label>
                <Input id="grant-months" type="number" min={1} max={12} value={months} onChange={(e) => setMonths(e.target.value)} />
              </div>
            </div>
          )}
          <div className="grid gap-1.5">
            <span className="font-semibold">Prepaid term</span>
            <SimpleSelect ariaLabel="Prepaid term" value={term} onChange={setTerm} options={[{ value: "6", label: "6 months" }, { value: "12", label: "1 year" }, { value: "36", label: "3 years" }]} />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="grant-note" className="font-semibold">Note (optional)</label>
            <Input id="grant-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Why this store gets it" />
          </div>

          {quote ? (
            <div className="rounded-md border border-border bg-muted/30 p-3" aria-label="Term quote">
              <p className="font-semibold text-foreground">
                {quote.planName} for {quote.termMonths} months: {inr(quote.totalPaise)}
                {quote.discountPaise > 0 ? <span className="font-normal text-muted-foreground"> (list {inr(quote.listTotalPaise)}, you save {inr(quote.discountPaise)})</span> : null}
              </p>
              <ul className="mt-1 text-muted-foreground">
                {quote.lines.map((l) => (
                  <li key={l.fromMonth}>
                    Months {l.fromMonth} to {l.toMonth}: {l.label}, {inr(l.monthlyPaise)} a month
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[11px] text-muted-foreground">Preview only. No GST for now, and billing is not live yet.</p>
            </div>
          ) : null}

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
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? "Granting..." : "Grant promotion"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

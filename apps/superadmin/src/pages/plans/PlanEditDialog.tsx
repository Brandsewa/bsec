import React, { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  InfoTip,
  Input,
  SimpleSelect,
  Switch,
  toast,
} from "@bs/ui";
import {
  PLAN_LIMIT_KEYS,
  PLAN_LIMIT_LABELS,
  renderPlanBullet,
  type PlanBullet,
  type PlanEditorPlan,
  type PlanLimitKey,
  type PlanUpdateInput,
} from "@bs/contracts";
import { client } from "../../lib/orpc.ts";
import { messageOf } from "../../lib/errors.ts";

/** Storage is edited in GB (the quota is in MB). */
const toField = (key: PlanLimitKey, v: number | undefined): string => (v === undefined ? "" : String(key === "storage_mb" ? Math.round(v / 1024) : v));
const fromField = (key: PlanLimitKey, v: string): number | undefined => {
  if (v.trim() === "") return undefined;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0) return undefined;
  return key === "storage_mb" ? n * 1024 : n;
};
const money = (minor: number | null): string => (minor === null ? "" : String(minor / 100));
const toMinor = (v: string): number | null => {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

const LIMIT_OPTIONS = [{ value: "", label: "Plain text" }, ...PLAN_LIMIT_KEYS.map((k) => ({ value: k, label: `Limit: ${PLAN_LIMIT_LABELS[k]}` }))];

export function PlanEditDialog({ plan, onClose, onSaved }: { plan: PlanEditorPlan; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(plan.name);
  const [tagline, setTagline] = useState(plan.tagline ?? "");
  const [audience, setAudience] = useState(plan.audience ?? "");
  const [badge, setBadge] = useState(plan.badge ?? "");
  const [isPublic, setIsPublic] = useState(plan.isPublic);
  const [monthlyInr, setMonthlyInr] = useState(money(plan.priceMonthlyPaise));
  const [yearlyInr, setYearlyInr] = useState(money(plan.priceYearlyPaise));
  const [monthlyUsd, setMonthlyUsd] = useState(money(plan.priceMonthlyUsdCents));
  const [yearlyUsd, setYearlyUsd] = useState(money(plan.priceYearlyUsdCents));
  const [limits, setLimits] = useState<Record<string, string>>(() =>
    Object.fromEntries(PLAN_LIMIT_KEYS.map((k) => [k, toField(k, plan.limits[k])])),
  );
  const [bullets, setBullets] = useState<PlanBullet[]>(plan.cardBullets);
  const [saving, setSaving] = useState(false);

  const draftLimits = Object.fromEntries(PLAN_LIMIT_KEYS.map((k) => [k, fromField(k, limits[k] ?? "")]).filter(([, v]) => v !== undefined)) as Record<string, number>;

  function moveBullet(i: number, d: -1 | 1) {
    const next = [...bullets];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j] as PlanBullet, next[i] as PlanBullet];
    setBullets(next);
  }

  async function save() {
    const monthly = toMinor(monthlyInr);
    const yearly = toMinor(yearlyInr);
    if (monthly === null || yearly === null) {
      toast.error("Enter the monthly and yearly price in rupees");
      return;
    }
    const cleanBullets = bullets.map((b) => ({ ...b, t: b.t.trim() })).filter((b) => b.t);
    const input: PlanUpdateInput = {
      code: plan.code,
      name: name.trim() || plan.name,
      tagline: tagline.trim() || null,
      audience: audience.trim() || null,
      badge: badge.trim() || null,
      isPublic,
      priceMonthlyPaise: monthly,
      priceYearlyPaise: yearly,
      priceMonthlyUsdCents: toMinor(monthlyUsd),
      priceYearlyUsdCents: toMinor(yearlyUsd),
      cardBullets: cleanBullets,
      limits: draftLimits,
    };
    setSaving(true);
    try {
      const res = await client.plans.updatePlan(input);
      toast.success(`${input.name} saved`);
      if (res.priceChanged) toast.info("A price changed: sync the gateway plans in Integrations, Billing, so new subscribers are charged the new amount.");
      onSaved();
    } catch (err) {
      toast.error(messageOf(err, "Could not save the plan"));
    } finally {
      setSaving(false);
    }
  }

  const field = "space-y-1.5";
  const label = "text-xs font-medium text-muted-foreground";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit {plan.name}</DialogTitle>
          <DialogDescription>Changes show to merchants on signup and in Plan and billing as soon as you save.</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <section className="grid gap-4 sm:grid-cols-2">
            <div className={field}>
              <p className={label}>Plan name</p>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
            </div>
            <div className={field}>
              <p className={label}>Badge (optional)</p>
              <Input value={badge} onChange={(e) => setBadge(e.target.value)} maxLength={30} placeholder="Most popular" />
            </div>
            <div className={`${field} sm:col-span-2`}>
              <p className={label}>Tagline</p>
              <Input value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={120} />
            </div>
            <div className={`${field} sm:col-span-2`}>
              <p className={label}>Who it is for</p>
              <Input value={audience} onChange={(e) => setAudience(e.target.value)} maxLength={120} />
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <Switch checked={isPublic} onCheckedChange={setIsPublic} />
              Shown to merchants (turn off to hide the plan from signup and Plan and billing)
            </label>
          </section>

          <section className="space-y-3">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              Prices
              <InfoTip>
                Prices exclude nothing: enter what the merchant pays per month or per year. After changing a price, sync the gateway plans in
                Integrations, Billing; existing subscribers keep their current amount.
              </InfoTip>
            </h3>
            <div className="grid gap-4 sm:grid-cols-4">
              <div className={field}>
                <p className={label}>Monthly (₹)</p>
                <Input inputMode="decimal" value={monthlyInr} onChange={(e) => setMonthlyInr(e.target.value)} />
              </div>
              <div className={field}>
                <p className={label}>Yearly (₹)</p>
                <Input inputMode="decimal" value={yearlyInr} onChange={(e) => setYearlyInr(e.target.value)} />
              </div>
              <div className={field}>
                <p className={label}>Monthly (US$)</p>
                <Input inputMode="decimal" value={monthlyUsd} onChange={(e) => setMonthlyUsd(e.target.value)} placeholder="Not offered" />
              </div>
              <div className={field}>
                <p className={label}>Yearly (US$)</p>
                <Input inputMode="decimal" value={yearlyUsd} onChange={(e) => setYearlyUsd(e.target.value)} placeholder="Not offered" />
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              Limits
              <InfoTip>
                These are the limits actually enforced for every store on this plan (size tier {plan.tier}), the same numbers as in Quotas. Lowering one
                does not remove what a store already has. Media storage is in GB.
              </InfoTip>
            </h3>
            <div className="grid gap-4 sm:grid-cols-3">
              {PLAN_LIMIT_KEYS.map((k) => (
                <div key={k} className={field}>
                  <p className={label}>{k === "storage_mb" ? "Media storage (GB)" : PLAN_LIMIT_LABELS[k]}</p>
                  <Input inputMode="numeric" value={limits[k] ?? ""} onChange={(e) => setLimits((l) => ({ ...l, [k]: e.target.value }))} />
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              Card line items
              <InfoTip>
                Each line is one tick on the plan card. Link a line to a limit and write {"{value}"} where the number goes, for example "Up to {"{value}"} products":
                the number printed is always the enforced limit.
              </InfoTip>
            </h3>
            <ul className="space-y-2">
              {bullets.map((b, i) => (
                <li key={i} className="grid grid-cols-[1fr_11rem_auto] items-center gap-2">
                  <Input
                    value={b.t}
                    maxLength={160}
                    onChange={(e) => setBullets((all) => all.map((x, j) => (j === i ? { ...x, t: e.target.value } : x)))}
                    aria-label={`Line ${i + 1}`}
                  />
                  <SimpleSelect
                    value={b.k ?? ""}
                    onChange={(v) =>
                      setBullets((all) =>
                        all.map((x, j) => {
                          if (j !== i) return x;
                          const { k: _drop, ...rest } = x;
                          return v ? { ...rest, k: v as PlanLimitKey } : rest;
                        }),
                      )
                    }
                    options={LIMIT_OPTIONS}
                    ariaLabel={`Line ${i + 1} linked limit`}
                  />
                  <div className="flex">
                    <Button type="button" variant="ghost" size="icon" onClick={() => moveBullet(i, -1)} aria-label="Move up">
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" onClick={() => moveBullet(i, 1)} aria-label="Move down">
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" onClick={() => setBullets((all) => all.filter((_, j) => j !== i))} aria-label="Remove line">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  {b.k ? (
                    <p className="col-span-3 -mt-1 text-xs text-muted-foreground">Shows: {renderPlanBullet(b, draftLimits) ?? "nothing (this limit has no value)"}</p>
                  ) : null}
                </li>
              ))}
            </ul>
            <Button type="button" variant="outline" size="sm" onClick={() => setBullets((all) => [...all, { t: "" }])} disabled={bullets.length >= 16}>
              <Plus className="mr-1 h-4 w-4" /> Add line
            </Button>
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

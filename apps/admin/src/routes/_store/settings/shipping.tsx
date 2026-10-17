import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { FormSkeleton, PageSkeleton, MultiSelect, SimpleSelect, toast } from "@bs/ui";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ShippingSettings } from "@bs/contracts";
import { Button } from "@bs/ui";
import { Badge } from "@bs/ui";
import { Input } from "@bs/ui";
import { Field } from "@bs/ui";
import { ConfirmDialog } from "@bs/ui";
import { HeaderActions, SettingsCard, SettingsPageFrame, useUnsavedGuard } from "../../../components/settings/settings-page.tsx";
import { orpc } from "../../../lib/orpc.ts";
import { INDIAN_STATES } from "../../../lib/india.ts";
import {
  COUNTRY_OPTIONS,
  draftSignature,
  draftsFromSettings,
  draftsToPayload,
  emptyRate,
  emptyZone,
  type RateDraft,
  type RateType,
  type ZoneDraft,
} from "../../../lib/shipping-draft.ts";

export const Route = createFileRoute("/_store/settings/shipping")({
  pendingComponent: () => <PageSkeleton />,
  component: ShippingSettingsPage,
});

const TITLE = "Shipping & delivery";
const DESCRIPTION = "Set up shipping zones, then choose how each zone charges: a flat rate, by order value, by weight, or free above an amount.";

const RATE_TYPES: Array<{ value: RateType; label: string }> = [
  { value: "flat", label: "Flat rate" },
  { value: "free_above_threshold", label: "Free above an order value" },
  { value: "price_tier", label: "By order value" },
  { value: "weight_tier", label: "By weight" },
];

const STATE_OPTIONS = INDIAN_STATES.map((s) => ({ value: s, label: s }));

export function ShippingSettingsPage() {
  const { data } = useQuery(orpc.admin.shipping.get.queryOptions({}));

  if (!data) {
    return (
      <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
        <SettingsCard>
          <FormSkeleton />
        </SettingsCard>
      </SettingsPageFrame>
    );
  }
  return <ShippingSettingsForm initialData={data} />;
}

/** A rupee amount field with a fixed ₹ prefix. */
function RupeeInput({ id, value, onChange, placeholder, ariaLabel }: { id: string; value: string; onChange: (v: string) => void; placeholder?: string; ariaLabel?: string }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" aria-hidden>
        ₹
      </span>
      <Input id={id} type="number" min="0" step="1" value={value} onChange={(e) => onChange(e.target.value)} className="pl-6" placeholder={placeholder} aria-label={ariaLabel} />
    </div>
  );
}

function RateRow({ rate, zoneKey, onChange, onRemove, canRemove }: { rate: RateDraft; zoneKey: string; onChange: (next: RateDraft) => void; onRemove: () => void; canRemove: boolean }) {
  const id = (s: string) => `${zoneKey}-${rate.key}-${s}`;
  const set = (patch: Partial<RateDraft>) => onChange({ ...rate, ...patch });

  return (
    <div className="grid gap-3 rounded-lg border border-border bg-muted/20 p-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_9rem_14rem_auto] sm:items-end">
        <Field id={id("name")} label="Rate name">
          <Input id={id("name")} value={rate.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} />
        </Field>
        <Field id={id("method")} label="Speed">
          <SimpleSelect
            ariaLabel="Delivery speed"
            value={rate.method}
            onChange={(v) => set({ method: v as "standard" | "express" })}
            options={[
              { value: "standard", label: "Standard" },
              { value: "express", label: "Express" },
            ]}
          />
        </Field>
        <Field id={id("type")} label="Charged">
          <SimpleSelect ariaLabel="How this rate is charged" value={rate.rateType} onChange={(v) => set({ rateType: v as RateType })} options={RATE_TYPES} />
        </Field>
        <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={!canRemove} onClick={onRemove} aria-label={`Remove rate ${rate.name}`}>
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field id={id("price")} label="Price (₹)" hint={rate.rateType === "free_above_threshold" ? "Charged below the free-shipping value." : "0 means free."}>
          <RupeeInput id={id("price")} value={rate.price} onChange={(v) => set({ price: v })} />
        </Field>

        {rate.rateType === "free_above_threshold" ? (
          <Field id={id("threshold")} label="Free above (₹)" hint="Orders at or above this value ship free.">
            <RupeeInput id={id("threshold")} value={rate.threshold} onChange={(v) => set({ threshold: v })} />
          </Field>
        ) : null}

        {rate.rateType === "price_tier" ? (
          <>
            <Field id={id("minsub")} label="Order value from (₹)" hint="Included.">
              <RupeeInput id={id("minsub")} value={rate.minSubtotal} onChange={(v) => set({ minSubtotal: v })} placeholder="0" />
            </Field>
            <Field id={id("maxsub")} label="Up to (₹)" hint="Not included. Empty = no limit.">
              <RupeeInput id={id("maxsub")} value={rate.maxSubtotal} onChange={(v) => set({ maxSubtotal: v })} placeholder="No limit" />
            </Field>
          </>
        ) : null}

        {rate.rateType === "weight_tier" ? (
          <>
            <Field id={id("minw")} label="Weight from (g)" hint="Included. Total of the cart.">
              <Input id={id("minw")} type="number" min="0" step="1" value={rate.minWeight} onChange={(e) => set({ minWeight: e.target.value })} placeholder="0" />
            </Field>
            <Field id={id("maxw")} label="Up to (g)" hint="Not included. Empty = no limit.">
              <Input id={id("maxw")} type="number" min="0" step="1" value={rate.maxWeight} onChange={(e) => set({ maxWeight: e.target.value })} placeholder="No limit" />
            </Field>
          </>
        ) : null}

        <div className="grid grid-cols-2 gap-3 sm:col-span-2">
          <Field id={id("mind")} label="Days from">
            <Input id={id("mind")} type="number" min="0" step="1" value={rate.minDays} onChange={(e) => set({ minDays: e.target.value })} />
          </Field>
          <Field id={id("maxd")} label="Days to">
            <Input id={id("maxd")} type="number" min="0" step="1" value={rate.maxDays} onChange={(e) => set({ maxDays: e.target.value })} />
          </Field>
        </div>
      </div>
    </div>
  );
}

function ZoneCard({
  zone,
  onChange,
  onRemove,
  onMakeDefault,
  canRemove,
}: {
  zone: ZoneDraft;
  onChange: (next: ZoneDraft) => void;
  onRemove: () => void;
  onMakeDefault: () => void;
  canRemove: boolean;
}) {
  const setRate = (key: string, next: RateDraft) => onChange({ ...zone, rates: zone.rates.map((r) => (r.key === key ? next : r)) });
  const isIndiaOnly = zone.countries.length === 1 && zone.countries[0] === "IN";

  return (
    <SettingsCard>
      <div className="grid gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid min-w-56 flex-1 gap-1.5 sm:max-w-md">
            <label htmlFor={`${zone.key}-name`} className="text-xs font-medium text-foreground">Zone name</label>
            <Input id={`${zone.key}-name`} value={zone.name} onChange={(e) => onChange({ ...zone, name: e.target.value })} maxLength={80} placeholder="e.g. South India" />
          </div>
          <div className="flex items-center gap-2">
            {zone.isDefault ? (
              <Badge variant="secondary">Default zone</Badge>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={onMakeDefault}>
                Make default
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={!canRemove || zone.isDefault} onClick={onRemove} aria-label={`Remove zone ${zone.name}`} title={zone.isDefault ? "Make another zone the default first" : undefined}>
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">Countries</span>
            <MultiSelect
              options={COUNTRY_OPTIONS}
              value={zone.countries}
              onChange={(next) => onChange({ ...zone, countries: next, states: next.length === 1 && next[0] === "IN" ? zone.states : [] })}
              placeholder="Choose countries"
              searchPlaceholder="Search countries"
              maxDisplay={4}
            />
            <p className="text-[11px] text-muted-foreground">Orders are matched by the shopper's shipping country.</p>
          </div>
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">States</span>
            {isIndiaOnly ? (
              <>
                <MultiSelect options={STATE_OPTIONS} value={zone.states} onChange={(next) => onChange({ ...zone, states: next })} placeholder="All states" searchPlaceholder="Search states" maxDisplay={4} />
                <p className="text-[11px] text-muted-foreground">Leave empty to cover all of India. A zone that lists a state wins over one that covers the whole country.</p>
              </>
            ) : (
              <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">States can be chosen for a zone that covers only India.</p>
            )}
          </div>
        </div>

        <div className="grid gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Rates</h3>
            <Button type="button" variant="outline" size="sm" onClick={() => onChange({ ...zone, rates: [...zone.rates, emptyRate("standard")] })}>
              <Plus className="mr-1.5 size-3.5" aria-hidden /> Add rate
            </Button>
          </div>
          {zone.rates.map((r) => (
            <RateRow
              key={r.key}
              rate={r}
              zoneKey={zone.key}
              onChange={(next) => setRate(r.key, next)}
              onRemove={() => onChange({ ...zone, rates: zone.rates.filter((x) => x.key !== r.key) })}
              canRemove={zone.rates.length > 1}
            />
          ))}
          <p className="text-[11px] text-muted-foreground">
            Shoppers see one option per speed: the cheapest rate that applies to their cart. Price and weight ranges include the lower value and exclude the upper one, and ranges for the same speed should not overlap.
          </p>
        </div>
      </div>
    </SettingsCard>
  );
}

function ShippingSettingsForm({ initialData }: { initialData: ShippingSettings }) {
  const queryClient = useQueryClient();
  const [zones, setZones] = useState<ZoneDraft[]>(() => draftsFromSettings(initialData));
  const [saved, setSaved] = useState(() => draftSignature(draftsFromSettings(initialData)));
  const [formError, setFormError] = useState<string | null>(null);
  const [zoneToRemove, setZoneToRemove] = useState<ZoneDraft | null>(null);

  const dirty = draftSignature(zones) !== saved;
  const guard = useUnsavedGuard(dirty);

  const saveMutation = useMutation(
    orpc.admin.shipping.saveZones.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.admin.shipping.get.key() });
        setSaved(draftSignature(zones));
        toast.success("Shipping zones saved.");
      },
      onError: (err) => {
        setFormError(err.message || "Failed to save shipping zones");
      },
    }),
  );

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const result = draftsToPayload(zones);
    if (result.payload === null) {
      setFormError(result.error);
      return;
    }
    setFormError(null);
    saveMutation.mutate(result.payload);
  };

  const makeDefault = (key: string) => setZones((prev) => prev.map((z) => ({ ...z, isDefault: z.key === key })));

  return (
    <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
      {guard}
      <HeaderActions>
        <Button type="submit" form="shipping-form" disabled={saveMutation.isPending || !dirty}>
          {saveMutation.isPending ? "Saving…" : "Save changes"}
        </Button>
      </HeaderActions>

      <ConfirmDialog
        open={Boolean(zoneToRemove)}
        onOpenChange={(open) => {
          if (!open) setZoneToRemove(null);
        }}
        title="Remove this zone?"
        description={zoneToRemove ? `"${zoneToRemove.name}" and its rates are removed when you save. Orders in that region will use the default zone. Past orders keep what they were charged.` : ""}
        confirmLabel="Remove zone"
        destructive
        onConfirm={() => {
          if (zoneToRemove) setZones((prev) => prev.filter((z) => z.key !== zoneToRemove.key));
          setZoneToRemove(null);
        }}
      />

      <form id="shipping-form" onSubmit={handleSave} className="space-y-6">
        {zones.map((zone) => (
          <ZoneCard
            key={zone.key}
            zone={zone}
            onChange={(next) => setZones((prev) => prev.map((z) => (z.key === zone.key ? next : z)))}
            onRemove={() => setZoneToRemove(zone)}
            onMakeDefault={() => makeDefault(zone.key)}
            canRemove={zones.length > 1}
          />
        ))}

        <div>
          <Button type="button" variant="outline" disabled={zones.length >= 20} onClick={() => setZones((prev) => [...prev, emptyZone(`Zone ${prev.length + 1}`)])}>
            <Plus className="mr-1.5 size-4" aria-hidden /> Add zone
          </Button>
        </div>

        {formError ? (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs font-medium text-destructive">
            {formError}
          </p>
        ) : null}
      </form>

      <ShippingPreviewCalculator hasUnsavedChanges={dirty} />
    </SettingsPageFrame>
  );
}

function ShippingPreviewCalculator({ hasUnsavedChanges }: { hasUnsavedChanges: boolean }) {
  const [testSubtotal, setTestSubtotal] = useState("500");
  const [testWeight, setTestWeight] = useState("");
  const [testState, setTestState] = useState("");
  const previewMutation = useMutation(orpc.admin.shipping.preview.mutationOptions());

  const handlePreview = (e: React.FormEvent) => {
    e.preventDefault();
    const paise = Math.round((parseFloat(testSubtotal) || 0) * 100);
    const grams = testWeight.trim() === "" ? undefined : Math.max(0, Math.round(Number(testWeight)) || 0);
    previewMutation.mutate({
      subtotalPaise: paise,
      ...(grams !== undefined ? { weightGrams: grams } : {}),
      ...(testState ? { destinationCountry: "IN", destinationState: testState } : {}),
    });
  };

  return (
    <SettingsCard title="Rate preview & calculator" description="Try a cart to see which zone and rates a shopper would get">
      <form onSubmit={handlePreview} className="grid items-end gap-3 sm:grid-cols-4">
        <Field id="testSubtotal" label="Order subtotal (₹)">
          <RupeeInput id="testSubtotal" value={testSubtotal} onChange={setTestSubtotal} />
        </Field>
        <Field id="testWeight" label="Cart weight (g)">
          <Input id="testWeight" type="number" min="0" step="1" value={testWeight} onChange={(e) => setTestWeight(e.target.value)} placeholder="e.g. 750" />
        </Field>
        <Field id="testState" label="Shipping state (India)">
          <SimpleSelect
            ariaLabel="Shipping state"
            value={testState}
            onChange={setTestState}
            options={[{ value: "", label: "Not specified" }, ...STATE_OPTIONS]}
          />
        </Field>
        <Button type="submit" variant="secondary" disabled={previewMutation.isPending}>
          {previewMutation.isPending ? "Calculating…" : "Calculate rates"}
        </Button>
      </form>
      {hasUnsavedChanges ? <p className="mt-2 text-[11px] text-muted-foreground">The calculator uses your saved zones. Save your changes to try them.</p> : null}

      {previewMutation.isError ? <p className="mt-3 text-xs text-destructive">{previewMutation.error.message}</p> : null}

      {previewMutation.data ? (
        <div className="mt-4 space-y-2 rounded-lg border border-border bg-muted/30 p-3 text-xs">
          <div className="font-medium text-foreground">
            Matched zone: <span className="font-semibold text-primary">{previewMutation.data.zoneName}</span>
          </div>
          {previewMutation.data.rates.length === 0 ? (
            <p className="text-muted-foreground">No rate applies to this cart in that zone.</p>
          ) : (
            <div className="divide-y divide-border/60">
              {previewMutation.data.rates.map((r, i) => (
                <div key={i} className="flex flex-col gap-1 py-2.5 first:pt-1 last:pb-0">
                  <div className="flex justify-between font-medium text-foreground">
                    <span>
                      {r.title} ({r.estimatedDays})
                    </span>
                    <span className="font-semibold">{r.isFree ? "Free" : `₹${(r.amountPaise / 100).toFixed(0)}`}</span>
                  </div>
                  <div className="rounded border border-border/40 bg-background/80 p-2 font-mono text-[11px] text-muted-foreground">{r.trace}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </SettingsCard>
  );
}

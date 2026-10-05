import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { FormSkeleton, PageSkeleton, toast } from "@bs/ui";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ShippingSettings } from "@bs/contracts";
import { Button } from "@bs/ui";
import { Checkbox } from "@bs/ui";
import { Input } from "@bs/ui";
import { Field } from "../../../components/field.tsx";
import { HeaderActions, SettingsPageFrame, SettingsSection, useUnsavedGuard } from "../../../components/settings/settings-page.tsx";
import { orpc } from "../../../lib/orpc.ts";

export const Route = createFileRoute("/_store/settings/shipping")({
  pendingComponent: () => <PageSkeleton />,
  component: ShippingSettingsPage,
});

const TITLE = "Shipping & delivery";
const DESCRIPTION = "Configure domestic shipping zones, flat delivery rates, and free delivery thresholds.";

export function ShippingSettingsPage() {
  const { data } = useQuery(orpc.admin.shipping.get.queryOptions({}));

  if (!data) {
    return (
      <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
        <SettingsSection>
          <FormSkeleton />
        </SettingsSection>
      </SettingsPageFrame>
    );
  }
  return <ShippingSettingsForm initialData={data} />;
}

/** A rupee amount field with a fixed ₹ prefix. */
function RupeeInput({ id, value, onChange, min = "0", required }: { id: string; value: string; onChange: (v: string) => void; min?: string; required?: boolean }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" aria-hidden>
        ₹
      </span>
      <Input id={id} type="number" min={min} step="1" value={value} onChange={(e) => onChange(e.target.value)} className="pl-6" required={required} />
    </div>
  );
}

function ShippingSettingsForm({ initialData }: { initialData: ShippingSettings }) {
  const queryClient = useQueryClient();

  const defaultZone = initialData.zones.find((z) => z.isDefault) ?? initialData.zones[0];
  const initialStandard = defaultZone?.rates.find((r) => r.method === "standard");
  const initialExpress = defaultZone?.rates.find((r) => r.method === "express");

  const base = {
    zoneName: defaultZone?.name ?? "Domestic (India)",
    standard: initialStandard ? (initialStandard.pricePaise / 100).toString() : "0",
    express: initialExpress ? (initialExpress.pricePaise / 100).toString() : "150",
    freeShipping: initialStandard?.thresholdPaise != null,
    threshold: initialStandard?.thresholdPaise != null ? (initialStandard.thresholdPaise / 100).toString() : "999",
  };

  const [zoneName, setZoneName] = useState(base.zoneName);
  const [standardRupees, setStandardRupees] = useState(base.standard);
  const [expressRupees, setExpressRupees] = useState(base.express);
  const [enableFreeShipping, setEnableFreeShipping] = useState(base.freeShipping);
  const [thresholdRupees, setThresholdRupees] = useState(base.threshold);

  const dirty =
    zoneName !== base.zoneName ||
    standardRupees !== base.standard ||
    expressRupees !== base.express ||
    enableFreeShipping !== base.freeShipping ||
    (enableFreeShipping && thresholdRupees !== base.threshold);
  const guard = useUnsavedGuard(dirty);

  const updateMutation = useMutation(
    orpc.admin.shipping.update.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.admin.shipping.get.key() });
        toast.success("Shipping rates saved.");
      },
      onError: (err) => {
        toast.error(err.message || "Failed to save shipping rates");
      },
    }),
  );

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate({
      zoneName: zoneName.trim() || "Domestic (India)",
      standardRatePaise: Math.round((parseFloat(standardRupees) || 0) * 100),
      expressRatePaise: Math.round((parseFloat(expressRupees) || 0) * 100),
      freeShippingThresholdPaise: enableFreeShipping ? Math.round((parseFloat(thresholdRupees) || 0) * 100) : null,
    });
  };

  return (
    <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
      {guard}
      <HeaderActions>
        <Button type="submit" form="shipping-form" disabled={updateMutation.isPending || !dirty}>
          {updateMutation.isPending ? "Saving…" : "Save changes"}
        </Button>
      </HeaderActions>

      <form id="shipping-form" onSubmit={handleSave}>
        <SettingsSection title="Shipping zone" description="The primary region covered by these rates.">
          <div className="max-w-sm">
            <Field id="zoneName" label="Zone name">
              <Input id="zoneName" value={zoneName} onChange={(e) => setZoneName(e.target.value)} placeholder="e.g. Domestic (India)" required />
            </Field>
          </div>
        </SettingsSection>

        <SettingsSection title="Delivery rates" description="The shipping charges customers pay for Standard and Express delivery.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="standardRate" label="Standard shipping (₹)" hint="Set to 0 for free standard shipping.">
              <RupeeInput id="standardRate" value={standardRupees} onChange={setStandardRupees} required />
            </Field>
            <Field id="expressRate" label="Express shipping (₹)" hint="Expedited delivery (2–3 business days).">
              <RupeeInput id="expressRate" value={expressRupees} onChange={setExpressRupees} required />
            </Field>
          </div>
        </SettingsSection>

        <SettingsSection title="Free delivery" description="Offer free standard shipping on carts over a minimum subtotal.">
          <label className="flex items-center gap-2 text-xs font-medium text-foreground">
            <Checkbox checked={enableFreeShipping} onCheckedChange={(c) => setEnableFreeShipping(c)} />
            Free standard shipping above a minimum subtotal
          </label>
          {enableFreeShipping ? (
            <div className="max-w-xs">
              <Field id="threshold" label="Minimum order subtotal (₹)" hint="Orders at or above this subtotal ship free.">
                <RupeeInput id="threshold" value={thresholdRupees} onChange={setThresholdRupees} min="1" required />
              </Field>
            </div>
          ) : null}
        </SettingsSection>
      </form>
    </SettingsPageFrame>
  );
}

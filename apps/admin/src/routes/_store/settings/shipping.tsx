import { createFileRoute } from "@tanstack/react-router";
import { Check, RotateCcw, Save, Truck } from "lucide-react";
import { useState } from "react";
import {
  Button,
  Input,
  Label,
  MetricCard,
  MetricCardSkeleton,
  PageBreadcrumbs,
  PageContainer,
  PageHeader,
  PageSection,
  PageSkeleton,
  toast,
} from "@bs/ui";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ShippingSettings } from "@bs/contracts";
import { orpc } from "../../../lib/orpc.ts";

export const Route = createFileRoute("/_store/settings/shipping")({
  pendingComponent: () => (
    <PageSkeleton>
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </div>
    </PageSkeleton>
  ),
  component: ShippingSettingsPage,
});

export function ShippingSettingsPage() {
  const { data, isLoading } = useQuery(
    orpc.admin.shipping.get.queryOptions({}),
  );

  if (isLoading || !data) {
    return (
      <PageSkeleton>
        <div className="grid gap-4 sm:grid-cols-3">
          <MetricCardSkeleton />
          <MetricCardSkeleton />
          <MetricCardSkeleton />
        </div>
      </PageSkeleton>
    );
  }

  return <ShippingSettingsForm initialData={data} />;
}

function ShippingSettingsForm({ initialData }: { initialData: ShippingSettings }) {
  const queryClient = useQueryClient();

  const defaultZone = initialData.zones.find((z) => z.isDefault) ?? initialData.zones[0];
  const initialStandard = defaultZone?.rates.find((r) => r.method === "standard");
  const initialExpress = defaultZone?.rates.find((r) => r.method === "express");

  const [zoneName, setZoneName] = useState(defaultZone?.name ?? "Domestic (India)");
  const [standardRupees, setStandardRupees] = useState(
    initialStandard ? (initialStandard.pricePaise / 100).toString() : "0",
  );
  const [expressRupees, setExpressRupees] = useState(
    initialExpress ? (initialExpress.pricePaise / 100).toString() : "150",
  );
  const [enableFreeShipping, setEnableFreeShipping] = useState(
    initialStandard?.thresholdPaise != null,
  );
  const [thresholdRupees, setThresholdRupees] = useState(
    initialStandard?.thresholdPaise != null
      ? (initialStandard.thresholdPaise / 100).toString()
      : "999",
  );
  const [isSaved, setIsSaved] = useState(false);

  // Mutation
  const updateMutation = useMutation(
    orpc.admin.shipping.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.admin.shipping.get.key() });
        setIsSaved(true);
        toast.success("Store shipping rates saved successfully.");
        setTimeout(() => setIsSaved(false), 3000);
      },
      onError: (err) => {
        toast.error(err.message || "Failed to save shipping rates");
      },
    }),
  );

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const standardPaise = Math.round((parseFloat(standardRupees) || 0) * 100);
    const expressPaise = Math.round((parseFloat(expressRupees) || 0) * 100);
    const thresholdPaise = enableFreeShipping
      ? Math.round((parseFloat(thresholdRupees) || 0) * 100)
      : null;

    updateMutation.mutate({
      zoneName: zoneName.trim() || "Domestic (India)",
      standardRatePaise: standardPaise,
      expressRatePaise: expressPaise,
      freeShippingThresholdPaise: thresholdPaise,
    });
  };

  return (
    <PageContainer>
      <PageBreadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Settings", href: "/settings" },
          { label: "Shipping", href: "/settings/shipping" },
        ]}
      />

      <PageHeader
        title="Shipping & Delivery"
        description="Configure domestic shipping zones, flat delivery rates, and free delivery thresholds."
        aside={
          <Button
            type="submit"
            form="shipping-form"
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending ? (
              <>
                <RotateCcw className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : isSaved ? (
              <>
                <Check className="mr-2 h-4 w-4 text-emerald-500" />
                Saved
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save Changes
              </>
            )}
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        <MetricCard
          label="Active Zone"
          value={zoneName}
          icon={Truck}
          description="Default delivery territory"
        />
        <MetricCard
          label="Standard Delivery"
          value={parseFloat(standardRupees) === 0 ? "Free" : `₹${standardRupees}`}
          description="Default standard shipping rate"
        />
        <MetricCard
          label="Free Delivery Threshold"
          value={enableFreeShipping ? `₹${thresholdRupees}` : "Disabled"}
          description={enableFreeShipping ? "Orders qualify for free delivery" : "Flat shipping applied"}
        />
      </div>

      <form id="shipping-form" onSubmit={handleSave} className="space-y-6 max-w-4xl">
        <PageSection
          title="Shipping Zone"
          description="Specify the primary region and country covered by these rates."
        >
          <div className="space-y-4 max-w-xl">
            <div>
              <Label htmlFor="zoneName">Zone Name</Label>
              <Input
                id="zoneName"
                value={zoneName}
                onChange={(e) => setZoneName(e.target.value)}
                placeholder="e.g. Domestic (India)"
                required
              />
            </div>
          </div>
        </PageSection>

        <PageSection
          title="Delivery Rates (paise-accurate)"
          description="Set the customer-facing shipping charges for Standard and Express delivery."
        >
          <div className="grid gap-6 sm:grid-cols-2 max-w-2xl">
            <div className="space-y-2">
              <Label htmlFor="standardRate">Standard Shipping Rate (₹)</Label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-muted-foreground text-sm">₹</span>
                <Input
                  id="standardRate"
                  type="number"
                  min="0"
                  step="1"
                  value={standardRupees}
                  onChange={(e) => setStandardRupees(e.target.value)}
                  className="pl-7"
                  required
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Set to 0 for default free standard shipping.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="expressRate">Express Shipping Rate (₹)</Label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-muted-foreground text-sm">₹</span>
                <Input
                  id="expressRate"
                  type="number"
                  min="0"
                  step="1"
                  value={expressRupees}
                  onChange={(e) => setExpressRupees(e.target.value)}
                  className="pl-7"
                  required
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Expedited delivery (2-3 business days).
              </p>
            </div>
          </div>
        </PageSection>

        <PageSection
          title="Free Delivery Threshold"
          description="Encourage higher order values by offering free shipping on cart subtotals over a threshold."
        >
          <div className="space-y-4 max-w-xl">
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="enableFreeShipping"
                checked={enableFreeShipping}
                onChange={(e) => setEnableFreeShipping(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <Label htmlFor="enableFreeShipping" className="cursor-pointer font-medium">
                Enable free standard shipping above minimum subtotal
              </Label>
            </div>

            {enableFreeShipping && (
              <div className="space-y-2 pl-6">
                <Label htmlFor="threshold">Minimum Order Subtotal (₹)</Label>
                <div className="relative max-w-xs">
                  <span className="absolute left-3 top-2.5 text-muted-foreground text-sm">₹</span>
                  <Input
                    id="threshold"
                    type="number"
                    min="1"
                    step="1"
                    value={thresholdRupees}
                    onChange={(e) => setThresholdRupees(e.target.value)}
                    className="pl-7"
                    required={enableFreeShipping}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Orders equal to or exceeding this subtotal receive free standard shipping.
                </p>
              </div>
            )}
          </div>
        </PageSection>
      </form>
    </PageContainer>
  );
}

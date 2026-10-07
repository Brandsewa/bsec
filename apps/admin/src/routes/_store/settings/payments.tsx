import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, Clock, ShieldAlert, Sparkles, AlertCircle } from "lucide-react";
import { EmptyState, FormSkeleton, PageSkeleton, toast } from "@bs/ui";
import { Badge } from "@bs/ui";
import { Alert } from "@bs/ui";
import { Button } from "@bs/ui";
import { Switch } from "@bs/ui";
import { Input } from "@bs/ui";
import { Field } from "@bs/ui";
import { HeaderActions, SettingsCard, SettingsPageFrame, useUnsavedGuard } from "../../../components/settings/settings-page.tsx";
import { orpc } from "../../../lib/orpc.ts";
import { errorMessage } from "../../../lib/errors.ts";

export const Route = createFileRoute("/_store/settings/payments")({
  pendingComponent: () => <PageSkeleton />,
  component: PaymentsSettingsPage,
});

const TITLE = "Payments";
const DESCRIPTION = "Payment methods catalogue, manual payments (Cash on Delivery), and online gateway status.";

export function PaymentsSettingsPage() {
  const query = useQuery(orpc.admin.paymentMethods.list.queryOptions());
  const { store } = useRouteContext({ from: "/_store" });
  const canManagePayments = (store?.permissions ?? []).includes("payments.manage");

  if (query.isLoading) {
    return (
      <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
        <SettingsCard>
          <FormSkeleton />
        </SettingsCard>
      </SettingsPageFrame>
    );
  }

  if (query.isError || !query.data) {
    return (
      <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
        <SettingsCard>
          <EmptyState
            icon={AlertTriangle}
            title="Could not load payment methods"
            description={errorMessage(query.error)}
            action={<Button onClick={() => void query.refetch()}>Try again</Button>}
          />
        </SettingsCard>
      </SettingsPageFrame>
    );
  }

  const methods = query.data;
  const codMethod = methods.find((m) => m.provider === "cod");
  const razorpayMethod = methods.find((m) => m.provider === "razorpay");

  return (
    <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
      {!canManagePayments ? (
        <Alert role="alert">
          <span className="font-medium text-foreground">Read-only view:</span> Only store owners and administrators with payment management permissions can edit payment configurations.
        </Alert>
      ) : null}

      <SettingsCard
        title="Payment methods catalogue"
        description="Supported channels for manual and online payments"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {/* Cash on delivery card */}
          <div className="flex flex-col justify-between rounded-lg border border-border p-4 bg-muted/10">
            <div>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-foreground">Cash on Delivery (COD)</h3>
                {codMethod?.status === "active" ? (
                  <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 gap-1 text-[11px]">
                    <CheckCircle2 className="h-3 w-3" /> Active
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-[11px]">Disabled</Badge>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Manual payment method allowing customers to pay with cash or UPI upon delivery.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between text-xs text-muted-foreground">
              <span>{codMethod?.status === "active" ? "Customers can checkout via COD" : "Disabled on storefront"}</span>
              <span className="font-medium text-foreground">Manual</span>
            </div>
          </div>

          {/* Razorpay card */}
          <div className="flex flex-col justify-between rounded-lg border border-border p-4 bg-muted/10">
            <div>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-foreground">Razorpay</h3>
                {razorpayMethod?.status === "active" ? (
                  <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 gap-1 text-[11px]">
                    <CheckCircle2 className="h-3 w-3" /> Active
                  </Badge>
                ) : razorpayMethod?.status === "pending_setup" ? (
                  <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 gap-1 text-[11px]">
                    <Clock className="h-3 w-3" /> Pending setup
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="gap-1 text-[11px]">
                    <AlertCircle className="h-3 w-3" /> Unavailable
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Accept UPI, Cards, Netbanking, and Wallets in Indian Rupees directly into your account.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between text-xs text-muted-foreground">
              <span>{razorpayMethod?.status === "active" ? "Gateway connected" : "Adapter unavailable / deferred"}</span>
              <span className="font-medium text-foreground">Online</span>
            </div>
          </div>

          {/* Coming Soon: PhonePe */}
          <div className="flex flex-col justify-between rounded-lg border border-dashed border-border p-4 bg-muted/20 opacity-80">
            <div>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-foreground">PhonePe Payment Gateway</h3>
                <Badge variant="secondary" className="gap-1 text-[11px]">
                  <Sparkles className="h-3 w-3 text-amber-500" /> Coming soon
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Direct UPI flows and merchant payments powered by PhonePe PG.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-border/60 text-xs text-muted-foreground">
              <span>Planned in future platform releases</span>
            </div>
          </div>

          {/* Coming Soon: PayU */}
          <div className="flex flex-col justify-between rounded-lg border border-dashed border-border p-4 bg-muted/20 opacity-80">
            <div>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-foreground">PayU India</h3>
                <Badge variant="secondary" className="gap-1 text-[11px]">
                  <Sparkles className="h-3 w-3 text-amber-500" /> Coming soon
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Enterprise payment gateway for high-volume transactions and EMI.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-border/60 text-xs text-muted-foreground">
              <span>Planned in future platform releases</span>
            </div>
          </div>
        </div>
      </SettingsCard>

      {/* Cash on Delivery configuration form */}
      <CodConfigurationForm
        codMethod={codMethod}
        disabled={!canManagePayments}
        onSaved={() => void query.refetch()}
      />

      {/* Online Gateway Info Banner */}
      <SettingsCard
        title="Online payment gateways"
        description="Configuration for third-party payment service providers"
      >
        <div className="rounded-lg border border-border p-4 bg-muted/20">
          <div className="flex items-start gap-3">
            <ShieldAlert className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
            <div className="text-xs space-y-1">
              <p className="font-medium text-foreground">Online Payment Credentials Deferred</p>
              <p className="text-muted-foreground leading-relaxed">
                In accordance with platform governance, live payment gateway integrations (Razorpay) remain in test/deferred posture until authorized by the platform owner. Orders placeable on store fronts default to Cash on Delivery.
              </p>
            </div>
          </div>
        </div>
      </SettingsCard>
    </SettingsPageFrame>
  );
}

interface CodFormValues {
  enabled: boolean;
  displayName: string;
  feeRupees: string;
  minOrderRupees: string;
  maxOrderRupees: string;
  instructions: string;
}

function CodConfigurationForm({
  codMethod,
  disabled,
  onSaved,
}: {
  codMethod:
    | {
        status: string;
        displayName?: string | null;
        instructions?: string | null;
        config?: Record<string, unknown> | null;
      }
    | undefined;
  disabled: boolean;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const updateMutation = useMutation(orpc.admin.paymentMethods.updateCod.mutationOptions());

  const initialEnabled = codMethod?.status === "active";
  const initialDisplayName = codMethod?.displayName ?? "Cash on Delivery (COD)";
  const initialInstructions = codMethod?.instructions ?? "Pay with cash or UPI QR code at delivery.";

  const feePaise = typeof codMethod?.config?.feePaise === "number" ? codMethod.config.feePaise : 0;
  const minPaise = typeof codMethod?.config?.minOrderPaise === "number" ? codMethod.config.minOrderPaise : null;
  const maxPaise = typeof codMethod?.config?.maxOrderPaise === "number" ? codMethod.config.maxOrderPaise : null;

  const initialValues: CodFormValues = {
    enabled: initialEnabled,
    displayName: initialDisplayName,
    feeRupees: String(feePaise / 100),
    minOrderRupees: minPaise != null ? String(minPaise / 100) : "",
    maxOrderRupees: maxPaise != null ? String(maxPaise / 100) : "",
    instructions: initialInstructions,
  };

  const [form, setForm] = useState<CodFormValues>(initialValues);

  const isDirty =
    form.enabled !== initialValues.enabled ||
    form.displayName !== initialValues.displayName ||
    form.feeRupees !== initialValues.feeRupees ||
    form.minOrderRupees !== initialValues.minOrderRupees ||
    form.maxOrderRupees !== initialValues.maxOrderRupees ||
    form.instructions !== initialValues.instructions;

  const unsavedGuard = useUnsavedGuard(isDirty && !disabled);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (disabled) return;

    const feeNum = Number(form.feeRupees);
    if (!Number.isFinite(feeNum) || feeNum < 0) {
      toast.error("Please enter a valid handling fee (₹0 or greater).");
      return;
    }

    let minOrderPaise: number | null = null;
    if (form.minOrderRupees.trim()) {
      const minNum = Number(form.minOrderRupees);
      if (!Number.isFinite(minNum) || minNum < 0) {
        toast.error("Please enter a valid minimum order value (₹0 or greater).");
        return;
      }
      minOrderPaise = Math.round(minNum * 100);
    }

    let maxOrderPaise: number | null = null;
    if (form.maxOrderRupees.trim()) {
      const maxNum = Number(form.maxOrderRupees);
      if (!Number.isFinite(maxNum) || maxNum <= 0) {
        toast.error("Please enter a valid maximum order value.");
        return;
      }
      maxOrderPaise = Math.round(maxNum * 100);
    }

    if (minOrderPaise != null && maxOrderPaise != null && minOrderPaise > maxOrderPaise) {
      toast.error("Minimum order value cannot exceed maximum order value.");
      return;
    }

    updateMutation.mutate(
      {
        enabled: form.enabled,
        displayName: form.displayName.trim() || "Cash on Delivery (COD)",
        feePaise: Math.round(feeNum * 100),
        minOrderPaise,
        maxOrderPaise,
      },
      {
        onSuccess: () => {
          toast.success("Cash on Delivery settings saved");
          void queryClient.invalidateQueries({ queryKey: orpc.admin.paymentMethods.key() });
          void queryClient.invalidateQueries({ queryKey: orpc.admin.settings.key() });
          onSaved();
        },
        onError: (err) => {
          toast.error(errorMessage(err));
        },
      },
    );
  }

  function handleReset() {
    setForm(initialValues);
  }

  return (
    <SettingsCard
      title="Cash on Delivery configuration"
      description="Handling charges, order thresholds, and storefront display text"
      actions={
        !disabled && isDirty ? (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleReset} disabled={updateMutation.isPending}>
              Discard
            </Button>
            <Button size="sm" type="submit" form="cod-settings-form" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving…" : "Save COD"}
            </Button>
          </div>
        ) : undefined
      }
    >
      {unsavedGuard}
      {!disabled && isDirty ? (
        <HeaderActions>
          <Button variant="outline" size="sm" onClick={handleReset} disabled={updateMutation.isPending}>
            Discard
          </Button>
          <Button size="sm" type="submit" form="cod-settings-form" disabled={updateMutation.isPending}>
            {updateMutation.isPending ? "Saving…" : "Save COD"}
          </Button>
        </HeaderActions>
      ) : null}
      <form id="cod-settings-form" onSubmit={handleSubmit} className="grid gap-4 max-w-xl">
        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div>
            <p className="text-sm font-medium text-foreground">Enable Cash on Delivery</p>
            <p className="text-xs text-muted-foreground">Offer COD option to buyers at checkout.</p>
          </div>
          <Switch
            checked={form.enabled}
            disabled={disabled || updateMutation.isPending}
            onCheckedChange={(checked) => setForm((prev) => ({ ...prev, enabled: checked }))}
          />
        </div>

        <Field id="displayName" label="Storefront display name" hint="What customers see in checkout payment options.">
          <Input
            id="displayName"
            value={form.displayName}
            disabled={disabled || !form.enabled || updateMutation.isPending}
            onChange={(e) => setForm((prev) => ({ ...prev, displayName: e.target.value }))}
            placeholder="Cash on Delivery (COD)"
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="feeRupees" label="COD fee (₹)" hint="Additional fee (0 for free).">
            <Input
              id="feeRupees"
              type="number"
              min={0}
              step="0.01"
              value={form.feeRupees}
              disabled={disabled || !form.enabled || updateMutation.isPending}
              onChange={(e) => setForm((prev) => ({ ...prev, feeRupees: e.target.value }))}
            />
          </Field>

          <Field id="minOrder" label="Min order (₹)" hint="Optional minimum order limit.">
            <Input
              id="minOrder"
              type="number"
              min={0}
              step="1"
              value={form.minOrderRupees}
              disabled={disabled || !form.enabled || updateMutation.isPending}
              onChange={(e) => setForm((prev) => ({ ...prev, minOrderRupees: e.target.value }))}
              placeholder="No minimum"
            />
          </Field>

          <Field id="maxOrder" label="Max order (₹)" hint="Optional maximum order limit.">
            <Input
              id="maxOrder"
              type="number"
              min={1}
              step="1"
              value={form.maxOrderRupees}
              disabled={disabled || !form.enabled || updateMutation.isPending}
              onChange={(e) => setForm((prev) => ({ ...prev, maxOrderRupees: e.target.value }))}
              placeholder="No maximum"
            />
          </Field>
        </div>

        <Field id="instructions" label="Payment instructions" hint="Shown to customers when placing an order with COD.">
          <Input
            id="instructions"
            value={form.instructions}
            disabled={disabled || !form.enabled || updateMutation.isPending}
            onChange={(e) => setForm((prev) => ({ ...prev, instructions: e.target.value }))}
            placeholder="Pay with cash or UPI QR code at delivery."
          />
        </Field>

        {!disabled && isDirty ? (
          <div>
            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving…" : "Save COD settings"}
            </Button>
          </div>
        ) : null}
      </form>
    </SettingsCard>
  );
}

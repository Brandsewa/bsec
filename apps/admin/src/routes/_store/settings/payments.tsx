import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, Clock, ShieldAlert, Sparkles, AlertCircle, CreditCard } from "lucide-react";
import { EmptyState, FormSkeleton, PageSkeleton, Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, toast } from "@bs/ui";
import type { StorePaymentProvider } from "@bs/contracts";
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

      <OnlineGateways canManage={canManagePayments} />
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

type GatewayAction = "test" | "activate" | "deactivate" | "clear";

const STATE_LABEL: Record<StorePaymentProvider["state"], string> = {
  not_connected: "Not connected",
  connected_test: "Connected, not active",
  active: "Active",
  live_blocked: "Live keys blocked",
};

function GatewayStateBadge({ provider }: { provider: StorePaymentProvider }) {
  if (!provider.platformEnabled) {
    return (
      <Badge variant="secondary" className="text-[11px]">
        Turned off by platform
      </Badge>
    );
  }
  if (provider.state === "active") {
    return (
      <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 gap-1 text-[11px]">
        <CheckCircle2 className="h-3 w-3" /> Active
      </Badge>
    );
  }
  if (provider.state === "live_blocked") {
    return (
      <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 gap-1 text-[11px]">
        <ShieldAlert className="h-3 w-3" /> {STATE_LABEL[provider.state]}
      </Badge>
    );
  }
  if (provider.state === "connected_test") {
    return (
      <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 gap-1 text-[11px]">
        <Clock className="h-3 w-3" /> {STATE_LABEL[provider.state]}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1 text-[11px]">
      <AlertCircle className="h-3 w-3" /> {STATE_LABEL[provider.state]}
    </Badge>
  );
}

/** Online gateways the platform has enabled for this store (Razorpay, Stripe): connect keys, test, activate. */
function OnlineGateways({ canManage }: { canManage: boolean }) {
  const query = useQuery(orpc.admin.paymentProviders.list.queryOptions());
  const [openProvider, setOpenProvider] = useState<StorePaymentProvider["provider"] | null>(null);
  const providers = query.data ?? [];
  const open = providers.find((p) => p.provider === openProvider) ?? null;

  return (
    <SettingsCard
      title="Online payment gateways"
      description="Gateways your platform has enabled. Connect your own account with test keys, check the connection, then activate."
    >
      <div className="mb-4 flex items-start gap-3 rounded-lg border border-border bg-muted/20 p-3 text-xs">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Shoppers cannot pay online yet.</span> You can connect and test a gateway now,
          but checkout still offers Cash on Delivery only until online checkout is switched on for the platform.
        </p>
      </div>

      {query.isLoading ? <FormSkeleton /> : null}
      {query.isError ? (
        <EmptyState
          icon={AlertTriangle}
          title="Could not load payment gateways"
          description={errorMessage(query.error)}
          action={<Button onClick={() => void query.refetch()}>Try again</Button>}
        />
      ) : null}
      {query.data && providers.length === 0 ? (
        <p className="text-xs text-muted-foreground">No online gateways are enabled for stores yet. Ask the platform team to enable one.</p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {providers.map((p) => (
          <div key={p.provider} className="flex flex-col justify-between rounded-lg border border-border bg-muted/10 p-4">
            <div>
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <CreditCard className="h-4 w-4 text-muted-foreground" aria-hidden /> {p.displayName}
                </h3>
                <GatewayStateBadge provider={p} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {p.provider === "razorpay"
                  ? "Accept UPI, cards, netbanking and wallets in rupees."
                  : "Accept cards through Stripe-hosted Checkout (the shopper pays on stripe.com)."}
              </p>
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3 text-xs text-muted-foreground">
              <span>
                {p.keyHint ? `Key ${p.keyHint}` : "No keys saved"}
                {p.mode ? ` · ${p.mode} mode` : ""}
              </span>
              <Button size="sm" variant="outline" onClick={() => setOpenProvider(p.provider)}>
                {p.state === "not_connected" ? "Connect" : "Manage"}
              </Button>
            </div>
          </div>
        ))}
      </div>

      <GatewaySheet provider={open} canManage={canManage} onClose={() => setOpenProvider(null)} />
    </SettingsCard>
  );
}

function GatewaySheet({ provider, canManage, onClose }: { provider: StorePaymentProvider | null; canManage: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [busy, setBusy] = useState<GatewayAction | "save" | null>(null);

  const saveMutation = useMutation(orpc.admin.paymentProviders.saveCredentials.mutationOptions());
  const clearMutation = useMutation(orpc.admin.paymentProviders.clearCredentials.mutationOptions());
  const testMutation = useMutation(orpc.admin.paymentProviders.test.mutationOptions());
  const activeMutation = useMutation(orpc.admin.paymentProviders.setActive.mutationOptions());

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: orpc.admin.paymentProviders.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.admin.paymentMethods.key() });
  }

  if (!provider) return <Sheet open={false} onOpenChange={onClose} />;
  const isRazorpay = provider.provider === "razorpay";
  const locked = !canManage || !provider.platformEnabled;
  const webhookUrl = `https://<your-store-domain>${provider.webhookPath}`;

  async function run<T>(action: GatewayAction | "save", fn: () => Promise<T>, okMessage: (r: T) => string | null): Promise<boolean> {
    setBusy(action);
    try {
      const r = await fn();
      const msg = okMessage(r);
      if (msg) toast.success(msg);
      refresh();
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{provider.displayName}</SheetTitle>
          <SheetDescription>
            {provider.platformEnabled
              ? provider.liveModeAllowed
                ? "Test and live keys are allowed."
                : "Test keys only. Live keys are not allowed on this platform yet."
              : "The platform has turned this gateway off. Your saved keys are kept; you can deactivate or remove them."}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-4 text-xs">
          <dl className="grid grid-cols-2 gap-2">
            <div className="rounded-md border border-border p-2">
              <dt className="text-muted-foreground">Status</dt>
              <dd className="mt-0.5">
                <GatewayStateBadge provider={provider} />
              </dd>
            </div>
            <div className="rounded-md border border-border p-2">
              <dt className="text-muted-foreground">Last connection test</dt>
              <dd className="mt-0.5 font-medium text-foreground">
                {provider.lastTestOk === null ? "Not run" : provider.lastTestOk ? "Passed" : "Failed"}
              </dd>
            </div>
          </dl>
          {provider.lastTestOk === false && provider.lastTestError ? <Alert role="alert">{provider.lastTestError}</Alert> : null}
          {provider.state === "live_blocked" ? (
            <Alert role="alert">These are live keys, but live mode is not allowed on this platform. Replace them with test keys to continue.</Alert>
          ) : null}

          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (locked) return;
              void run(
                "save",
                () =>
                  saveMutation.mutateAsync({
                    provider: provider.provider,
                    ...(isRazorpay ? { keyId: keyId.trim() } : {}),
                    keySecret: keySecret.trim(),
                    ...(webhookSecret.trim() ? { webhookSecret: webhookSecret.trim() } : {}),
                  }),
                () => "Keys saved. Run Test connection next.",
              ).then((ok) => {
                if (ok) {
                  setKeyId("");
                  setKeySecret("");
                  setWebhookSecret("");
                }
              });
            }}
          >
            <p className="font-medium text-foreground">
              {provider.keyHint ? "Replace keys" : "Add keys"}
              <span className="ml-2 font-normal text-muted-foreground">Stored encrypted and never shown again.</span>
            </p>
            {isRazorpay ? (
              <Field id="gw-key-id" label="Key ID" hint="Starts with rzp_test_ (rzp_live_ only if live mode is allowed).">
                <Input id="gw-key-id" autoComplete="off" value={keyId} disabled={locked} onChange={(e) => setKeyId(e.target.value)} placeholder="rzp_test_..." />
              </Field>
            ) : null}
            <Field
              id="gw-key-secret"
              label={isRazorpay ? "Key secret" : "Secret key"}
              hint={isRazorpay ? undefined : "Starts with sk_test_ (sk_live_ only if live mode is allowed)."}
            >
              <Input
                id="gw-key-secret"
                type="password"
                autoComplete="off"
                value={keySecret}
                disabled={locked}
                onChange={(e) => setKeySecret(e.target.value)}
                placeholder={isRazorpay ? "" : "sk_test_..."}
              />
            </Field>
            <Field
              id="gw-webhook"
              label="Webhook signing secret"
              hint={
                isRazorpay
                  ? "Optional now; from your Razorpay webhook settings."
                  : "From the Stripe webhook endpoint you create below (starts with whsec_). Needed to activate."
              }
            >
              <Input
                id="gw-webhook"
                type="password"
                autoComplete="off"
                value={webhookSecret}
                disabled={locked}
                onChange={(e) => setWebhookSecret(e.target.value)}
                placeholder={isRazorpay ? "" : "whsec_..."}
              />
            </Field>
            <Button type="submit" size="sm" disabled={locked || busy !== null || !keySecret.trim() || (isRazorpay && !keyId.trim())}>
              {busy === "save" ? "Saving…" : "Save keys"}
            </Button>
          </form>

          <div className="space-y-1 rounded-md border border-border p-3">
            <p className="font-medium text-foreground">Webhook URL</p>
            <p className="text-muted-foreground">
              Add this endpoint in your {provider.displayName} dashboard, then paste its signing secret above. Replace the host with your store&apos;s domain.
            </p>
            <p className="break-all rounded bg-muted p-1.5 font-mono text-[10px]">{webhookUrl}</p>
          </div>
        </div>

        <SheetFooter className="flex-col gap-2 border-t border-border sm:flex-col">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={locked || busy !== null || provider.state === "not_connected"}
              onClick={() =>
                void run("test", () => testMutation.mutateAsync({ provider: provider.provider }), (r) =>
                  r.ok ? `Connection works (${r.mode ?? "test"} mode).` : null,
                )
              }
            >
              {busy === "test" ? "Testing…" : "Test connection"}
            </Button>
            {provider.state === "active" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={!canManage || busy !== null}
                onClick={() =>
                  void run("deactivate", () => activeMutation.mutateAsync({ provider: provider.provider, active: false }), () => `${provider.displayName} deactivated.`)
                }
              >
                Deactivate
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={locked || busy !== null || provider.state !== "connected_test"}
                onClick={() =>
                  void run("activate", () => activeMutation.mutateAsync({ provider: provider.provider, active: true }), () => `${provider.displayName} activated.`)
                }
              >
                {busy === "activate" ? "Activating…" : "Activate"}
              </Button>
            )}
            {provider.state !== "not_connected" ? (
              <Button
                size="sm"
                variant="outline"
                className="text-destructive"
                disabled={!canManage || busy !== null}
                onClick={() =>
                  void run("clear", () => clearMutation.mutateAsync({ provider: provider.provider }), () => "Keys removed.").then((ok) => {
                    if (ok) onClose();
                  })
                }
              >
                Remove keys
              </Button>
            ) : null}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Activating marks the gateway ready. Checkout will offer it to shoppers once online checkout is switched on.
          </p>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

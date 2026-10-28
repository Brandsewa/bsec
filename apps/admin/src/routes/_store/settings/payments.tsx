import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, Clock, ShieldAlert, AlertCircle, CreditCard, Copy, Plus, Banknote, Globe } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, EmptyState, FormSkeleton, PageSkeleton, Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SimpleSelect, toast } from "@bs/ui";
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
        title="Payment methods"
        description="Choose how your shoppers can pay"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {/* Manual payments */}
          <div className="flex flex-col justify-between rounded-lg border border-border p-4 bg-muted/10">
            <div>
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <Banknote className="h-4 w-4 text-muted-foreground" aria-hidden /> Manual payments
                </h3>
                {codMethod?.status === "active" ? (
                  <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 gap-1 text-[11px]">
                    <CheckCircle2 className="h-3 w-3" /> Active
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-[11px]">Off</Badge>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Cash on Delivery: customers pay with cash or UPI when the order arrives.
              </p>
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3 text-xs text-muted-foreground">
              <span>{codMethod?.status === "active" ? "Customers can checkout via COD" : "Not offered at checkout"}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => document.getElementById("cod-configuration")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              >
                Configure
              </Button>
            </div>
          </div>

          {/* Online payment gateways */}
          <div className="flex flex-col justify-between rounded-lg border border-border p-4 bg-muted/10">
            <div>
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <Globe className="h-4 w-4 text-muted-foreground" aria-hidden /> Online payment gateways
                </h3>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Accept UPI, cards, netbanking and wallets through a payment gateway such as Razorpay.
              </p>
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3 text-xs text-muted-foreground">
              <span>Add and set up a gateway below</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => document.getElementById("online-gateways")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              >
                View
              </Button>
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
      id="cod-configuration"
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
      <div className="flex items-center gap-1.5 flex-wrap">
        <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 gap-1 text-[11px]">
          <CheckCircle2 className="h-3 w-3" /> Active
        </Badge>
        {provider.checkoutLive ? (
          <Badge variant="outline" className="border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400 gap-1 text-[11px]">
            Checkout live
          </Badge>
        ) : null}
      </div>
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

const GATEWAY_BLURB: Record<StorePaymentProvider["provider"], string> = {
  razorpay: "Accept UPI, cards, netbanking and wallets in rupees.",
  stripe: "Accept cards through Stripe-hosted Checkout (the shopper pays on stripe.com).",
  cashfree: "Accept UPI, cards, netbanking and wallets in rupees through your own Cashfree account.",
  paypal: "Accept PayPal and international cards in 20+ currencies.",
};

/**
 * Online gateways the platform has enabled for this store (Razorpay, Stripe, Cashfree). "Add gateway" opens a picker; the chosen
 * gateway appears as a card here and its Configure button opens the drawer to save keys, test and activate.
 */
function OnlineGateways({ canManage }: { canManage: boolean }) {
  const query = useQuery(orpc.admin.paymentProviders.list.queryOptions());
  const [openProvider, setOpenProvider] = useState<StorePaymentProvider["provider"] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // A gateway the owner just picked stays listed (as "Not connected") until keys are saved, so Configure is one click away.
  const [picked, setPicked] = useState<Array<StorePaymentProvider["provider"]>>([]);
  const providers = query.data ?? [];
  const open = providers.find((p) => p.provider === openProvider) ?? null;
  const added = providers.filter((p) => p.state !== "not_connected" || picked.includes(p.provider));
  const available = providers.filter((p) => !added.some((a) => a.provider === p.provider));

  function choose(provider: StorePaymentProvider["provider"]) {
    setPicked((prev) => (prev.includes(provider) ? prev : [...prev, provider]));
    setPickerOpen(false);
    setOpenProvider(provider);
  }

  return (
    <SettingsCard
      id="online-gateways"
      title="Online payment gateways"
      description="Add a gateway, connect your own account with test keys, check the connection, then activate."
      actions={
        canManage ? (
          <Button size="sm" variant="outline" disabled={available.length === 0} onClick={() => setPickerOpen(true)}>
            <Plus className="mr-1.5 size-3.5" aria-hidden /> Add gateway
          </Button>
        ) : undefined
      }
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
      {query.data && providers.length > 0 && added.length === 0 ? (
        <p className="text-xs text-muted-foreground">No gateway added yet. Use "Add gateway" to choose one.</p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {added.map((p) => (
          <div key={p.provider} className="flex flex-col justify-between rounded-lg border border-border bg-muted/10 p-4">
            <div>
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <CreditCard className="h-4 w-4 text-muted-foreground" aria-hidden /> {p.displayName}
                </h3>
                <GatewayStateBadge provider={p} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{GATEWAY_BLURB[p.provider]}</p>
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3 text-xs text-muted-foreground">
              <span>
                {p.keyHint ? `Key ${p.keyHint}` : "No keys saved"}
                {p.mode ? ` · ${p.mode} mode` : ""}
              </span>
              <Button size="sm" variant="outline" onClick={() => setOpenProvider(p.provider)}>
                Configure
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add a payment gateway</DialogTitle>
            <DialogDescription>Choose a gateway to connect to your store. You will set it up in the next step.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {available.length === 0 ? (
              <p className="text-xs text-muted-foreground">All available gateways are already added.</p>
            ) : (
              available.map((p) => (
                <button
                  key={p.provider}
                  type="button"
                  disabled={!p.platformEnabled}
                  onClick={() => choose(p.provider)}
                  className="flex items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="grid gap-0.5">
                    <span className="text-sm font-medium text-foreground">{p.displayName}</span>
                    <span className="text-xs text-muted-foreground">
                      {p.platformEnabled ? GATEWAY_BLURB[p.provider] : "Turned off by the platform"}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <GatewaySheet provider={open} canManage={canManage} onClose={() => setOpenProvider(null)} />
    </SettingsCard>
  );
}

function GatewaySheet({ provider, canManage, onClose }: { provider: StorePaymentProvider | null; canManage: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [mode, setMode] = useState<"test" | "live">("test");
  const [busy, setBusy] = useState<GatewayAction | "save" | null>(null);
  const domainsQuery = useQuery(orpc.admin.domains.list.queryOptions());
  const { store } = useRouteContext({ from: "/_store" });

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
  const isCashfree = provider.provider === "cashfree";
  const isPayPal = provider.provider === "paypal";
  // Razorpay, Cashfree, and PayPal pair an id (Key ID, App ID, or Client ID) with a secret; Stripe has a single secret key.
  const hasKeyId = isRazorpay || isCashfree || isPayPal;
  const locked = !canManage || !provider.platformEnabled;
  // Use the store's real primary host so the URL can be pasted into the gateway dashboard as is.
  const domains = domainsQuery.data ?? [];
  const primaryHost =
    domains.find((d) => d.isPrimary && d.status === "active")?.hostname ??
    domains.find((d) => d.isPrimary)?.hostname ??
    (store?.slug ? `${store.slug}.bcom.si` : null);
  const webhookUrl = `https://${primaryHost ?? "<your-store-domain>"}${provider.webhookPath}`;

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
      <SheetContent className="overflow-y-auto">
        <SheetHeader className="p-5 pb-3 sm:p-8 sm:pb-4">
          <SheetTitle>{provider.displayName}</SheetTitle>
          <SheetDescription>
            {provider.platformEnabled
              ? provider.liveModeAllowed
                ? "Test and live keys are allowed."
                : "Test keys only. Live keys are not allowed on this platform yet."
              : "The platform has turned this gateway off. Your saved keys are kept; you can deactivate or remove them."}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 px-5 pb-6 text-xs sm:px-8">
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
                    ...(hasKeyId ? { keyId: keyId.trim() } : {}),
                    keySecret: keySecret.trim(),
                    ...(webhookSecret.trim() ? { webhookSecret: webhookSecret.trim() } : {}),
                    ...(isPayPal ? { mode } : {}),
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
            {isPayPal ? (
              <Field
                id="gw-paypal-mode"
                label="Environment / Mode"
                hint="PayPal credentials do not specify their environment in the key string. Choose Sandbox for testing."
              >
                {locked ? (
                  <Input id="gw-paypal-mode" value={mode === "test" ? "Sandbox (test mode)" : "Live (production)"} disabled className="bg-muted text-muted-foreground" />
                ) : (
                  <SimpleSelect
                    value={mode}
                    onChange={(val) => setMode(val as "test" | "live")}
                    options={[
                      { value: "test", label: "Sandbox (test mode)" },
                      { value: "live", label: "Live (production)" },
                    ]}
                  />
                )}
              </Field>
            ) : null}
            {hasKeyId ? (
              <Field
                id="gw-key-id"
                label={isCashfree ? "App ID" : isPayPal ? "Client ID" : "Key ID"}
                hint={
                  isCashfree
                    ? "From Cashfree, Developers, API keys. Use the sandbox (test) App ID first."
                    : isPayPal
                      ? "From PayPal Developer Dashboard > Apps & Credentials (REST app)."
                      : "Starts with rzp_test_ (rzp_live_ only if live mode is allowed)."
                }
              >
                <Input
                  id="gw-key-id"
                  autoComplete="off"
                  value={keyId}
                  disabled={locked}
                  onChange={(e) => setKeyId(e.target.value)}
                  placeholder={isCashfree ? "TEST10..." : isPayPal ? "Enter PayPal REST client ID" : "rzp_test_..."}
                />
              </Field>
            ) : null}
            <Field
              id="gw-key-secret"
              label={isRazorpay ? "Key secret" : isPayPal ? "Client Secret" : "Secret key"}
              hint={
                isRazorpay
                  ? undefined
                  : isCashfree
                    ? "Starts with cfsk_ma_test_ (cfsk_ma_prod_ only if live mode is allowed). Cashfree also uses it to sign webhooks."
                    : isPayPal
                      ? "From PayPal Developer Dashboard > Apps & Credentials (REST app secret)."
                      : "Starts with sk_test_ (sk_live_ only if live mode is allowed)."
              }
            >
              <Input
                id="gw-key-secret"
                type="password"
                autoComplete="off"
                value={keySecret}
                disabled={locked}
                onChange={(e) => setKeySecret(e.target.value)}
                placeholder={isRazorpay ? "" : isCashfree ? "cfsk_ma_test_..." : isPayPal ? "" : "sk_test_..."}
              />
            </Field>
            {isCashfree ? null : (
            <Field
              id="gw-webhook"
              label={isPayPal ? "Webhook ID" : "Webhook signing secret"}
              hint={
                isRazorpay
                  ? "Optional now; from your Razorpay webhook settings."
                  : isPayPal
                    ? "From the webhook you register in PayPal Developer Dashboard. Needed to activate."
                    : "From the Stripe webhook endpoint you create below (starts with whsec_). Needed to activate."
              }
            >
              <Input
                id="gw-webhook"
                type={isPayPal ? "text" : "password"}
                autoComplete="off"
                value={webhookSecret}
                disabled={locked}
                onChange={(e) => setWebhookSecret(e.target.value)}
                placeholder={isRazorpay ? "" : isPayPal ? "e.g. 8JH201..." : "whsec_..."}
              />
            </Field>
            )}
            <Button type="submit" size="sm" disabled={locked || busy !== null || !keySecret.trim() || (hasKeyId && !keyId.trim())}>
              {busy === "save" ? "Saving…" : "Save keys"}
            </Button>
          </form>

          <div className="space-y-1 rounded-md border border-border p-3">
            <p className="font-medium text-foreground">Webhook URL</p>
            <p className="text-muted-foreground">
              {isCashfree
                ? "Add this endpoint in Cashfree (Developers, Webhooks) and subscribe to the payment events. Cashfree signs it with your secret key, so there is nothing more to paste."
                : isPayPal
                  ? "Add this endpoint in PayPal (Apps & Credentials > Webhooks) and subscribe to payment capture & refund events. Then copy the Webhook ID and paste it above."
                  : `Add this endpoint in your ${provider.displayName} dashboard, then paste its signing secret above.`}
            </p>
            <p className="break-all rounded bg-muted p-1.5 font-mono text-[10px]">{webhookUrl}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard
                  .writeText(webhookUrl)
                  .then(() => toast.success("Webhook URL copied"))
                  .catch(() => toast.error("Could not copy. Select the URL and copy it by hand."));
              }}
            >
              <Copy className="mr-1.5 size-3.5" aria-hidden /> Copy URL
            </Button>
          </div>
        </div>

        <SheetFooter className="flex-col gap-2 border-t border-border px-5 py-4 sm:flex-col sm:px-8">
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

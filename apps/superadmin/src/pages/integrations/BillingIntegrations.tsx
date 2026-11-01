import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, CheckCircle2 } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Input,
  Label,
  MetricCardsSkeleton,
  PageContainer,
  PageHeader,
  Switch,
  toast,
} from "@bs/ui";
import type { PlatformBillingSettingsView } from "@bs/contracts";
import { client } from "../../lib/orpc.ts";
import { messageOf } from "../../lib/errors.ts";
import { useHasRole } from "../../lib/user-context.tsx";
import { GATEWAY_NAME, InvoiceDetailsCard, TrialCard } from "./billing/cards.tsx";

type Gateway = keyof typeof GATEWAY_NAME;
type Confirm = null | "enable" | "disable" | "live" | "test" | { gateway: Gateway; on: boolean };

/** Whether the keys for the mode in use are saved, so the gateway can actually charge. */
function keysReady(data: PlatformBillingSettingsView, gateway: Gateway): boolean {
  const set = gateway === "razorpay" ? data[data.mode] : gateway === "cashfree" ? data.cashfree[data.mode] : data.paypal[data.mode];
  return Boolean(set.keyId && set.secretConfigured) || (gateway === "razorpay" && data.usingEnvFallback);
}

function StatusIcon({ ready, label }: { ready: boolean; label: string }) {
  return ready ? (
    <span title={`${label}: keys saved`} className="text-emerald-600 dark:text-emerald-400">
      <CheckCircle2 className="h-4 w-4" aria-label={`${label}: keys saved`} />
    </span>
  ) : (
    <span title={`${label}: keys missing`} className="text-amber-600 dark:text-amber-400">
      <AlertTriangle className="h-4 w-4" aria-label={`${label}: keys missing`} />
    </span>
  );
}

function GatewayRow({
  gateway,
  detail,
  on,
  ready,
  canEdit,
  switchDisabled,
  onToggle,
  onManage,
}: {
  gateway: Gateway;
  detail: string;
  on: boolean;
  ready: boolean;
  canEdit: boolean;
  switchDisabled?: boolean;
  onToggle: (next: boolean) => void;
  onManage: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{GATEWAY_NAME[gateway]}</span>
          <StatusIcon ready={ready} label={GATEWAY_NAME[gateway]} />
          {on ? <Badge>Active</Badge> : null}
        </div>
        <p className="text-[11px] text-muted-foreground">{detail}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Switch aria-label={`${GATEWAY_NAME[gateway]} active`} checked={on} disabled={!canEdit || switchDisabled} onCheckedChange={onToggle} />
        <Button size="sm" variant="outline" onClick={onManage}>
          Manage
        </Button>
      </div>
    </div>
  );
}

export function BillingIntegrations() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canEdit = useHasRole("platform_owner");
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [saving, setSaving] = useState(false);
  const [grace, setGrace] = useState<string>("");

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["platform", "integrations", "billing"],
    queryFn: () => client.integrations.billingSettings(),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["platform", "integrations", "billing"] });
  const manage = (gateway: Gateway) => navigate({ to: "/integrations/billing/$gateway", params: { gateway } });

  const apply = async () => {
    if (!confirm) return;
    setSaving(true);
    try {
      await client.integrations.updateBillingSettings(
        confirm === "enable"
          ? { enabled: true }
          : confirm === "disable"
            ? { enabled: false }
            : confirm === "live"
              ? { mode: "live" }
              : confirm === "test"
                ? { mode: "test" }
                : confirm.gateway === "paypal"
                  ? { paypalEnabled: confirm.on }
                  : { provider: confirm.gateway as "razorpay" | "cashfree" },
      );
      toast.success("Billing settings updated");
      setConfirm(null);
      await refresh();
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setSaving(false);
    }
  };

  const saveGrace = async () => {
    const days = Number(grace);
    if (!Number.isInteger(days) || days < 0 || days > 30) {
      toast.error("Grace period is 0 to 30 days");
      return;
    }
    try {
      await client.integrations.updateBillingSettings({ graceDays: days });
      toast.success("Grace period saved");
      setGrace("");
      await refresh();
    } catch (err) {
      toast.error(messageOf(err));
    }
  };

  const confirmText = (): { title: string; description: string; destructive: boolean } => {
    if (confirm === "enable") return { title: "Enable platform billing?", description: "Merchants will be able to subscribe and be charged with the active mode's keys.", destructive: false };
    if (confirm === "disable") return { title: "Disable platform billing?", description: "No new subscriptions or charges can be started. Existing subscriptions keep running on their gateway's side.", destructive: true };
    if (confirm === "live") return { title: "Switch to live mode?", description: "Merchants will be charged real money with the live keys. Make sure a full test-mode run has passed.", destructive: true };
    if (confirm === "test") return { title: "Switch back to test mode?", description: "New subscriptions will use the test keys again.", destructive: false };
    if (confirm) {
      const name = GATEWAY_NAME[confirm.gateway];
      return confirm.gateway === "paypal"
        ? confirm.on
          ? { title: "Switch PayPal on?", description: "Stores outside India will pay their plan in USD through PayPal. Indian stores are not affected.", destructive: false }
          : { title: "Switch PayPal off?", description: "Stores outside India will see that online payment is not available until PayPal is switched on again. Subscriptions already running stay where they are.", destructive: true }
        : { title: `Use ${name} for Indian stores?`, description: "New subscriptions from Indian stores will be created on this gateway. Subscriptions already running stay where they are. The gateway's keys for the active mode must be saved first.", destructive: false };
    }
    return { title: "", description: "", destructive: false };
  };
  const text = confirmText();

  return (
    <PageContainer>
      <div className="mb-4">
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground" onClick={() => navigate({ to: "/integrations" })}>
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Integrations</span>
        </Button>
      </div>

      <PageHeader
        title="Platform billing"
        description="How Brand Sewa charges merchants for their plan. Indian stores pay in INR through one national gateway; stores outside India pay in USD through PayPal. This is separate from each store's own payment gateway. Start in test mode."
      />

      {isLoading ? <MetricCardsSkeleton count={3} /> : null}
      {isError ? (
        <div role="alert" className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-foreground">Could not load billing settings</p>
          <p className="text-foreground-2">{messageOf(error)}</p>
          <Button size="sm" className="mt-2" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      ) : null}

      {data ? (
        <div className="mt-4 space-y-6">
          {!canEdit ? (
            <Alert>
              <AlertTitle>View only</AlertTitle>
              <AlertDescription>Only a platform owner can change billing settings.</AlertDescription>
            </Alert>
          ) : null}
          {data.usingEnvFallback && data.provider === "razorpay" ? (
            <Alert>
              <AlertTitle>Using server environment keys</AlertTitle>
              <AlertDescription>No Razorpay keys are saved here, so Indian billing falls back to the RAZORPAY_PLATFORM_* values on the server. Open Razorpay, Manage, to save keys and manage them here.</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]">
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle>Billing status</CardTitle>
                    <div className="flex gap-2">
                      <Badge variant={data.enabled ? "default" : "secondary"}>{data.enabled ? "Enabled" : "Disabled"}</Badge>
                      <Badge variant={data.mode === "live" ? "destructive" : "secondary"}>{data.mode === "live" ? "Live mode" : "Test mode"}</Badge>
                    </div>
                  </div>
                  <CardDescription>While billing is disabled, plan changes answer "billing is not configured" and no merchant is charged. Live mode uses the live keys of every gateway and charges real money.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                    <div>
                      <div className="text-sm font-medium text-foreground">Enable billing</div>
                      <div className="text-[11px] text-muted-foreground">Needs the keys of an active gateway for the active mode to be saved.</div>
                    </div>
                    <Switch aria-label="Enable billing" checked={data.enabled} disabled={!canEdit} onCheckedChange={(v) => setConfirm(v ? "enable" : "disable")} />
                  </div>
                  <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                    <div>
                      <div className="text-sm font-medium text-foreground">Live mode</div>
                      <div className="text-[11px] text-muted-foreground">Switch only after a full test-mode run.</div>
                    </div>
                    <Switch aria-label="Live mode" checked={data.mode === "live"} disabled={!canEdit} onCheckedChange={(v) => setConfirm(v ? "live" : "test")} />
                  </div>
                  <div className="flex flex-wrap items-end gap-3 rounded-md border border-border p-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="grace-days">Grace period after a failed payment (days)</Label>
                      <Input id="grace-days" type="number" min={0} max={30} className="w-28" value={grace} onChange={(e) => setGrace(e.target.value)} placeholder={String(data.graceDays)} disabled={!canEdit} />
                    </div>
                    <Button size="sm" variant="outline" disabled={!canEdit || !grace} onClick={() => void saveGrace()}>
                      Save
                    </Button>
                    <p className="text-[11px] text-muted-foreground">Currently {data.graceDays} days. After this a store is limited until it pays.</p>
                  </div>
                  {data.lastTestAt ? (
                    <p className="text-[11px] text-muted-foreground">
                      Last connection test: {data.lastTestStatus === "success" ? "passed" : "failed"} on {new Date(data.lastTestAt).toLocaleString()}
                      {data.lastTestError ? ` (${data.lastTestError})` : ""}
                    </p>
                  ) : null}
                </CardContent>
              </Card>

              <InvoiceDetailsCard key={`inv-${data.updatedAt ?? "new"}`} view={data.invoice} canEdit={canEdit} onSaved={refresh} />
              <TrialCard key={`${data.trial.enabled}-${data.trial.days}-${data.updatedAt ?? ""}`} view={data.trial} canEdit={canEdit} onSaved={refresh} />
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>National payment gateway</CardTitle>
                  <CardDescription>
                    Charges stores in India, in INR. One is active at a time; switching never interrupts a paying store, because running subscriptions stay on the gateway that created them.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(["razorpay", "cashfree"] as const).map((g) => (
                    <GatewayRow
                      key={g}
                      gateway={g}
                      detail={g === "razorpay" ? "UPI, cards, netbanking. Recurring mandates." : "UPI AutoPay and cards. Needs the owner's mobile number."}
                      on={data.provider === g}
                      ready={keysReady(data, g)}
                      canEdit={canEdit}
                      switchDisabled={data.provider === g}
                      onToggle={(next) => next && setConfirm({ gateway: g, on: true })}
                      onManage={() => void manage(g)}
                    />
                  ))}
                  <p className="text-[11px] text-muted-foreground">To change the active gateway, switch the other one on.</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>International payment gateway</CardTitle>
                  <CardDescription>Charges stores outside India, in USD. The store's country decides which gateway it sees, so no one picks a gateway by hand.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <GatewayRow
                    gateway="paypal"
                    detail="Pays in USD. PayPal balance, cards and Pay Later."
                    on={data.paypalEnabled}
                    ready={keysReady(data, "paypal")}
                    canEdit={canEdit}
                    onToggle={(next) => setConfirm({ gateway: "paypal", on: next })}
                    onManage={() => void manage("paypal")}
                  />
                  <div className="flex items-center justify-between gap-3 rounded-md border border-dashed border-border p-3 opacity-70">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">Stripe</span>
                        <Badge variant="secondary">Build later</Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground">Not available for platform billing yet.</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <Switch aria-label="Stripe active" checked={false} disabled />
                      <Button size="sm" variant="outline" disabled>
                        Manage
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setConfirm(null);
        }}
        title={text.title}
        description={text.description}
        confirmLabel={saving ? "Saving..." : "Confirm"}
        destructive={text.destructive}
        pending={saving}
        onConfirm={() => void apply()}
      />
    </PageContainer>
  );
}

import React, { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Input,
  Label,
  MetricCardsSkeleton,
  PageContainer,
  PageHeader,
  PasswordInput,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@bs/ui";
import type { PlatformBillingSettingsView } from "@bs/contracts";
import { client } from "../../lib/orpc.ts";
import { messageOf } from "../../lib/errors.ts";
import { useHasRole } from "../../lib/user-context.tsx";

type Mode = "test" | "live";
type KeySet = PlatformBillingSettingsView["test"];

interface KeyForm {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
}
const EMPTY: KeyForm = { keyId: "", keySecret: "", webhookSecret: "" };

function KeysCard({
  mode,
  view,
  active,
  canEdit,
  onSaved,
}: {
  mode: Mode;
  view: KeySet;
  active: boolean;
  canEdit: boolean;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState<KeyForm>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const prefix = mode === "test" ? "rzp_test_" : "rzp_live_";
  const dirty = Boolean(form.keyId.trim() || form.keySecret.trim() || form.webhookSecret.trim());

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await client.integrations.updateBillingSettings({
        [mode]: {
          ...(form.keyId.trim() ? { keyId: form.keyId.trim() } : {}),
          ...(form.keySecret.trim() ? { keySecret: form.keySecret.trim() } : {}),
          ...(form.webhookSecret.trim() ? { webhookSecret: form.webhookSecret.trim() } : {}),
        },
      });
      setForm(EMPTY);
      toast.success(`${mode === "test" ? "Test" : "Live"} keys saved`);
      await onSaved();
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const res = await client.integrations.testBillingConnection({ mode });
      if (res.ok) toast.success("Razorpay accepted these keys");
      else toast.error(res.error ?? "Razorpay rejected these keys");
      await onSaved();
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card>
      <form onSubmit={save}>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>{mode === "test" ? "Test keys" : "Live keys"}</CardTitle>
            {active ? <Badge>In use</Badge> : <Badge variant="secondary">Not in use</Badge>}
          </div>
          <CardDescription>
            {mode === "test"
              ? "From Razorpay, Test mode, Account and settings, API keys. Safe for practice payments."
              : "From Razorpay, Live mode. Real money moves with these keys. Save them only when you are ready."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`${mode}-key-id`}>Key ID</Label>
            <Input
              id={`${mode}-key-id`}
              value={form.keyId}
              onChange={(e) => setForm({ ...form, keyId: e.target.value })}
              placeholder={view.keyId ?? `${prefix}...`}
              autoComplete="off"
              disabled={!canEdit}
            />
            <p className="text-[11px] text-muted-foreground">Starts with {prefix}. {view.keyId ? "Saved; type to replace." : "Not saved yet."}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${mode}-key-secret`}>Key secret</Label>
            <PasswordInput
              id={`${mode}-key-secret`}
              value={form.keySecret}
              onChange={(e) => setForm({ ...form, keySecret: e.target.value })}
              placeholder={view.secretConfigured ? `Saved, ends in ${view.secretLastFour ?? "••••"}` : ""}
              autoComplete="new-password"
              disabled={!canEdit}
            />
            <p className="text-[11px] text-muted-foreground">Write-only. It is encrypted and never shown again.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${mode}-webhook`}>Webhook secret</Label>
            <PasswordInput
              id={`${mode}-webhook`}
              value={form.webhookSecret}
              onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })}
              placeholder={view.webhookSecretConfigured ? "Saved" : ""}
              autoComplete="new-password"
              disabled={!canEdit}
            />
            <p className="text-[11px] text-muted-foreground">The secret you type when adding the webhook in Razorpay (see the URL below).</p>
          </div>
        </CardContent>
        <CardFooter className="gap-2">
          <Button type="submit" size="sm" disabled={!canEdit || !dirty || saving}>
            {saving ? "Saving..." : "Save keys"}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={!canEdit || testing || !view.secretConfigured} onClick={() => void test()}>
            {testing ? "Testing..." : "Test connection"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function PlansCard({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["platform", "integrations", "billing-plans"],
    queryFn: () => client.integrations.billingPlans(),
  });

  const sync = async () => {
    setSyncing(true);
    try {
      const res = await client.integrations.syncBillingPlans();
      if (res.failed.length > 0) toast.error(`${res.failed.length} plan(s) failed: ${res.failed[0]?.error ?? ""}`);
      else toast.success(res.created > 0 ? `Created ${res.created} Razorpay plan(s)` : "Everything is already in sync");
      await queryClient.invalidateQueries({ queryKey: ["platform", "integrations", "billing-plans"] });
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setSyncing(false);
    }
  };

  const cell = (v: { pricePaise: number; razorpayPlanId: string | null; inSync: boolean }) =>
    v.pricePaise <= 0 ? (
      <span className="text-muted-foreground">Free</span>
    ) : (
      <div className="space-y-0.5">
        <div>{rupees(v.pricePaise)}</div>
        {v.inSync ? <Badge variant="secondary">Synced</Badge> : <Badge variant="destructive">{v.razorpayPlanId ? "Price changed" : "Not synced"}</Badge>}
      </div>
    );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Razorpay plans</CardTitle>
          <Button size="sm" disabled={!canEdit || syncing || !data?.canSync} onClick={() => void sync()}>
            {syncing ? "Syncing..." : "Sync plans to Razorpay"}
          </Button>
        </div>
        <CardDescription>
          Razorpay needs a plan for every price a merchant can subscribe to. Sync creates the missing ones for the {data?.mode ?? "test"} account; existing plans are never edited, so current subscribers are not affected when a price changes.
          {data && !data.canSync ? " Save and enable the keys above first." : ""}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? <MetricCardsSkeleton count={1} /> : null}
        {data ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan</TableHead>
                <TableHead>Monthly</TableHead>
                <TableHead>Yearly</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.plans.map((p) => (
                <TableRow key={p.planId}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>{cell(p.monthly)}</TableCell>
                  <TableCell>{cell(p.yearly)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function BillingIntegrations() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canEdit = useHasRole("platform_owner");
  const [confirm, setConfirm] = useState<null | "enable" | "disable" | "live" | "test">(null);
  const [saving, setSaving] = useState(false);
  const [grace, setGrace] = useState<string>("");

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["platform", "integrations", "billing"],
    queryFn: () => client.integrations.billingSettings(),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["platform", "integrations", "billing"] });

  const apply = async () => {
    if (!confirm) return;
    setSaving(true);
    try {
      await client.integrations.updateBillingSettings(
        confirm === "enable" ? { enabled: true } : confirm === "disable" ? { enabled: false } : confirm === "live" ? { mode: "live" } : { mode: "test" },
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
        description="The Razorpay account Brand Sewa uses to charge merchants for their plan. This is separate from each store's own payment gateway. Start in test mode."
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
          {data.usingEnvFallback ? (
            <Alert>
              <AlertTitle>Using server environment keys</AlertTitle>
              <AlertDescription>No keys are saved here, so billing falls back to the RAZORPAY_PLATFORM_* values on the server. Save keys below and enable billing to manage them here.</AlertDescription>
            </Alert>
          ) : null}

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>Billing status</CardTitle>
                <div className="flex gap-2">
                  <Badge variant={data.enabled ? "default" : "secondary"}>{data.enabled ? "Enabled" : "Disabled"}</Badge>
                  <Badge variant={data.mode === "live" ? "destructive" : "secondary"}>{data.mode === "live" ? "Live mode" : "Test mode"}</Badge>
                </div>
              </div>
              <CardDescription>
                While billing is disabled, plan changes answer "billing is not configured" and no merchant is charged. Live mode uses the live keys and charges real money.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                <div>
                  <div className="text-sm font-medium text-foreground">Enable billing</div>
                  <div className="text-[11px] text-muted-foreground">Needs the key ID and secret of the active mode to be saved.</div>
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

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <KeysCard mode="test" view={data.test} active={data.mode === "test"} canEdit={canEdit} onSaved={refresh} />
            <KeysCard mode="live" view={data.live} active={data.mode === "live"} canEdit={canEdit} onSaved={refresh} />
          </div>

          <PlansCard canEdit={canEdit} />

          <Card>
            <CardHeader>
              <CardTitle>Webhook URL</CardTitle>
              <CardDescription>
                In Razorpay (Account and settings, Webhooks) add this URL for the same mode as the keys, with the active events for subscriptions and payments, and the secret you saved above.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">{data.webhookUrl}</code>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => {
                    void navigator.clipboard.writeText(data.webhookUrl).then(() => toast.success("Webhook URL copied"));
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setConfirm(null);
        }}
        title={
          confirm === "enable" ? "Enable platform billing?" : confirm === "disable" ? "Disable platform billing?" : confirm === "live" ? "Switch to live mode?" : "Switch back to test mode?"
        }
        description={
          confirm === "enable"
            ? "Merchants will be able to subscribe and be charged with the active mode's keys."
            : confirm === "disable"
              ? "No new subscriptions or charges can be started. Existing Razorpay subscriptions keep running on Razorpay's side."
              : confirm === "live"
                ? "Merchants will be charged real money with the live keys. Make sure a full test-mode run has passed."
                : "New subscriptions will use the test keys again."
        }
        confirmLabel={saving ? "Saving..." : "Confirm"}
        destructive={confirm === "live" || confirm === "disable"}
        pending={saving}
        onConfirm={() => void apply()}
      />
    </PageContainer>
  );
}

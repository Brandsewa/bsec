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
import { formatMoney } from "@bs/contracts/money";
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
      const res = await client.integrations.testBillingConnection({ mode, provider: "razorpay" });
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

function CashfreeKeysCard({
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
  const [form, setForm] = useState({ clientId: "", clientSecret: "" });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const dirty = Boolean(form.clientId.trim() || form.clientSecret.trim());

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await client.integrations.updateBillingSettings({
        cashfree: {
          [mode]: {
            ...(form.clientId.trim() ? { clientId: form.clientId.trim() } : {}),
            ...(form.clientSecret.trim() ? { clientSecret: form.clientSecret.trim() } : {}),
          },
        },
      });
      setForm({ clientId: "", clientSecret: "" });
      toast.success(`Cashfree ${mode} keys saved`);
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
      const res = await client.integrations.testBillingConnection({ mode, provider: "cashfree" });
      if (res.ok) toast.success("Cashfree accepted these keys");
      else toast.error(res.error ?? "Cashfree rejected these keys");
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
            <CardTitle>Cashfree {mode === "test" ? "sandbox keys" : "live keys"}</CardTitle>
            {active ? <Badge>In use</Badge> : <Badge variant="secondary">Not in use</Badge>}
          </div>
          <CardDescription>
            {mode === "test"
              ? "From Cashfree, Developers, API keys, Sandbox. Safe for practice payments."
              : "From Cashfree, Developers, API keys, Production. Real money moves with these keys. Save them only when you are ready."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`cf-${mode}-id`}>App ID</Label>
            <Input id={`cf-${mode}-id`} value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} placeholder={view.keyId ?? ""} autoComplete="off" disabled={!canEdit} />
            <p className="text-[11px] text-muted-foreground">{view.keyId ? "Saved; type to replace." : "Not saved yet."}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`cf-${mode}-secret`}>Secret key</Label>
            <PasswordInput
              id={`cf-${mode}-secret`}
              value={form.clientSecret}
              onChange={(e) => setForm({ ...form, clientSecret: e.target.value })}
              placeholder={view.secretConfigured ? `Saved, ends in ${view.secretLastFour ?? "••••"}` : ""}
              autoComplete="new-password"
              disabled={!canEdit}
            />
            <p className="text-[11px] text-muted-foreground">Write-only. It is encrypted and never shown again. Cashfree also signs its webhooks with it, so there is no separate webhook secret.</p>
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

function PayPalKeysCard({
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
  const [form, setForm] = useState({ clientId: "", clientSecret: "", webhookId: "" });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const dirty = Boolean(form.clientId.trim() || form.clientSecret.trim() || form.webhookId.trim());

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await client.integrations.updateBillingSettings({
        paypal: {
          [mode]: {
            ...(form.clientId.trim() ? { clientId: form.clientId.trim() } : {}),
            ...(form.clientSecret.trim() ? { clientSecret: form.clientSecret.trim() } : {}),
            ...(form.webhookId.trim() ? { webhookId: form.webhookId.trim() } : {}),
          },
        },
      });
      setForm({ clientId: "", clientSecret: "", webhookId: "" });
      toast.success(`PayPal ${mode} credentials saved`);
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
      const res = await client.integrations.testBillingConnection({ mode, provider: "paypal" });
      if (res.ok) toast.success("PayPal accepted these credentials");
      else toast.error(res.error ?? "PayPal rejected these credentials");
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
            <CardTitle>PayPal {mode === "test" ? "sandbox credentials" : "live credentials"}</CardTitle>
            {active ? <Badge>In use</Badge> : <Badge variant="secondary">Not in use</Badge>}
          </div>
          <CardDescription>
            {mode === "test"
              ? "From PayPal Developer Dashboard, Apps & Credentials, Sandbox. Used for global stores subscribing in USD."
              : "From PayPal Developer Dashboard, Live. Real money moves with these keys. Save them only when you are ready."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`pp-${mode}-id`}>Client ID</Label>
            <Input id={`pp-${mode}-id`} value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} placeholder={view.keyId ?? ""} autoComplete="off" disabled={!canEdit} />
            <p className="text-[11px] text-muted-foreground">{view.keyId ? "Saved; type to replace." : "Not saved yet."}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`pp-${mode}-secret`}>Client Secret</Label>
            <PasswordInput
              id={`pp-${mode}-secret`}
              value={form.clientSecret}
              onChange={(e) => setForm({ ...form, clientSecret: e.target.value })}
              placeholder={view.secretConfigured ? `Saved, ends in ${view.secretLastFour ?? "••••"}` : ""}
              autoComplete="new-password"
              disabled={!canEdit}
            />
            <p className="text-[11px] text-muted-foreground">Write-only. Encrypted with platform secrets and never returned.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`pp-${mode}-webhook`}>Webhook ID</Label>
            <Input id={`pp-${mode}-webhook`} value={form.webhookId} onChange={(e) => setForm({ ...form, webhookId: e.target.value })} placeholder={view.webhookSecretConfigured ? "Configured" : ""} autoComplete="off" disabled={!canEdit} />
            <p className="text-[11px] text-muted-foreground">From PayPal Developer Dashboard when registering the webhook URL below. Needed to verify webhook signatures.</p>
          </div>
        </CardContent>
        <CardFooter className="gap-2">
          <Button type="submit" size="sm" disabled={!canEdit || !dirty || saving}>
            {saving ? "Saving..." : "Save credentials"}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={!canEdit || testing || !view.secretConfigured} onClick={() => void test()}>
            {testing ? "Testing..." : "Test connection"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function TrialCard({ view, canEdit, onSaved }: { view: PlatformBillingSettingsView["trial"]; canEdit: boolean; onSaved: () => Promise<void> }) {
  const [enabled, setEnabled] = useState(view.enabled);
  const [days, setDays] = useState(String(view.days));
  const [saving, setSaving] = useState(false);
  const dayCount = Number(days);
  const valid = Number.isInteger(dayCount) && dayCount >= 1 && dayCount <= 90;
  const dirty = enabled !== view.enabled || dayCount !== view.days;

  const save = async () => {
    if (!valid) {
      toast.error("The trial is 1 to 90 days");
      return;
    }
    setSaving(true);
    try {
      await client.integrations.updateBillingSettings({ trial: { enabled, days: dayCount } });
      toast.success("Free trial saved");
      await onSaved();
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Free trial</CardTitle>
        <CardDescription>
          What a new store gets when it is created, by signup or by you. Stores already on a trial keep their end date (extend one on its Tenant page). With the trial off, a new store starts on the restricted plan until its owner pays, which also lets you test a first charge straight away.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
          <div>
            <div className="text-sm font-medium text-foreground">Offer a free trial</div>
            <div className="text-[11px] text-muted-foreground">Currently {view.enabled ? `on, ${view.days} days` : "off"}.</div>
          </div>
          <Switch aria-label="Offer a free trial" checked={enabled} disabled={!canEdit} onCheckedChange={setEnabled} />
        </div>
        <div className="flex flex-wrap items-end gap-3 rounded-md border border-border p-3">
          <div className="space-y-1.5">
            <Label htmlFor="trial-days">Trial length (days)</Label>
            <Input id="trial-days" type="number" min={1} max={90} className="w-28" value={days} onChange={(e) => setDays(e.target.value)} disabled={!canEdit || !enabled} />
          </div>
          <p className="text-[11px] text-muted-foreground">1 to 90 days. The signup page and the first charge date follow this.</p>
        </div>
      </CardContent>
      <CardFooter>
        <Button size="sm" disabled={!canEdit || !dirty || !valid || saving} onClick={() => void save()}>
          {saving ? "Saving..." : "Save trial settings"}
        </Button>
      </CardFooter>
    </Card>
  );
}

function WebhookDeliveriesCard() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["platform", "integrations", "billing-webhooks"],
    queryFn: () => client.integrations.billingWebhooks(),
    refetchInterval: 15000,
  });
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Recent webhook deliveries</CardTitle>
          <Button size="sm" variant="outline" disabled={isFetching} onClick={() => void refetch()}>
            {isFetching ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
        <CardDescription>
          What Razorpay and Cashfree have sent us. A "Refused" row means the gateway is reaching us but its signature did not match the secret saved here. If nothing is listed after a payment, the webhook URL is not registered (or not subscribed to the subscription events) in the gateway dashboard.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? <MetricCardsSkeleton count={1} /> : null}
        {data && data.length === 0 ? <p className="text-sm text-muted-foreground">No webhooks received yet.</p> : null}
        {data && data.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Gateway</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="whitespace-nowrap text-xs">{new Date(d.updatedAt).toLocaleString()}</TableCell>
                  <TableCell className="capitalize">{d.gateway}</TableCell>
                  <TableCell className="text-xs">{d.eventType}</TableCell>
                  <TableCell>
                    {!d.signatureValid ? <Badge variant="destructive">Refused (secret mismatch){d.attempts > 1 ? ` x${d.attempts}` : ""}</Badge> : d.status === "processed" ? <Badge variant="secondary">Processed</Badge> : <Badge variant="destructive">{d.status}</Badge>}
                    {d.error && d.signatureValid ? <div className="mt-1 text-[11px] text-muted-foreground">{d.error}</div> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
    </Card>
  );
}

function InvoiceDetailsCard({ view, canEdit, onSaved }: { view: PlatformBillingSettingsView["invoice"]; canEdit: boolean; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({
    legalName: view.legalName ?? "",
    address: view.address ?? "",
    state: view.state ?? "",
    gstin: view.gstin ?? "",
    sac: view.sac ?? "",
    gstRatePercent: String(view.gstRateBps / 100),
  });
  const [saving, setSaving] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const percent = Number(form.gstRatePercent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 28) {
      toast.error("The tax rate is 0% to 28%");
      return;
    }
    setSaving(true);
    try {
      await client.integrations.updateBillingSettings({
        invoice: { legalName: form.legalName, address: form.address, state: form.state, gstin: form.gstin, sac: form.sac, gstRateBps: Math.round(percent * 100) },
      });
      toast.success("Invoice details saved");
      await onSaved();
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setSaving(false);
    }
  };

  const field = (id: keyof typeof form, label: string, hint?: string, placeholder?: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`inv-${id}`}>{label}</Label>
      <Input id={`inv-${id}`} value={form[id]} onChange={(e) => setForm({ ...form, [id]: e.target.value })} placeholder={placeholder} disabled={!canEdit} autoComplete="off" />
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );

  return (
    <Card>
      <form onSubmit={save}>
        <CardHeader>
          <CardTitle>Invoice details</CardTitle>
          <CardDescription>
            Printed on the GST tax invoice every merchant receives for a plan payment. The plan price is treated as inclusive of this tax. Have your accountant confirm the GSTIN, SAC and rate.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {field("legalName", "Legal name", undefined, "Brand Sewa Pvt Ltd")}
          {field("gstin", "GSTIN", "15 characters, for example 27AAAAA0000A1Z5")}
          <div className="sm:col-span-2">{field("address", "Registered address")}</div>
          {field("state", "State", "Decides CGST and SGST (same state as the merchant) or IGST", "Maharashtra")}
          {field("sac", "SAC", "Service accounting code, 4 to 8 digits")}
          {field("gstRatePercent", "GST rate (%)", "Usually 18")}
        </CardContent>
        <CardFooter>
          <Button type="submit" size="sm" disabled={!canEdit || saving}>
            {saving ? "Saving..." : "Save invoice details"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function rupees(paise: number): string {
  return formatMoney(paise, "INR");
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
  const [confirm, setConfirm] = useState<null | "enable" | "disable" | "live" | "test" | "cashfree" | "razorpay" | "paypal">(null);
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
        confirm === "enable"
          ? { enabled: true }
          : confirm === "disable"
            ? { enabled: false }
            : confirm === "live"
              ? { mode: "live" }
              : confirm === "cashfree" || confirm === "razorpay" || confirm === "paypal"
                ? { provider: confirm }
                : { mode: "test" },
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
        description="The payment gateway account Brand Sewa uses to charge merchants for their plan (Razorpay or Cashfree). This is separate from each store's own payment gateway. Start in test mode."
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
          <Card>
            <CardHeader>
              <CardTitle>Payment gateway</CardTitle>
              <CardDescription>
                The gateway used when a merchant subscribes from now on. Subscriptions already running stay on the gateway that created them, so switching never interrupts a paying store. Keys for both gateways can stay saved.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {(["razorpay", "cashfree", "paypal"] as const).map((p) => (
                <Button
                  key={p}
                  type="button"
                  size="sm"
                  variant={data.provider === p ? "default" : "outline"}
                  disabled={!canEdit || data.provider === p}
                  aria-pressed={data.provider === p}
                  onClick={() => setConfirm(p)}
                >
                  {p === "paypal" ? "PayPal" : p === "razorpay" ? "Razorpay" : "Cashfree"}
                  {data.provider === p ? " (active)" : ""}
                </Button>
              ))}
            </CardContent>
          </Card>
          <TrialCard key={`${data.trial.enabled}-${data.trial.days}-${data.updatedAt ?? ""}`} view={data.trial} canEdit={canEdit} onSaved={refresh} />
          {data.usingEnvFallback && data.provider === "razorpay" ? (
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

          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-foreground">Razorpay keys{data.provider === "razorpay" ? " (active gateway)" : ""}</h2>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <KeysCard mode="test" view={data.test} active={data.provider === "razorpay" && data.mode === "test"} canEdit={canEdit} onSaved={refresh} />
              <KeysCard mode="live" view={data.live} active={data.provider === "razorpay" && data.mode === "live"} canEdit={canEdit} onSaved={refresh} />
            </div>
          </div>

          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-foreground">Cashfree keys{data.provider === "cashfree" ? " (active gateway)" : ""}</h2>
            <p className="text-xs text-muted-foreground">Save and test the Cashfree keys here first, then choose Cashfree under Payment gateway above.</p>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <CashfreeKeysCard mode="test" view={data.cashfree.test} active={data.provider === "cashfree" && data.mode === "test"} canEdit={canEdit} onSaved={refresh} />
              <CashfreeKeysCard mode="live" view={data.cashfree.live} active={data.provider === "cashfree" && data.mode === "live"} canEdit={canEdit} onSaved={refresh} />
            </div>
          </div>

          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-foreground">PayPal credentials{data.provider === "paypal" ? " (active gateway)" : ""}</h2>
            <p className="text-xs text-muted-foreground">Used for stores outside India billing in USD (ADR-040 WP-5). Save credentials and webhook ID here.</p>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <PayPalKeysCard mode="test" view={data.paypal.test} active={data.provider === "paypal" && data.mode === "test"} canEdit={canEdit} onSaved={refresh} />
              <PayPalKeysCard mode="live" view={data.paypal.live} active={data.provider === "paypal" && data.mode === "live"} canEdit={canEdit} onSaved={refresh} />
            </div>
          </div>

          {data.provider === "cashfree" ? (
            <Card>
              <CardHeader>
                <CardTitle>Plans</CardTitle>
                <CardDescription>
                  Cashfree needs no plan sync: each subscription carries its own price from your plans, charged by Cashfree every month or year. Change a price under Plans and new subscriptions use it; current subscribers keep what they signed up for.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <PlansCard canEdit={canEdit} />
          )}

          <InvoiceDetailsCard key={data.updatedAt ?? "new"} view={data.invoice} canEdit={canEdit} onSaved={refresh} />

          <WebhookDeliveriesCard />

          <Card>
            <CardHeader>
              <CardTitle>Webhook URLs</CardTitle>
              <CardDescription>
                Register the matching URL in each gateway's dashboard, for the same mode as the keys. Razorpay: Account and settings, Webhooks, with the subscription and payment events and the secret you saved above. Cashfree: Developers, Webhooks, with the Subscription events; Cashfree signs them with your secret key.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {([["Razorpay", data.webhookUrl], ["Cashfree", data.cashfreeWebhookUrl], ["PayPal", data.paypalWebhookUrl]] as const).map(([label, url]) => (
                <div key={label} className="space-y-1">
                  <p className="text-xs font-medium text-foreground">{label}</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 truncate rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">{url}</code>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => {
                        void navigator.clipboard.writeText(url).then(() => toast.success("Webhook URL copied"));
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Copy
                    </Button>
                  </div>
                </div>
              ))}
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
          confirm === "enable"
            ? "Enable platform billing?"
            : confirm === "disable"
              ? "Disable platform billing?"
              : confirm === "live"
                ? "Switch to live mode?"
                : confirm === "cashfree" || confirm === "razorpay" || confirm === "paypal"
                  ? `Use ${confirm === "paypal" ? "PayPal" : confirm === "cashfree" ? "Cashfree" : "Razorpay"} for new subscriptions?`
                  : "Switch back to test mode?"
        }
        description={
          confirm === "enable"
            ? "Merchants will be able to subscribe and be charged with the active mode's keys."
            : confirm === "disable"
              ? "No new subscriptions or charges can be started. Existing subscriptions keep running on their gateway's side."
              : confirm === "live"
                ? "Merchants will be charged real money with the live keys. Make sure a full test-mode run has passed."
                : confirm === "cashfree" || confirm === "razorpay" || confirm === "paypal"
                  ? "New subscriptions will be created on this gateway. Subscriptions already running stay where they are. The gateway's keys for the active mode must be saved first."
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

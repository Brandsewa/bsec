import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Input,
  Label,
  MetricCardsSkeleton,
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
import { client } from "../../../lib/orpc.ts";
import { messageOf } from "../../../lib/errors.ts";

export const GATEWAY_NAME = { razorpay: "Razorpay", cashfree: "Cashfree", paypal: "PayPal" } as const;

export type Mode = "test" | "live";
export type KeySet = PlatformBillingSettingsView["test"];

interface KeyForm {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
}
const EMPTY: KeyForm = { keyId: "", keySecret: "", webhookSecret: "" };

export function KeysCard({
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

export function CashfreeKeysCard({
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

export function PayPalKeysCard({
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

export function TrialCard({ view, canEdit, onSaved }: { view: PlatformBillingSettingsView["trial"]; canEdit: boolean; onSaved: () => Promise<void> }) {
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

export function WebhookDeliveriesCard({ gateway }: { gateway: "razorpay" | "cashfree" | "paypal" }) {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["platform", "integrations", "billing-webhooks"],
    queryFn: () => client.integrations.billingWebhooks(),
    refetchInterval: 15000,
    select: (rows) => rows.filter((r) => r.gateway === gateway),
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
          What {GATEWAY_NAME[gateway]} has sent us. A "Refused" row means the gateway is reaching us but its signature did not match the secret saved here. If nothing is listed after a payment, the webhook URL is not registered (or not subscribed to the events) in the gateway dashboard.
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
                                <TableHead>Event</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="whitespace-nowrap text-xs">{new Date(d.updatedAt).toLocaleString()}</TableCell>
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

export function InvoiceDetailsCard({ view, canEdit, onSaved }: { view: PlatformBillingSettingsView["invoice"]; canEdit: boolean; onSaved: () => Promise<void> }) {
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

export function rupees(paise: number): string {
  return formatMoney(paise, "INR");
}

export function PlansCard({ canEdit }: { canEdit: boolean }) {
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

/** The webhook URL to register in one gateway's dashboard, with where to find the setting there. */
export function WebhookUrlCard({ gateway, url }: { gateway: keyof typeof GATEWAY_NAME; url: string }) {
  const steps: Record<keyof typeof GATEWAY_NAME, string> = {
    razorpay: "Razorpay dashboard, Account and settings, Webhooks. Add the URL with the subscription and payment events and the secret you saved under the keys.",
    cashfree: "Cashfree dashboard, Developers, Webhooks. Add the URL with the Subscription events. Cashfree signs them with your secret key, so there is no separate secret.",
    paypal: "PayPal Developer Dashboard, your app, Webhooks, Add Webhook. Subscribe to Checkout order approved, Payment capture completed and Payment capture declined, then save the Webhook ID it gives you under the credentials.",
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Webhook URL</CardTitle>
        <CardDescription>Register this URL in {GATEWAY_NAME[gateway]}, for the same mode as the keys. {steps[gateway]}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">{url}</code>
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
      </CardContent>
    </Card>
  );
}

/** Cashfree prices travel with each subscription, so there is nothing to sync. */
export function CashfreePlansCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Plans</CardTitle>
        <CardDescription>
          Cashfree needs no plan sync: each subscription carries its own price from your plans, charged by Cashfree every month or year. Change a price under Plans and new subscriptions use it; current subscribers keep what they signed up for.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

/** PayPal charges the USD price set on each plan (Plans, edit plan). A plan with no USD price falls back to its rupee price / 80. */
export function PayPalPlansCard() {
  const { data, isLoading } = useQuery({ queryKey: ["platform", "plans", "list"], queryFn: () => client.plans.list() });
  return (
    <Card>
      <CardHeader>
        <CardTitle>PayPal plans (USD)</CardTitle>
        <CardDescription>
          Stores outside India pay these USD prices. Set them in the plan editor under Plans. A plan with no USD price is charged at its rupee price divided by 80, shown as "estimated".
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
              {data.map((p) => {
                const cell = (usd: number | null | undefined, paise: number) =>
                  paise <= 0 && !usd ? (
                    <span className="text-muted-foreground">Free</span>
                  ) : usd != null ? (
                    formatMoney(usd, "USD")
                  ) : (
                    <span className="text-muted-foreground">{formatMoney(Math.round(paise / 80), "USD")} (estimated)</span>
                  );
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{cell(p.priceMonthlyUsdCents, p.priceMonthlyPaise)}</TableCell>
                    <TableCell>{cell(p.priceYearlyUsdCents, p.priceYearlyPaise)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
    </Card>
  );
}

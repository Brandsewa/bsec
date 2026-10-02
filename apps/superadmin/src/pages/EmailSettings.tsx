import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Mail, Send, CheckCircle2, XCircle, AlertTriangle, ShieldCheck } from "lucide-react";
import {
  Button,
  Input,
  PageContainer,
  PageHeader,
  PageSkeleton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@bs/ui";
import { client } from "../lib/orpc.ts";
import { messageOf } from "../lib/errors.ts";
import { useStaff, useHasRole } from "../lib/user-context.tsx";

export function EmailSettings() {
  const user = useStaff();
  const canEdit = useHasRole("platform_admin");

  const { data: settings, isLoading, refetch } = useQuery({
    queryKey: ["platform", "email", "settings"],
    queryFn: () => client.email.get(),
  });

  const { data: deliveries, refetch: refetchDeliveries } = useQuery({
    queryKey: ["platform", "email", "deliveries"],
    queryFn: () => client.email.recentDeliveries({ limit: 30 }),
  });

  const [form, setForm] = useState<{
    provider: string;
    host: string;
    port: number;
    secureMode: "starttls" | "ssl";
    username: string;
    password: string;
    fromEmail: string;
    fromName: string;
    replyTo: string;
    enabled: boolean;
  } | null>(null);

  const [testEmail, setTestEmail] = useState(user.email ?? "");
  const [sendingTest, setSendingTest] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failedOnly, setFailedOnly] = useState(false);

  // Sync state when data loads
  const current = form ?? (settings ? {
    provider: settings.provider,
    host: settings.host,
    port: settings.port,
    secureMode: settings.secureMode,
    username: settings.username,
    password: "", // write-only
    fromEmail: settings.fromEmail,
    fromName: settings.fromName,
    replyTo: settings.replyTo ?? "",
    enabled: settings.enabled,
  } : null);

  const applyZeptoMailPreset = () => {
    if (!current) return;
    setForm({
      ...current,
      provider: "zoho_zeptomail",
      host: "smtp.zeptomail.in",
      port: 587,
      secureMode: "starttls",
      username: "emailapikey",
    });
    toast.info("Applied Zoho ZeptoMail (India) preset");
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!current) return;
    setSaving(true);
    try {
      await client.email.update({
        provider: current.provider,
        host: current.host,
        port: Number(current.port),
        secureMode: current.secureMode,
        username: current.username,
        password: current.password.trim() || undefined,
        fromEmail: current.fromEmail,
        fromName: current.fromName,
        replyTo: current.replyTo.trim() || null,
        enabled: current.enabled,
      });
      toast.success("Email settings saved successfully");
      setForm(null);
      refetch();
    } catch (err) {
      toast.error(messageOf(err, "Failed to save email settings"));
    } finally {
      setSaving(false);
    }
  };

  const handleSendTest = async () => {
    if (!testEmail || !testEmail.includes("@")) {
      toast.error("Please enter a valid recipient email");
      return;
    }
    setSendingTest(true);
    try {
      const res = await client.email.sendTest({ toEmail: testEmail });
      if (res.ok) {
        toast.success("Test email delivered successfully!");
      } else {
        toast.error(`Test email failed: ${res.error ?? "Unknown error"}`);
      }
      refetch();
      refetchDeliveries();
    } catch (err) {
      toast.error(messageOf(err, "Failed to send test email"));
    } finally {
      setSendingTest(false);
    }
  };

  if (isLoading || !current) {
    return <PageSkeleton />;
  }

  const filteredDeliveries = deliveries
    ? failedOnly
      ? deliveries.filter((d) => d.status === "failed")
      : deliveries
    : [];

  return (
    <PageContainer>
      <PageHeader
        title="Platform Transactional Email"
        description="Configure platform-wide SMTP transactional email via Zoho ZeptoMail. All tenant order & auth emails go through this sender."
        aside={
          canEdit ? (
            <Button size="sm" onClick={applyZeptoMailPreset}>
              Preset: Zoho ZeptoMail (India)
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-xl border bg-card p-5 shadow-xs">
            <div className="flex items-center justify-between pb-3 border-b mb-4">
              <div>
                <h2 className="font-semibold text-base">SMTP Configuration</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Credentials are encrypted at rest with AES-256-GCM. The token/password is never exposed back to the client.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium cursor-pointer flex items-center gap-2">
                  <span>Enable Mailer</span>
                  <input
                    type="checkbox"
                    checked={current.enabled}
                    onChange={(e) => setForm({ ...current, enabled: e.target.checked })}
                    disabled={!canEdit}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                </label>
              </div>
            </div>

            <form onSubmit={handleSave} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="font-semibold block mb-1">Provider</label>
                  <Input
                    value={current.provider}
                    onChange={(e) => setForm({ ...current, provider: e.target.value })}
                    disabled={!canEdit}
                  />
                </div>
                <div>
                  <label className="font-semibold block mb-1">SMTP Host *</label>
                  <Input
                    value={current.host}
                    placeholder="smtp.zeptomail.in"
                    onChange={(e) => setForm({ ...current, host: e.target.value })}
                    disabled={!canEdit}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="font-semibold block mb-1">Port *</label>
                  <Input
                    type="number"
                    value={current.port}
                    onChange={(e) => setForm({ ...current, port: parseInt(e.target.value, 10) || 587 })}
                    disabled={!canEdit}
                    required
                  />
                </div>
                <div>
                  <label className="font-semibold block mb-1">Security Mode</label>
                  <Select
                    value={current.secureMode}
                    onValueChange={(val: "starttls" | "ssl") => setForm({ ...current, secureMode: val })}
                    disabled={!canEdit}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="starttls">STARTTLS (Port 587)</SelectItem>
                      <SelectItem value="ssl">SSL / TLS (Port 465)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="font-semibold block mb-1">SMTP Username *</label>
                  <Input
                    value={current.username}
                    placeholder="emailapikey"
                    onChange={(e) => setForm({ ...current, username: e.target.value })}
                    disabled={!canEdit}
                    required
                  />
                </div>
                <div>
                  <label className="font-semibold block mb-1">
                    Send Mail Token / Password{" "}
                    {settings?.passwordConfigured && (
                      <span className="text-emerald-600 dark:text-emerald-400 font-normal">
                        (Saved{settings.passwordLastFour ? ` ending in ····${settings.passwordLastFour}` : ""})
                      </span>
                    )}
                  </label>
                  <Input
                    type="password"
                    placeholder={settings?.passwordConfigured ? "Leave blank to keep saved token" : "Enter Send Mail Token"}
                    value={current.password}
                    onChange={(e) => setForm({ ...current, password: e.target.value })}
                    disabled={!canEdit}
                    autoComplete="new-password"
                  />
                </div>
              </div>

              <div className="border-t border-border pt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="font-semibold block mb-1">From Email (Verified) *</label>
                  <Input
                    value={current.fromEmail}
                    placeholder="no-reply@bcom.si"
                    onChange={(e) => setForm({ ...current, fromEmail: e.target.value })}
                    disabled={!canEdit}
                    required
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">Must be verified in ZeptoMail DNS</p>
                </div>
                <div>
                  <label className="font-semibold block mb-1">Default From Name *</label>
                  <Input
                    value={current.fromName}
                    placeholder="Brand Sewa"
                    onChange={(e) => setForm({ ...current, fromName: e.target.value })}
                    disabled={!canEdit}
                    required
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">Stores override with their own name</p>
                </div>
                <div>
                  <label className="font-semibold block mb-1">Default Reply-To</label>
                  <Input
                    value={current.replyTo}
                    placeholder="support@bcom.si"
                    onChange={(e) => setForm({ ...current, replyTo: e.target.value })}
                    disabled={!canEdit}
                  />
                </div>
              </div>

              {canEdit && (
                <div className="flex justify-end pt-3">
                  <Button type="submit" disabled={saving}>
                    {saving ? "Saving..." : "Save Settings"}
                  </Button>
                </div>
              )}
            </form>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border bg-card p-5 shadow-xs">
            <div className="flex items-center gap-2 mb-2">
              <Send className="h-4 w-4 text-primary" />
              <h2 className="font-semibold text-sm">Test Email Delivery</h2>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Send a real test email through Zoho ZeptoMail to verify DNS and SMTP authentication.
            </p>

            <div className="space-y-4 text-xs">
              <div>
                <label className="font-semibold block mb-1">Recipient Email</label>
                <Input
                  type="email"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder="your-email@example.com"
                  disabled={!canEdit || sendingTest}
                />
              </div>

              <Button
                className="w-full"
                onClick={handleSendTest}
                disabled={!canEdit || sendingTest || !current.enabled || !settings?.passwordConfigured}
              >
                {sendingTest ? "Sending Test Email..." : "Send Test Email"}
              </Button>

              {(!current.enabled || !settings?.passwordConfigured) && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Enable mailer and save token to test.
                </p>
              )}

              {settings?.lastTestAt && (
                <div className="border border-border rounded-md p-3 text-xs space-y-1 bg-muted/30">
                  <div className="flex items-center justify-between font-medium">
                    <span>Last Test:</span>
                    <span className="flex items-center gap-1">
                      {settings.lastTestStatus === "success" ? (
                        <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Passed
                        </span>
                      ) : (
                        <span className="text-destructive flex items-center gap-1">
                          <XCircle className="h-3.5 w-3.5" /> Failed
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="text-muted-foreground text-[11px]">
                    {new Date(settings.lastTestAt).toLocaleString()}
                  </div>
                  {settings.lastTestError && (
                    <div className="text-destructive text-[11px] font-mono break-all pt-1">
                      {settings.lastTestError}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border bg-card p-5 shadow-xs text-xs space-y-2">
            <div className="flex items-center gap-2 font-semibold">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <span>DNS Verification Checklist</span>
            </div>
            <p className="text-muted-foreground">
              For Zoho ZeptoMail to deliver emails from <strong>no-reply@bcom.si</strong> without rejection:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1">
              <li>SPF: TXT record with <code>include:zeptomail.net</code></li>
              <li>DKIM: CNAME/TXT key record from ZeptoMail console</li>
              <li>Bounce domain: CNAME record pointing to ZeptoMail</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="mt-8 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Mail className="h-4 w-4" />
            <span>Recent Deliveries</span>
          </h3>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFailedOnly(!failedOnly)}
            >
              {failedOnly ? "Showing Failed Only" : "Filter: All"}
            </Button>
            <Button size="sm" onClick={() => refetchDeliveries()}>
              Refresh
            </Button>
          </div>
        </div>

        <div className="rounded-xl border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Recipient</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Details / Message ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredDeliveries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-6 text-xs">
                    No delivery log entries found.
                  </TableCell>
                </TableRow>
              ) : (
                filteredDeliveries.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(item.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-xs font-medium">{item.toEmail}</TableCell>
                    <TableCell className="text-xs">
                      <span className="px-2 py-0.5 rounded-full bg-muted font-mono">{item.template}</span>
                    </TableCell>
                    <TableCell>
                      {item.status === "sent" ? (
                        <span className="inline-flex items-center text-xs font-medium text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Sent
                        </span>
                      ) : item.status === "skipped" ? (
                        <span className="inline-flex items-center text-xs font-medium text-amber-600 dark:text-amber-400">
                          <AlertTriangle className="h-3.5 w-3.5 mr-1" /> Skipped
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-xs font-medium text-destructive">
                          <XCircle className="h-3.5 w-3.5 mr-1" /> Failed
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono max-w-xs truncate">
                      {item.error ? (
                        <span className="text-destructive">{item.error}</span>
                      ) : (
                        item.providerMessageId ?? "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </PageContainer>
  );
}

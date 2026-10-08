import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowLeft,
  Eye,
  Info,
  Mail,
  MessageSquare,
  Phone,
  RefreshCw,
  Search,
  Send,
  Server,
  ShieldCheck,
} from "lucide-react";
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
  Input,
  Label,
  PageContainer,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@bs/ui";
import { client } from "../../lib/orpc.ts";
import { messageOf } from "../../lib/errors.ts";
import { useStaff, useHasRole } from "../../lib/user-context.tsx";
import type { ChannelTransactionEntry } from "@bs/contracts";

interface ChannelPageProps {
  channel: "email" | "sms" | "whatsapp";
}

const CHANNEL_METADATA = {
  email: {
    title: "Email Notifications",
    description: "Platform transactional email delivery via Zoho ZeptoMail and custom SMTP relays.",
    icon: Mail,
    helpText: "SMTP gives 'accepted by provider', not inbox delivery or opens. Bounce/complaint webhooks are a later phase.",
  },
  sms: {
    title: "SMS Notifications",
    description: "Transactional OTP and SMS messaging via Zoho CPaaS (India DC).",
    icon: Phone,
    helpText: "Zoho CPaaS SMS integration is set up but Not enrolled. Test send and Enable remain disabled until valid credentials exist. TRAI DLT registration is mandatory for Indian commercial SMS.",
  },
  whatsapp: {
    title: "WhatsApp Notifications",
    description: "Pre-approved template messaging via Meta WhatsApp Business API through Zoho CPaaS.",
    icon: MessageSquare,
    helpText: "Zoho CPaaS WhatsApp integration is set up but Not enrolled. Business-initiated messages require Meta pre-approved templates.",
  },
};

export function ChannelPage({ channel }: ChannelPageProps) {
  const navigate = useNavigate();
  const staff = useStaff();
  const canEdit = useHasRole("platform_admin");
  const meta = CHANNEL_METADATA[channel];
  const Icon = meta.icon;

  // Range for stats: 24h, 7d, 30d
  const [range, setRange] = useState<"24h" | "7d" | "30d">("7d");

  // Filters for transactions
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "sent" | "failed" | "skipped">("all");
  const [failedOnly, setFailedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // Selected transaction for drawer detail view
  const [selectedTx, setSelectedTx] = useState<ChannelTransactionEntry | null>(null);

  // Provider sheet state for Email
  const [providerSheetOpen, setProviderSheetOpen] = useState(false);
  const [activeProviderKey, setActiveProviderKey] = useState<string>("zoho_zeptomail");

  // 1. Fetch channel stats
  const { data: stats, refetch: refetchStats } = useQuery({
    queryKey: ["platform", "integrations", "channelStats", channel, range],
    queryFn: () => client.integrations.channelStats({ channel, range }),
  });

  // 2. Fetch channel transactions
  const {
    data: transactionsData,
    isLoading: txLoading,
    refetch: refetchTx,
  } = useQuery({
    queryKey: ["platform", "integrations", "channelTransactions", channel, statusFilter, failedOnly, search, page],
    queryFn: () =>
      client.integrations.channelTransactions({
        channel,
        status: statusFilter === "all" ? undefined : statusFilter,
        failedOnly: failedOnly ? true : undefined,
        search: search.trim() ? search.trim() : undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      }),
  });

  // 3. Email settings query (for provider cards)
  const { data: emailSettings, refetch: refetchEmailSettings } = useQuery({
    queryKey: ["platform", "email", "settings"],
    queryFn: () => client.email.get(),
    enabled: channel === "email",
  });

  // Form state for Email Settings Sheet
  const [formHost, setFormHost] = useState("");
  const [formPort, setFormPort] = useState(587);
  const [formSecureMode, setFormSecureMode] = useState<"starttls" | "ssl">("starttls");
  const [formUsername, setFormUsername] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formFromEmail, setFormFromEmail] = useState("");
  const [formFromName, setFormFromName] = useState("");
  const [formReplyTo, setFormReplyTo] = useState("");
  const [formEnabled, setFormEnabled] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);

  // Test Email in Sheet
  const [testRecipient, setTestRecipient] = useState(staff.email ?? "");
  const [sendingTestEmail, setSendingTestEmail] = useState(false);

  const openEmailProviderSheet = (preset: "zoho_zeptomail" | "custom_smtp") => {
    setActiveProviderKey(preset);
    if (preset === "zoho_zeptomail") {
      setFormHost(emailSettings?.host || "smtp.zeptomail.in");
      setFormPort(emailSettings?.port || 587);
      setFormSecureMode(emailSettings?.secureMode || "starttls");
      setFormUsername(emailSettings?.username || "emailapikey");
      setFormPassword("");
      setFormFromEmail(emailSettings?.fromEmail || "no-reply@bcom.si");
      setFormFromName(emailSettings?.fromName || "Brand Sewa");
      setFormReplyTo(emailSettings?.replyTo || "");
      setFormEnabled(emailSettings?.enabled ?? false);
    } else {
      setFormHost(emailSettings?.host || "");
      setFormPort(emailSettings?.port || 587);
      setFormSecureMode(emailSettings?.secureMode || "starttls");
      setFormUsername(emailSettings?.username || "");
      setFormPassword("");
      setFormFromEmail(emailSettings?.fromEmail || "no-reply@bcom.si");
      setFormFromName(emailSettings?.fromName || "Brand Sewa");
      setFormReplyTo(emailSettings?.replyTo || "");
      setFormEnabled(emailSettings?.enabled ?? false);
    }
    setProviderSheetOpen(true);
  };

  const handleSaveEmailSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingEmail(true);
    try {
      await client.email.update({
        provider: activeProviderKey,
        host: formHost,
        port: Number(formPort),
        secureMode: formSecureMode,
        username: formUsername,
        password: formPassword.trim() || undefined,
        fromEmail: formFromEmail,
        fromName: formFromName,
        replyTo: formReplyTo.trim() || null,
        enabled: formEnabled,
      });
      toast.success("Email provider settings saved");
      setProviderSheetOpen(false);
      refetchEmailSettings();
      refetchStats();
    } catch (err) {
      toast.error(messageOf(err, "Failed to save email settings"));
    } finally {
      setSavingEmail(false);
    }
  };

  const handleSendTestEmail = async () => {
    if (!testRecipient || !testRecipient.includes("@")) {
      toast.error("Please enter a valid recipient email address");
      return;
    }
    setSendingTestEmail(true);
    try {
      const res = await client.email.sendTest({ toEmail: testRecipient });
      if (res.ok) {
        toast.success("Test email accepted by SMTP server!");
      } else {
        toast.error(`SMTP delivery failed: ${res.error ?? "Unknown error"}`);
      }
      refetchEmailSettings();
      refetchStats();
      refetchTx();
    } catch (err) {
      toast.error(messageOf(err, "Failed to send test email"));
    } finally {
      setSendingTestEmail(false);
    }
  };

  const transactions = transactionsData?.items ?? [];
  const totalTransactions = transactionsData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalTransactions / pageSize));

  // Determine channel status badge
  let channelBadgeVariant: "default" | "secondary" | "destructive" | "outline" = "secondary";
  let channelBadgeText = "Not configured";

  if (channel === "email") {
    if (emailSettings?.enabled) {
      if (emailSettings.lastTestStatus === "failed") {
        channelBadgeVariant = "destructive";
        channelBadgeText = "Failing";
      } else {
        channelBadgeVariant = "default";
        channelBadgeText = "Active";
      }
    }
  } else {
    channelBadgeVariant = "outline";
    channelBadgeText = "Not enrolled";
  }

  return (
    <PageContainer>
      {/* Top back navigation */}
      <div className="mb-4">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground hover:text-foreground"
          onClick={() => navigate({ to: "/integrations/notifications" })}
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Notifications</span>
        </Button>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <Icon className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">{meta.title}</h1>
            <Badge variant={channelBadgeVariant}>{channelBadgeText}</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{meta.description}</p>
        </div>
      </div>

      {/* STATS ROW */}
      <div className="space-y-4 mb-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">Delivery Statistics</h2>
          <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-xs">
            {(["24h", "7d", "30d"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`px-3 py-1 rounded-md font-medium transition-colors ${
                  range === r
                    ? "bg-background text-foreground shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {r === "24h" ? "Last 24 Hours" : r === "7d" ? "Last 7 Days" : "Last 30 Days"}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <Card className="p-4">
            <div className="text-xs font-medium text-muted-foreground">Sent</div>
            <div className="text-2xl font-bold mt-1 text-emerald-600 dark:text-emerald-400">
              {stats?.sent.toLocaleString() ?? 0}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs font-medium text-muted-foreground">Failed</div>
            <div className={`text-2xl font-bold mt-1 ${(stats?.failed ?? 0) > 0 ? "text-destructive" : ""}`}>
              {stats?.failed.toLocaleString() ?? 0}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs font-medium text-muted-foreground">Skipped</div>
            <div className="text-2xl font-bold mt-1 text-muted-foreground">
              {stats?.skipped.toLocaleString() ?? 0}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs font-medium text-muted-foreground">Success Rate</div>
            <div className="text-2xl font-bold mt-1">
              {stats?.successRate ?? 100}%
            </div>
          </Card>
          <Card className="p-4 col-span-2 sm:col-span-1">
            <div className="text-xs font-medium text-muted-foreground">Total Messages</div>
            <div className="text-2xl font-bold mt-1">
              {stats?.total.toLocaleString() ?? 0}
            </div>
          </Card>
        </div>

        {/* Small daily breakdown visualizer */}
        {stats?.daily && stats.daily.length > 0 && (
          <Card className="p-4">
            <div className="text-xs font-medium text-muted-foreground mb-3 flex items-center justify-between">
              <span>Daily Message Volume ({stats.daily.length} days)</span>
              <div className="flex items-center gap-3 text-[11px]">
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-full bg-emerald-500 inline-block" /> Sent
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-full bg-destructive inline-block" /> Failed
                </span>
              </div>
            </div>
            <div className="flex items-end gap-1 h-14 w-full pt-1">
              {stats.daily.map((d) => {
                const totalDay = d.sent + d.failed + d.skipped;
                const maxInPeriod = Math.max(...stats.daily.map((x) => x.sent + x.failed + x.skipped), 1);
                const heightPct = Math.max(8, Math.round((totalDay / maxInPeriod) * 100));
                return (
                  <div
                    key={d.date}
                    className="flex-1 flex flex-col justify-end items-center h-full group relative"
                  >
                    <div
                      style={{ height: `${heightPct}%` }}
                      className={`w-full rounded-xs transition-all ${
                        d.failed > 0 ? "bg-amber-500 hover:bg-amber-600" : totalDay > 0 ? "bg-emerald-500 hover:bg-emerald-600" : "bg-muted"
                      }`}
                    />
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute bottom-full mb-1 z-20 pointer-events-none bg-popover text-popover-foreground text-[10px] rounded border border-border px-1.5 py-0.5 whitespace-nowrap shadow-sm">
                      {d.date}: {d.sent} sent, {d.failed} failed
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* Help text notice */}
        <Alert className="border-border/60 bg-muted/30">
          <Info className="h-4 w-4 text-muted-foreground" />
          <AlertTitle className="text-xs font-semibold">Delivery Guarantee & Architecture</AlertTitle>
          <AlertDescription className="text-xs text-muted-foreground">
            {meta.helpText}
          </AlertDescription>
        </Alert>
      </div>

      {/* TABS: [Transactions] [Providers] */}
      <Tabs defaultValue="transactions" className="w-full flex flex-col">
        <TabsList className="mb-4">
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="providers">Providers</TabsTrigger>
        </TabsList>

        {/* TAB 1: TRANSACTIONS */}
        <TabsContent value="transactions" className="space-y-4">
          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="flex flex-1 items-center gap-2">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Filter by recipient or template..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  className="pl-8 text-xs h-9"
                />
              </div>

              <Select
                value={statusFilter}
                onValueChange={(val: "all" | "sent" | "failed" | "skipped") => {
                  setStatusFilter(val);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-32 h-9 text-xs">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="skipped">Skipped</SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant={failedOnly ? "destructive" : "outline"}
                size="sm"
                onClick={() => {
                  setFailedOnly(!failedOnly);
                  setPage(1);
                }}
                className="h-9 text-xs"
              >
                Failed only
              </Button>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                refetchTx();
                refetchStats();
              }}
              className="h-9 text-xs gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Refresh</span>
            </Button>
          </div>

          {/* Transactions Table */}
          <div className="rounded-md border border-border overflow-hidden bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-40">Time</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Template</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {txLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                      Loading delivery records...
                    </TableCell>
                  </TableRow>
                ) : transactions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                      No transactional logs found for this filter.
                    </TableCell>
                  </TableRow>
                ) : (
                  transactions.map((tx) => (
                    <TableRow
                      key={tx.id}
                      className="cursor-pointer hover:bg-muted/40 transition-colors"
                      onClick={() => setSelectedTx(tx)}
                    >
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(tx.createdAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </TableCell>
                      <TableCell className="text-xs font-mono font-medium">
                        {tx.recipient}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[11px]">
                          {tx.template}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {tx.tenantId ? (
                          <span
                            className="text-primary hover:underline"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate({ to: `/tenants/${tx.tenantId}` });
                            }}
                          >
                            {tx.tenantName ?? tx.tenantId.slice(0, 8)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Platform</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {tx.provider ?? "Default"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            tx.status === "sent"
                              ? "default"
                              : tx.status === "failed"
                                ? "destructive"
                                : "secondary"
                          }
                          className="text-[11px]"
                        >
                          {tx.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedTx(tx);
                          }}
                        >
                          <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-xs text-muted-foreground pt-2">
              <div>
                Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, totalTransactions)} of{" "}
                {totalTransactions} records
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                  className="h-8 px-2.5"
                >
                  Previous
                </Button>
                <span className="px-2">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage(page + 1)}
                  className="h-8 px-2.5"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* TAB 2: PROVIDERS */}
        <TabsContent value="providers" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {channel === "email" ? (
              <>
                {/* Provider Card 1: Zoho ZeptoMail */}
                <Card className="hover:border-primary/40 transition-colors">
                  <CardHeader>
                    <div className="flex items-center justify-between mb-1">
                      <div className="p-2 rounded-lg bg-primary/10 text-primary">
                        <Mail className="h-5 w-5" />
                      </div>
                      <div className="flex items-center gap-2">
                        {emailSettings?.provider === "zoho_zeptomail" && emailSettings.enabled && (
                          <Badge variant="outline" className="text-primary border-primary/30">
                            Default
                          </Badge>
                        )}
                        <Badge
                          variant={
                            emailSettings?.provider === "zoho_zeptomail" && emailSettings.enabled
                              ? emailSettings.lastTestStatus === "failed"
                                ? "destructive"
                                : "default"
                              : "secondary"
                          }
                        >
                          {emailSettings?.provider === "zoho_zeptomail" && emailSettings.enabled
                            ? emailSettings.lastTestStatus === "failed"
                              ? "Failing"
                              : "Active"
                            : "Not configured"}
                        </Badge>
                      </div>
                    </div>
                    <CardTitle className="text-lg">Zoho ZeptoMail</CardTitle>
                    <CardDescription>
                      Dedicated transactional email delivery via Zoho ZeptoMail (smtp.zeptomail.in).
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Server Endpoint:</span>
                      <span className="font-mono text-foreground">smtp.zeptomail.in:587</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Encryption:</span>
                      <span className="text-foreground">STARTTLS</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Last Test:</span>
                      <span className="text-foreground">
                        {emailSettings?.lastTestAt
                          ? `${emailSettings.lastTestStatus === "success" ? "Passed" : "Failed"} (${new Date(
                              emailSettings.lastTestAt,
                            ).toLocaleDateString()})`
                          : "Never tested"}
                      </span>
                    </div>
                  </CardContent>
                  <CardFooter>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => openEmailProviderSheet("zoho_zeptomail")}
                    >
                      Configure ZeptoMail
                    </Button>
                  </CardFooter>
                </Card>

                {/* Provider Card 2: Custom SMTP */}
                <Card className="hover:border-primary/40 transition-colors">
                  <CardHeader>
                    <div className="flex items-center justify-between mb-1">
                      <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500">
                        <Server className="h-5 w-5" />
                      </div>
                      <div className="flex items-center gap-2">
                        {emailSettings?.provider === "custom_smtp" && emailSettings.enabled && (
                          <Badge variant="outline" className="text-primary border-primary/30">
                            Default
                          </Badge>
                        )}
                        <Badge
                          variant={
                            emailSettings?.provider === "custom_smtp" && emailSettings.enabled
                              ? emailSettings.lastTestStatus === "failed"
                                ? "destructive"
                                : "default"
                              : "secondary"
                          }
                        >
                          {emailSettings?.provider === "custom_smtp" && emailSettings.enabled
                            ? "Active"
                            : "Not configured"}
                        </Badge>
                      </div>
                    </div>
                    <CardTitle className="text-lg">Custom SMTP</CardTitle>
                    <CardDescription>
                      Use any custom SMTP relay (AWS SES, SendGrid, Postmark, Mailgun) with STARTTLS or SSL.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Server Endpoint:</span>
                      <span className="font-mono text-foreground">
                        {emailSettings?.provider === "custom_smtp" ? emailSettings.host : "Custom host"}
                      </span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Encryption:</span>
                      <span className="text-foreground">STARTTLS / SSL</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Last Test:</span>
                      <span className="text-foreground">
                        {emailSettings?.provider === "custom_smtp" && emailSettings.lastTestAt
                          ? "Tested"
                          : "Untested"}
                      </span>
                    </div>
                  </CardContent>
                  <CardFooter>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => openEmailProviderSheet("custom_smtp")}
                    >
                      Configure Custom SMTP
                    </Button>
                  </CardFooter>
                </Card>
              </>
            ) : channel === "sms" ? (
              <Card className="hover:border-primary/40 transition-colors col-span-2 max-w-xl">
                <CardHeader>
                  <div className="flex items-center justify-between mb-1">
                    <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500">
                      <Phone className="h-5 w-5" />
                    </div>
                    <Badge variant="outline" className="text-amber-600 border-amber-500/30">
                      Not enrolled
                    </Badge>
                  </div>
                  <CardTitle className="text-lg">Zoho CPaaS (SMS)</CardTitle>
                  <CardDescription>
                    Transactional SMS API through Zoho CPaaS console (India DC).
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  <div className="p-3 rounded-md bg-muted/40 border border-border/60 text-muted-foreground">
                    <p className="font-medium text-foreground mb-1">Enrolment Status</p>
                    <p>
                      Zoho CPaaS account is not yet enrolled. Credentials, DLT entity registration, and sender headers
                      are required before enabling this gateway.
                    </p>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button variant="outline" disabled className="w-full">
                    Enable & Test Send (Enrolment Required)
                  </Button>
                </CardFooter>
              </Card>
            ) : (
              <Card className="hover:border-primary/40 transition-colors col-span-2 max-w-xl">
                <CardHeader>
                  <div className="flex items-center justify-between mb-1">
                    <div className="p-2 rounded-lg bg-green-500/10 text-green-500">
                      <MessageSquare className="h-5 w-5" />
                    </div>
                    <Badge variant="outline" className="text-amber-600 border-amber-500/30">
                      Not enrolled
                    </Badge>
                  </div>
                  <CardTitle className="text-lg">Zoho CPaaS (WhatsApp)</CardTitle>
                  <CardDescription>
                    WhatsApp Business API template messaging through Zoho CPaaS.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  <div className="p-3 rounded-md bg-muted/40 border border-border/60 text-muted-foreground">
                    <p className="font-medium text-foreground mb-1">Enrolment Status</p>
                    <p>
                      WhatsApp Business Account (WABA) not enrolled. Business-initiated messages require Meta-approved
                      template mapping.
                    </p>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button variant="outline" disabled className="w-full">
                    Enable & Test Send (Enrolment Required)
                  </Button>
                </CardFooter>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* DETAIL DRAWER / SHEET FOR TRANSACTIONS */}
      <Sheet open={Boolean(selectedTx)} onOpenChange={(open) => !open && setSelectedTx(null)}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="text-lg font-bold">Delivery Log Detail</SheetTitle>
            <SheetDescription className="text-xs">
              Diagnostics and audit metadata. Message bodies and OTPs are never stored or logged.
            </SheetDescription>
          </SheetHeader>

          {selectedTx && (
            <div className="space-y-4 py-4 text-xs">
              <div className="rounded-md border border-border p-3 space-y-2 bg-muted/20">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Message ID:</span>
                  <span className="font-mono font-medium">{selectedTx.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Timestamp:</span>
                  <span>{new Date(selectedTx.createdAt).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Recipient:</span>
                  <span className="font-mono font-semibold">{selectedTx.recipient}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Template:</span>
                  <Badge variant="outline">{selectedTx.template}</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tenant / Store:</span>
                  <span>{selectedTx.tenantName ?? selectedTx.tenantId ?? "Platform"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Delivery Status:</span>
                  <Badge
                    variant={
                      selectedTx.status === "sent"
                        ? "default"
                        : selectedTx.status === "failed"
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {selectedTx.status}
                  </Badge>
                </div>
                {selectedTx.providerMessageId && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Provider Message ID:</span>
                    <span className="font-mono text-[11px] truncate max-w-[200px]">
                      {selectedTx.providerMessageId}
                    </span>
                  </div>
                )}
              </div>

              {selectedTx.error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 space-y-1">
                  <span className="font-semibold text-destructive flex items-center gap-1.5">
                    <AlertTriangle className="h-4 w-4" /> Provider Error Details
                  </span>
                  <p className="font-mono text-[11px] text-destructive/90 break-words mt-1">
                    {selectedTx.error}
                  </p>
                </div>
              )}

              <div className="rounded-md border border-border/60 bg-muted/30 p-2.5 text-[11px] text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 inline mr-1 text-primary" />
                Zero-retention policy: Content payloads, OTP tokens, and personal credentials are never captured in
                diagnostic tables.
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* PROVIDER SETTINGS SHEET FOR EMAIL */}
      <Sheet open={providerSheetOpen} onOpenChange={setProviderSheetOpen}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {activeProviderKey === "zoho_zeptomail" ? "Configure Zoho ZeptoMail" : "Configure Custom SMTP"}
            </SheetTitle>
            <SheetDescription className="text-xs">
              Platform-wide transactional SMTP settings. Passwords are encrypted at rest using AES-256-GCM.
            </SheetDescription>
          </SheetHeader>

          <form onSubmit={handleSaveEmailSettings} className="space-y-4 py-4 text-xs">
            <div className="space-y-1.5">
              <Label htmlFor="smtp-host">SMTP Host</Label>
              <Input
                id="smtp-host"
                value={formHost}
                onChange={(e) => setFormHost(e.target.value)}
                placeholder="e.g. smtp.zeptomail.in"
                required
                disabled={!canEdit}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="smtp-port">Port</Label>
                <Input
                  id="smtp-port"
                  type="number"
                  value={formPort}
                  onChange={(e) => setFormPort(Number(e.target.value))}
                  required
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="smtp-sec">Security</Label>
                <Select
                  value={formSecureMode}
                  onValueChange={(val: "starttls" | "ssl") => setFormSecureMode(val)}
                  disabled={!canEdit}
                >
                  <SelectTrigger id="smtp-sec">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="starttls">STARTTLS</SelectItem>
                    <SelectItem value="ssl">SSL / TLS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="smtp-user">Username</Label>
              <Input
                id="smtp-user"
                value={formUsername}
                onChange={(e) => setFormUsername(e.target.value)}
                placeholder="e.g. emailapikey"
                required
                disabled={!canEdit}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="smtp-pass">
                Password / API Key {emailSettings?.passwordConfigured && "(leave blank to keep existing)"}
              </Label>
              <Input
                id="smtp-pass"
                type="password"
                value={formPassword}
                onChange={(e) => setFormPassword(e.target.value)}
                placeholder={emailSettings?.passwordConfigured ? "••••••••••••••••" : "Enter SMTP password"}
                disabled={!canEdit}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="from-email">Sender Email</Label>
                <Input
                  id="from-email"
                  type="email"
                  value={formFromEmail}
                  onChange={(e) => setFormFromEmail(e.target.value)}
                  placeholder="no-reply@bcom.si"
                  required
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="from-name">Sender Name</Label>
                <Input
                  id="from-name"
                  value={formFromName}
                  onChange={(e) => setFormFromName(e.target.value)}
                  placeholder="Brand Sewa"
                  required
                  disabled={!canEdit}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reply-to">Reply-To Email (Optional)</Label>
              <Input
                id="reply-to"
                type="email"
                value={formReplyTo}
                onChange={(e) => setFormReplyTo(e.target.value)}
                placeholder="support@bcom.si"
                disabled={!canEdit}
              />
            </div>

            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="email-enabled" className="text-xs font-semibold">Enable Provider</Label>
                <p className="text-[11px] text-muted-foreground">
                  When enabled, all transactional emails will be routed through this configuration.
                </p>
              </div>
              <Switch
                id="email-enabled"
                checked={formEnabled}
                onCheckedChange={setFormEnabled}
                disabled={!canEdit}
              />
            </div>

            <SheetFooter className="pt-2">
              <Button type="submit" disabled={!canEdit || savingEmail} className="w-full">
                {savingEmail ? "Saving..." : "Save Settings"}
              </Button>
            </SheetFooter>
          </form>

          {/* Test send strip */}
          <div className="border-t border-border pt-4 mt-2 space-y-2 text-xs">
            <h4 className="font-semibold text-foreground">Test Email Delivery</h4>
            <p className="text-[11px] text-muted-foreground">
              Sends a real transactional probe email to verify SMTP handshake and sender verification.
            </p>
            <div className="flex gap-2">
              <Input
                type="email"
                value={testRecipient}
                onChange={(e) => setTestRecipient(e.target.value)}
                placeholder="test@example.com"
                className="text-xs h-9"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleSendTestEmail}
                disabled={sendingTestEmail || !canEdit}
                className="h-9 gap-1"
              >
                <Send className="h-3.5 w-3.5" />
                <span>{sendingTestEmail ? "Sending..." : "Test"}</span>
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </PageContainer>
  );
}

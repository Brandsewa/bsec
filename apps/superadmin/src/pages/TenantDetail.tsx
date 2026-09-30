import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "@tanstack/react-router";
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  Archive,
  ArrowLeft,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Globe,
  Headphones,
  Mail,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Trash2,
  UserCheck,
  Users,
} from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  PageBreadcrumbs,
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

export function TenantDetail() {
  const { id } = useParams({ strict: false }) as { id: string };

  const [activeTab, setActiveTab] = useState<
    "overview" | "domains" | "members" | "billing" | "usage" | "health" | "audit" | "notes"
  >("overview");

  // Dialog states
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");

  const [extendTrialOpen, setExtendTrialOpen] = useState(false);
  const [trialDays, setTrialDays] = useState(14);

  const [supportSessionOpen, setSupportSessionOpen] = useState(false);
  const [supportReason, setSupportReason] = useState("");
  const [supportTicketRef, setSupportTicketRef] = useState("");
  const [supportScope, setSupportScope] = useState<"read_only" | "write">("read_only");
  const [supportConsent, setSupportConsent] = useState<"owner_approved" | "standing_consent" | "emergency">("owner_approved");

  const [deletionOpen, setDeletionOpen] = useState(false);
  const [deletionConfirmText, setDeletionConfirmText] = useState("");
  const [deletionReason, setDeletionReason] = useState("");
  const [deletionGraceDays, setDeletionGraceDays] = useState(7);

  const [newNote, setNewNote] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const { data: detail, isLoading, refetch } = useQuery({
    queryKey: ["platform", "tenants", id, "detail"],
    queryFn: () => client.tenants.getDetail({ id }),
    enabled: Boolean(id),
  });

  if (isLoading || !detail) return <PageSkeleton />;

  const tenant = detail.overview;

  const handleSuspend = async () => {
    if (!suspendReason.trim()) {
      toast.error("Suspension reason is required");
      return;
    }
    setActionLoading(true);
    try {
      await client.tenants.suspend({ id: tenant.id, reason: suspendReason });
      toast.success("Store suspended");
      setSuspendOpen(false);
      refetch();
    } catch (err: any) {
      toast.error(err?.message || "Failed to suspend store");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRestore = async () => {
    setActionLoading(true);
    try {
      await client.tenants.restore({ id: tenant.id });
      toast.success("Store restored to active status");
      refetch();
    } catch (err: any) {
      toast.error(err?.message || "Failed to restore store");
    } finally {
      setActionLoading(false);
    }
  };

  const handleExtendTrial = async () => {
    setActionLoading(true);
    try {
      const res = await client.tenants.extendTrial({ id: tenant.id, additionalDays: trialDays });
      toast.success(`Trial extended until ${new Date(res.trialEndsAt).toLocaleDateString("en-IN")}`);
      setExtendTrialOpen(false);
      refetch();
    } catch (err: any) {
      toast.error(err?.message || "Failed to extend trial");
    } finally {
      setActionLoading(false);
    }
  };

  const handleStartSupport = async () => {
    if (!supportReason.trim() || !supportTicketRef.trim()) {
      toast.error("Reason and Ticket Reference are mandatory");
      return;
    }
    setActionLoading(true);
    try {
      const res = await client.support.start({
        tenantId: tenant.id,
        reason: supportReason,
        ticketRef: supportTicketRef,
        scope: supportScope,
        consent: supportConsent,
      });
      toast.success(`Support session started. Expires at ${new Date(res.expiresAt).toLocaleTimeString()}`);
      setSupportSessionOpen(false);
      refetch();
    } catch (err: any) {
      toast.error(err?.message || "Failed to initiate support session");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRunExport = async () => {
    setActionLoading(true);
    try {
      const res = await client.tenants.export({ id: tenant.id });
      toast.success("Full store export generated!");
      if (res.downloadUrl) {
        window.open(res.downloadUrl, "_blank");
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to trigger store export");
    } finally {
      setActionLoading(false);
    }
  };

  const handleScheduleDeletion = async () => {
    if (deletionConfirmText !== `DELETE ${tenant.slug}`) {
      toast.error(`Please type exact confirmation: DELETE ${tenant.slug}`);
      return;
    }
    setActionLoading(true);
    try {
      const res = await client.tenants.requestDeletion({
        id: tenant.id,
        reason: deletionReason || undefined,
        graceDays: deletionGraceDays,
      });
      toast.success(`Tenant deletion scheduled for ${new Date(res.scheduledFor).toLocaleDateString()}`);
      setDeletionOpen(false);
      refetch();
    } catch (err: any) {
      toast.error(err?.message || "Failed to schedule deletion");
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim()) return;
    setActionLoading(true);
    try {
      await client.tenants.addNote({ id: tenant.id, body: newNote.trim() });
      toast.success("Internal note recorded");
      setNewNote("");
      refetch();
    } catch (err: any) {
      toast.error(err?.message || "Failed to save note");
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <PageContainer>
      <PageBreadcrumbs
        items={[
          { label: "Tenants", href: "/tenants" },
          { label: tenant.name },
        ]}
      />

      <PageHeader
        title={tenant.name}
        description={`Tenant ID: ${tenant.id} · Subdomain: ${tenant.slug}.gobs.cloud`}
        meta={
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider bg-primary/10 text-primary">
            {tenant.status}
          </span>
        }
        aside={
          <div className="flex flex-wrap items-center gap-2">
            {tenant.status === "suspended" ? (
              <Button size="sm" variant="default" onClick={handleRestore} disabled={actionLoading}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Restore Store
              </Button>
            ) : (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setSuspendOpen(true)}
                disabled={actionLoading}
              >
                <ShieldAlert className="mr-1.5 h-3.5 w-3.5" /> Suspend
              </Button>
            )}

            {tenant.status === "trial" && (
              <Button size="sm" variant="default" onClick={() => setExtendTrialOpen(true)}>
                <Calendar className="mr-1.5 h-3.5 w-3.5" /> Extend Trial
              </Button>
            )}

            <Button size="sm" variant="default" onClick={() => setSupportSessionOpen(true)}>
              <Headphones className="mr-1.5 h-3.5 w-3.5" /> Support Session
            </Button>

            <Button size="sm" variant="default" onClick={handleRunExport} disabled={actionLoading}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> Export Data
            </Button>

            <Button
              size="sm"
              variant="destructive"
              onClick={() => setDeletionOpen(true)}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
            </Button>
          </div>
        }
      />

      {/* Tabs Bar */}
      <div className="flex items-center gap-1 border-b mb-6 overflow-x-auto">
        {(
          [
            { id: "overview", label: "Overview", icon: Building2 },
            { id: "domains", label: `Domains (${detail.domains.length})`, icon: Globe },
            { id: "members", label: `Members (${detail.members.length})`, icon: Users },
            { id: "billing", label: "Billing & Invoices", icon: CreditCard },
            { id: "usage", label: "Usage", icon: Activity },
            { id: "health", label: `Health (${detail.health.failedWebhooksCount})`, icon: AlertTriangle },
            { id: "audit", label: `Audit Log (${detail.audit.length})`, icon: FileSpreadsheet },
            { id: "notes", label: `Notes (${detail.notes.length})`, icon: Clock },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium border-b-2 whitespace-nowrap transition-colors ${
                isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Contents */}
      {activeTab === "overview" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="rounded-xl border bg-card p-5 shadow-xs space-y-4">
            <h3 className="font-semibold text-sm">Store Configuration</h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b">
                <span className="text-muted-foreground">Store Name:</span>
                <span className="font-medium">{tenant.name}</span>
              </div>
              <div className="flex justify-between py-1 border-b">
                <span className="text-muted-foreground">Subdomain:</span>
                <span className="font-mono">{tenant.slug}.gobs.cloud</span>
              </div>
              <div className="flex justify-between py-1 border-b">
                <span className="text-muted-foreground">Lifecycle State:</span>
                <span className="font-semibold capitalize">{tenant.status}</span>
              </div>
              <div className="flex justify-between py-1 border-b">
                <span className="text-muted-foreground">Created Date:</span>
                <span>{tenant.createdAt ? new Date(tenant.createdAt).toLocaleString("en-IN") : "—"}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground">Trial Expiration:</span>
                <span>{tenant.trialEndsAt ? new Date(tenant.trialEndsAt).toLocaleDateString("en-IN") : "No active trial"}</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border bg-card p-5 shadow-xs space-y-4">
            <h3 className="font-semibold text-sm">Store Usage & Volume</h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b">
                <span className="text-muted-foreground">Active Products:</span>
                <span>{detail.usage.productsCount} items</span>
              </div>
              <div className="flex justify-between py-1 border-b">
                <span className="text-muted-foreground">Total Orders Placed:</span>
                <span>{detail.usage.ordersCount} orders</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground">Gross Merchandise Volume:</span>
                <span className="font-semibold">₹{(detail.usage.gmvPaise / 100).toLocaleString("en-IN")}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "domains" && (
        <div className="rounded-xl border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Hostname</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Primary</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>SSL Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.domains.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-6 text-xs text-muted-foreground">
                    No custom domains mapped yet.
                  </TableCell>
                </TableRow>
              ) : (
                detail.domains.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-mono text-xs font-medium">{d.hostname}</TableCell>
                    <TableCell className="text-xs">{d.type}</TableCell>
                    <TableCell className="text-xs">{d.isPrimary ? "Yes" : "No"}</TableCell>
                    <TableCell className="text-xs capitalize">{d.status}</TableCell>
                    <TableCell className="text-xs capitalize">{d.sslStatus || "pending"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {activeTab === "members" && (
        <div className="rounded-xl border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.members.map((m) => (
                <TableRow key={m.userId}>
                  <TableCell className="font-medium text-xs">{m.name || "—"}</TableCell>
                  <TableCell className="text-xs">{m.email}</TableCell>
                  <TableCell className="text-xs capitalize font-semibold">{m.role}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {m.createdAt ? new Date(m.createdAt).toLocaleDateString("en-IN") : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {activeTab === "billing" && (
        <div className="space-y-6">
          <div className="rounded-xl border bg-card p-5">
            <h3 className="font-semibold text-sm mb-3">Subscription Details</h3>
            {detail.billing.subscription ? (
              <div className="text-xs space-y-1">
                <p>Status: <strong className="capitalize">{detail.billing.subscription.status}</strong></p>
                <p>Billing Interval: <strong className="capitalize">{detail.billing.subscription.interval}</strong></p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No active paid subscription attached.</p>
            )}
          </div>

          <div className="rounded-xl border bg-card overflow-hidden">
            <div className="p-4 border-b">
              <h3 className="font-semibold text-sm">Issued Platform Invoices (GST)</h3>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Tax</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Issued Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.billing.invoices.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-6 text-xs text-muted-foreground">
                      No invoices generated.
                    </TableCell>
                  </TableRow>
                ) : (
                  detail.billing.invoices.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-mono text-xs font-medium">{inv.number}</TableCell>
                      <TableCell className="text-xs font-semibold">₹{(inv.amountPaise / 100).toFixed(2)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">₹{(inv.taxPaise / 100).toFixed(2)}</TableCell>
                      <TableCell className="text-xs capitalize">{inv.status}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(inv.issuedAt).toLocaleDateString("en-IN")}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {activeTab === "usage" && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-xl border bg-card p-4">
            <span className="text-xs text-muted-foreground">Active Products</span>
            <p className="text-2xl font-bold mt-1">{detail.usage.productsCount}</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <span className="text-xs text-muted-foreground">Total Orders Placed</span>
            <p className="text-2xl font-bold mt-1">{detail.usage.ordersCount}</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <span className="text-xs text-muted-foreground">Gross Merchandise Volume</span>
            <p className="text-2xl font-bold mt-1">₹{(detail.usage.gmvPaise / 100).toLocaleString("en-IN")}</p>
          </div>
        </div>
      )}

      {activeTab === "health" && (
        <div className="space-y-6">
          <div className="rounded-xl border bg-card p-4">
            <span className="text-xs text-muted-foreground">Webhook Inbound Errors</span>
            <p className="text-2xl font-bold mt-1 text-destructive">{detail.health.failedWebhooksCount}</p>
          </div>

          <div className="rounded-xl border bg-card overflow-hidden">
            <div className="p-4 border-b">
              <h3 className="font-semibold text-sm">Recent Webhook Failures</h3>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Event ID</TableHead>
                  <TableHead>Error Diagnostics</TableHead>
                  <TableHead>Received At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.health.recentErrors.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-6 text-xs text-muted-foreground">
                      No webhook errors recorded for this store.
                    </TableCell>
                  </TableRow>
                ) : (
                  detail.health.recentErrors.map((w) => (
                    <TableRow key={w.id}>
                      <TableCell className="font-medium text-xs uppercase">{w.provider}</TableCell>
                      <TableCell className="font-mono text-xs">{w.eventId}</TableCell>
                      <TableCell className="text-xs text-destructive font-mono">{w.error || "Unknown"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(w.receivedAt).toLocaleString("en-IN")}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {activeTab === "audit" && (
        <div className="rounded-xl border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead>Actor Type</TableHead>
                <TableHead>Timestamp</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.audit.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center py-6 text-xs text-muted-foreground">
                    No audit records recorded yet.
                  </TableCell>
                </TableRow>
              ) : (
                detail.audit.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-xs font-semibold">{a.action}</TableCell>
                    <TableCell className="text-xs">{a.actorType}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleString("en-IN")}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {activeTab === "notes" && (
        <div className="space-y-6">
          <form onSubmit={handleAddNote} className="rounded-xl border bg-card p-4 space-y-3">
            <h3 className="font-semibold text-sm">Add Internal Operator Note</h3>
            <textarea
              className="w-full rounded-md border p-2 text-xs focus:outline-hidden focus:ring-1 focus:ring-primary"
              rows={3}
              placeholder="e.g. Account manager notes, custom contract nuances, payment arrangement..."
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              required
            />
            <Button size="sm" type="submit" disabled={actionLoading}>
              Save Internal Note
            </Button>
          </form>

          <div className="space-y-3">
            {detail.notes.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No operator notes recorded for this store.</p>
            ) : (
              detail.notes.map((n) => (
                <div key={n.id} className="rounded-lg border bg-card p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span className="font-medium text-foreground">{n.authorName || n.authorEmail || "Staff"}</span>
                    <span>{new Date(n.createdAt).toLocaleString("en-IN")}</span>
                  </div>
                  <p className="text-foreground whitespace-pre-wrap">{n.body}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Suspend Dialog */}
      <Dialog open={suspendOpen} onOpenChange={setSuspendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suspend Store</DialogTitle>
            <DialogDescription>
              Storefront checkout and customer logins will be immediately blocked. Admin becomes read-only.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <label className="text-xs font-semibold">Audit Reason *</label>
            <Input
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              placeholder="e.g. Non-payment after dunning, terms of service breach"
              required
            />
          </div>
          <DialogFooter>
            <Button variant="default" onClick={() => setSuspendOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleSuspend} disabled={actionLoading}>Confirm Suspension</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Extend Trial Dialog */}
      <Dialog open={extendTrialOpen} onOpenChange={setExtendTrialOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Extend Trial Period</DialogTitle>
            <DialogDescription>
              Grant additional evaluation days to this merchant store.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-2">
            <label className="text-xs font-semibold">Additional Days</label>
            <Input
              type="number"
              min={1}
              max={90}
              value={trialDays}
              onChange={(e) => setTrialDays(Number(e.target.value))}
            />
          </div>
          <DialogFooter>
            <Button variant="default" onClick={() => setExtendTrialOpen(false)}>Cancel</Button>
            <Button onClick={handleExtendTrial} disabled={actionLoading}>Extend Trial</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Support Session Impersonation Dialog */}
      <Dialog open={supportSessionOpen} onOpenChange={setSupportSessionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start Time-Boxed Support Session</DialogTitle>
            <DialogDescription>
              Impersonate store admin for diagnostic support. Time-boxed at 60 minutes. Logged in audit trail.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2 text-xs">
            <div>
              <label className="font-semibold">Reason for Access *</label>
              <Input
                value={supportReason}
                onChange={(e) => setSupportReason(e.target.value)}
                placeholder="e.g. Investigating checkout discount application bug"
                required
              />
            </div>
            <div>
              <label className="font-semibold">Support Ticket Reference *</label>
              <Input
                value={supportTicketRef}
                onChange={(e) => setSupportTicketRef(e.target.value)}
                placeholder="e.g. TICKET-9481"
                required
              />
            </div>
            <div>
              <label className="font-semibold">Access Scope</label>
              <Select value={supportScope} onValueChange={(val: any) => setSupportScope(val)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="read_only">Read-Only (Default, safe)</SelectItem>
                  <SelectItem value="write">Write Access (Elevated)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="font-semibold">Consent Verification Mode</label>
              <Select value={supportConsent} onValueChange={(val: any) => setSupportConsent(val)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner_approved">Owner Approved (Email/Portal confirmed)</SelectItem>
                  <SelectItem value="standing_consent">Standing Merchant Consent</SelectItem>
                  <SelectItem value="emergency">Emergency Override (Alerts store owner immediately)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="default" onClick={() => setSupportSessionOpen(false)}>Cancel</Button>
            <Button onClick={handleStartSupport} disabled={actionLoading}>Start Support Session</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deletion Dialog */}
      <Dialog open={deletionOpen} onOpenChange={setDeletionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <AlertOctagon className="h-5 w-5" /> Schedule Tenant Deletion
            </DialogTitle>
            <DialogDescription>
              This enqueues the 8-step tenant deletion workflow (pg-boss). A grace period allows cancellation before permanent purge.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2 text-xs">
            <div>
              <label className="font-semibold">Grace Period (Days)</label>
              <Input
                type="number"
                min={0}
                max={30}
                value={deletionGraceDays}
                onChange={(e) => setDeletionGraceDays(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="font-semibold">Reason for Deletion</label>
              <Input
                value={deletionReason}
                onChange={(e) => setDeletionReason(e.target.value)}
                placeholder="e.g. Account cancellation requested by owner"
              />
            </div>
            <div className="rounded-lg bg-destructive/10 p-3 text-destructive border border-destructive/20">
              <p className="font-semibold">To confirm, type exactly: <span className="font-mono select-all">DELETE {tenant.slug}</span></p>
              <Input
                value={deletionConfirmText}
                onChange={(e) => setDeletionConfirmText(e.target.value)}
                placeholder={`DELETE ${tenant.slug}`}
                className="mt-2 bg-background text-foreground"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="default" onClick={() => setDeletionOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleScheduleDeletion}
              disabled={actionLoading || deletionConfirmText !== `DELETE ${tenant.slug}`}
            >
              Confirm Deletion Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}

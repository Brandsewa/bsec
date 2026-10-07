import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, } from "@tanstack/react-router";
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  Archive,
  ArrowRightLeft,
  Building2,
  Calendar,
  Clock,
  CreditCard,
  Download,
  FileSpreadsheet,
  Globe,
  Headphones,
  RotateCcw,
  ShieldAlert,
  Trash2,
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
  ConfirmDialog,
  toast,
} from "@bs/ui";
import { client } from "../lib/orpc.ts";
import { apiBase, storeAdminBase } from "../lib/config.ts";
import { useHasRole } from "../lib/user-context.tsx";
import { messageOf } from "../lib/errors.ts";

export function TenantDetail() {
  const { id } = useParams({ strict: false }) as { id: string };

  const [activeTab, setActiveTab] = useState<
    "overview" | "domains" | "members" | "billing" | "usage" | "health" | "audit" | "notes"
  >("overview");

  // Dialog states
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [transferConfirmOpen, setTransferConfirmOpen] = useState(false);

  const [suspendOpen, setSuspendOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");

  const [extendTrialOpen, setExtendTrialOpen] = useState(false);
  const [trialDays, setTrialDays] = useState(14);

  const [supportSessionOpen, setSupportSessionOpen] = useState(false);
  const [supportReason, setSupportReason] = useState("");
  const [supportTicketRef, setSupportTicketRef] = useState("");
  const [supportConsent, setSupportConsent] = useState<"owner_approved" | "standing_consent" | "emergency">("owner_approved");

  const [deletionOpen, setDeletionOpen] = useState(false);
  const [deletionConfirmText, setDeletionConfirmText] = useState("");
  const [deletionReason, setDeletionReason] = useState("");
  const [deletionGraceDays, setDeletionGraceDays] = useState(7);

  const [newNote, setNewNote] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const isAdmin = useHasRole("platform_admin");

  const [planOpen, setPlanOpen] = useState(false);
  const [planCode, setPlanCode] = useState("starter");
  const [transferOpen, setTransferOpen] = useState(false);
  const [newOwnerEmail, setNewOwnerEmail] = useState("");
  // The support token is shown exactly once (only its hash is stored)
  const [supportLink, setSupportLink] = useState<{ url: string; status: string; consent: string } | null>(null);

  const { data: detail, isLoading, refetch } = useQuery({
    queryKey: ["platform", "tenants", id, "detail"],
    queryFn: () => client.tenants.getDetail({ id }),
    enabled: Boolean(id),
  });

  const { data: plans } = useQuery({
    queryKey: ["platform", "plans"],
    queryFn: () => client.plans.list(),
    enabled: planOpen,
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
    } catch (err) {
      toast.error(messageOf(err, "Failed to suspend store"));
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
    } catch (err) {
      toast.error(messageOf(err, "Failed to restore store"));
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
    } catch (err) {
      toast.error(messageOf(err, "Failed to extend trial"));
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
        scope: "read_only",
        consent: supportConsent,
      });
      toast.success("Support session created");
      setSupportSessionOpen(false);
      if (res.token) {
        setSupportLink({
          url: `${storeAdminBase()}/support#token=${encodeURIComponent(res.token)}&store=${encodeURIComponent(tenant.id)}`,
          status: res.status,
          consent: res.consent,
        });
      }
      refetch();
    } catch (err) {
      toast.error(messageOf(err, "Failed to initiate support session"));
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
        window.open(`${apiBase()}${res.downloadUrl}`, "_blank", "noopener");
      }
    } catch (err) {
      toast.error(messageOf(err, "Failed to trigger store export"));
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
        confirmSlug: tenant.slug,
        reason: deletionReason || undefined,
        graceDays: deletionGraceDays,
      });
      toast.success(`Tenant deletion scheduled for ${new Date(res.scheduledFor).toLocaleDateString()}`);
      setDeletionOpen(false);
      refetch();
    } catch (err) {
      toast.error(messageOf(err, "Failed to schedule deletion"));
    } finally {
      setActionLoading(false);
    }
  };

  const executeArchive = async () => {
    setActionLoading(true);
    try {
      await client.tenants.archive({ id: tenant.id });
      toast.success("Store archived");
      refetch();
    } catch (err) {
      toast.error(messageOf(err, "Failed to archive store"));
    } finally {
      setActionLoading(false);
      setArchiveConfirmOpen(false);
    }
  };

  const handleChangePlan = async () => {
    setActionLoading(true);
    try {
      await client.tenants.changePlan({ id: tenant.id, planCode });
      toast.success(`Plan changed to ${planCode}. The store's size tier follows the plan.`);
      setPlanOpen(false);
      refetch();
    } catch (err) {
      toast.error(messageOf(err, "Failed to change plan"));
    } finally {
      setActionLoading(false);
    }
  };

  const executeTransfer = async () => {
    if (!newOwnerEmail.trim()) return;
    setActionLoading(true);
    try {
      await client.tenants.transferOwnership({ id: tenant.id, newOwnerEmail: newOwnerEmail.trim() });
      toast.success("Ownership transferred");
      setTransferOpen(false);
      setNewOwnerEmail("");
      refetch();
    } catch (err) {
      toast.error(messageOf(err, "Failed to transfer ownership"));
    } finally {
      setActionLoading(false);
      setTransferConfirmOpen(false);
    }
  };

  const handleCancelDeletion = async () => {
    setActionLoading(true);
    try {
      await client.tenants.cancelDeletion({ id: tenant.id });
      toast.success("Deletion cancelled. The store is back to the state it had before.");
      refetch();
    } catch (err) {
      toast.error(messageOf(err, "Failed to cancel deletion"));
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
    } catch (err) {
      toast.error(messageOf(err, "Failed to save note"));
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <PageContainer size="full">
      <PageBreadcrumbs
        items={[
          { label: "Tenants", href: "/tenants" },
          { label: tenant.name },
        ]}
      />

      <PageHeader
        title={tenant.name}
        description={`Tenant ID: ${tenant.id} · Subdomain: ${tenant.slug}.bcom.si`}
        meta={
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider bg-primary/10 text-primary border border-primary/20">
            {tenant.status}
          </span>
        }
        aside={
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {isAdmin && (tenant.status === "suspended" || tenant.status === "archived") && (
              <Button size="sm" variant="outline" onClick={handleRestore} disabled={actionLoading} className="shadow-2xs">
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Restore Store
              </Button>
            )}
            {isAdmin && !["suspended", "archived", "deletion_requested", "deleted"].includes(tenant.status) && (
              <Button size="sm" variant="destructive" onClick={() => setSuspendOpen(true)} disabled={actionLoading} className="shadow-2xs">
                <ShieldAlert className="mr-1.5 h-3.5 w-3.5" /> Suspend
              </Button>
            )}
            {isAdmin && !["archived", "deletion_requested", "deleted"].includes(tenant.status) && (
              <Button size="sm" variant="outline" onClick={() => setArchiveConfirmOpen(true)} disabled={actionLoading} className="shadow-2xs">
                <Archive className="mr-1.5 h-3.5 w-3.5" /> Archive
              </Button>
            )}

            {isAdmin && tenant.status === "trial" && (
              <Button size="sm" variant="outline" onClick={() => setExtendTrialOpen(true)} className="shadow-2xs">
                <Calendar className="mr-1.5 h-3.5 w-3.5" /> Extend Trial
              </Button>
            )}
            {isAdmin && (
              <Button size="sm" variant="outline" onClick={() => setPlanOpen(true)} className="shadow-2xs">
                <CreditCard className="mr-1.5 h-3.5 w-3.5" /> Change Plan
              </Button>
            )}
            {isAdmin && (
              <Button size="sm" variant="outline" onClick={() => setTransferOpen(true)} className="shadow-2xs">
                <ArrowRightLeft className="mr-1.5 h-3.5 w-3.5" /> Transfer Ownership
              </Button>
            )}

            <Button size="sm" variant="outline" onClick={() => setSupportSessionOpen(true)} className="shadow-2xs">
              <Headphones className="mr-1.5 h-3.5 w-3.5" /> Support Session
            </Button>

            {isAdmin && (
              <Button size="sm" variant="outline" onClick={handleRunExport} disabled={actionLoading} className="shadow-2xs">
                <Download className="mr-1.5 h-3.5 w-3.5" /> Export Data
              </Button>
            )}

            {isAdmin && tenant.status !== "deletion_requested" && tenant.status !== "deleted" && (
              <Button size="sm" variant="destructive" onClick={() => setDeletionOpen(true)} className="shadow-2xs">
                <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
              </Button>
            )}
          </div>
        }
      />

      {detail.deletion && (
        <div role="alert" className="mb-6 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <div className="font-semibold text-destructive flex items-center gap-2">
            <AlertOctagon className="h-4 w-4" /> Deletion scheduled for {new Date(detail.deletion.scheduledFor).toLocaleString("en-IN")}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Step: <span className="font-mono">{detail.deletion.step}</span> · Reason: {detail.deletion.reason}
          </p>
          {detail.deletion.error && <p className="mt-1 text-xs text-destructive">Last error (it will retry): {detail.deletion.error}</p>}
          {detail.deletion.canCancel ? (
            isAdmin && (
              <Button size="sm" className="mt-3" onClick={handleCancelDeletion} disabled={actionLoading}>
                Cancel deletion
              </Button>
            )
          ) : (
            <p className="mt-2 text-xs">The deletion has started and can no longer be cancelled.</p>
          )}
        </div>
      )}

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
          <div className="rounded-xl border border-border bg-card p-5 shadow-xs space-y-4">
            <h3 className="font-semibold text-sm">Store Configuration</h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1.5 border-b border-border/60">
                <span className="text-muted-foreground">Store Name:</span>
                <span className="font-medium text-foreground">{tenant.name}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-border/60">
                <span className="text-muted-foreground">Subdomain:</span>
                <span className="font-mono text-foreground">{tenant.slug}.bcom.si</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-border/60">
                <span className="text-muted-foreground">Lifecycle State:</span>
                <span className="font-semibold capitalize text-foreground">{tenant.status}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-border/60">
                <span className="text-muted-foreground">Created Date:</span>
                <span className="text-foreground">{tenant.createdAt ? new Date(tenant.createdAt).toLocaleString("en-IN") : "—"}</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-muted-foreground">Trial Expiration:</span>
                <span className="text-foreground">{tenant.trialEndsAt ? new Date(tenant.trialEndsAt).toLocaleDateString("en-IN") : "No active trial"}</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 shadow-xs space-y-4">
            <h3 className="font-semibold text-sm">Store Usage & Volume</h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1.5 border-b border-border/60">
                <span className="text-muted-foreground">Active Products:</span>
                <span className="text-foreground">{detail.usage.productsCount} items</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-border/60">
                <span className="text-muted-foreground">Total Orders Placed:</span>
                <span className="text-foreground">{detail.usage.ordersCount} orders</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-muted-foreground">Gross Merchandise Volume:</span>
                <span className="font-semibold text-foreground">₹{(detail.usage.gmvPaise / 100).toLocaleString("en-IN")}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "domains" && (
        <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="px-4">Hostname</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Primary</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right px-4">SSL Status</TableHead>
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
                  <TableRow key={d.id} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="font-mono text-xs font-semibold px-4 text-foreground">{d.hostname}</TableCell>
                    <TableCell className="text-xs">{d.type}</TableCell>
                    <TableCell className="text-xs">{d.isPrimary ? "Yes" : "No"}</TableCell>
                    <TableCell className="text-xs capitalize">{d.status}</TableCell>
                    <TableCell className="text-xs capitalize text-right px-4">{d.sslStatus || "pending"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {activeTab === "members" && (
        <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="px-4">Member Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right px-4">Joined At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.members.map((m) => (
                <TableRow key={m.userId} className="hover:bg-muted/30 transition-colors">
                  <TableCell className="font-medium text-xs px-4 text-foreground">{m.name || "—"}</TableCell>
                  <TableCell className="text-xs">{m.email}</TableCell>
                  <TableCell className="text-xs capitalize font-semibold">{m.role}</TableCell>
                  <TableCell className="text-xs text-muted-foreground text-right px-4">
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
          <div className="rounded-xl border border-border bg-card p-5 shadow-xs">
            <h3 className="font-semibold text-sm mb-3 text-foreground">Subscription Details</h3>
            {detail.billing.subscription ? (
              <div className="text-xs space-y-1">
                <p>Status: <strong className="capitalize text-foreground">{detail.billing.subscription.status}</strong></p>
                <p>Billing Interval: <strong className="capitalize text-foreground">{detail.billing.subscription.interval}</strong></p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No active paid subscription attached.</p>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
            <div className="p-4 border-b border-border/60">
              <h3 className="font-semibold text-sm text-foreground">Issued Platform Invoices (GST)</h3>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="px-4">Invoice #</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Tax</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right px-4">Issued Date</TableHead>
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
                    <TableRow key={inv.id} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="font-mono text-xs font-semibold px-4 text-foreground">{inv.number}</TableCell>
                      <TableCell className="text-xs font-semibold text-foreground">₹{(inv.amountPaise / 100).toFixed(2)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">₹{(inv.taxPaise / 100).toFixed(2)}</TableCell>
                      <TableCell className="text-xs capitalize">{inv.status}</TableCell>
                      <TableCell className="text-xs text-muted-foreground text-right px-4">{new Date(inv.issuedAt).toLocaleDateString("en-IN")}</TableCell>
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
          <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
            <span className="text-xs text-muted-foreground">Active Products</span>
            <p className="text-2xl font-bold mt-1 text-foreground">{detail.usage.productsCount}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
            <span className="text-xs text-muted-foreground">Total Orders Placed</span>
            <p className="text-2xl font-bold mt-1 text-foreground">{detail.usage.ordersCount}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
            <span className="text-xs text-muted-foreground">Gross Merchandise Volume</span>
            <p className="text-2xl font-bold mt-1 text-foreground">₹{(detail.usage.gmvPaise / 100).toLocaleString("en-IN")}</p>
          </div>
        </div>
      )}

      {activeTab === "health" && (
        <div className="space-y-6">
          <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
            <span className="text-xs text-muted-foreground">Webhook Inbound Errors</span>
            <p className="text-2xl font-bold mt-1 text-destructive">{detail.health.failedWebhooksCount}</p>
          </div>

          <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
            <div className="p-4 border-b border-border/60">
              <h3 className="font-semibold text-sm text-foreground">Recent Webhook Failures</h3>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="px-4">Provider</TableHead>
                  <TableHead>Event ID</TableHead>
                  <TableHead>Error Diagnostics</TableHead>
                  <TableHead className="text-right px-4">Received At</TableHead>
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
                    <TableRow key={w.id} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="font-medium text-xs uppercase px-4 text-foreground">{w.provider}</TableCell>
                      <TableCell className="font-mono text-xs">{w.eventId}</TableCell>
                      <TableCell className="text-xs text-destructive font-mono max-w-xs truncate">{w.error || "Unknown"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground text-right px-4">{new Date(w.receivedAt).toLocaleString("en-IN")}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {activeTab === "audit" && (
        <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="px-4">Action</TableHead>
                <TableHead>Actor Type</TableHead>
                <TableHead className="text-right px-4">Timestamp</TableHead>
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
                  <TableRow key={a.id} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="font-mono text-xs font-semibold px-4 text-foreground">{a.action}</TableCell>
                    <TableCell className="text-xs">{a.actorType}</TableCell>
                    <TableCell className="text-xs text-muted-foreground text-right px-4">{new Date(a.createdAt).toLocaleString("en-IN")}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {activeTab === "notes" && (
        <div className="space-y-6">
          <form onSubmit={handleAddNote} className="rounded-xl border border-border bg-card p-5 space-y-3 shadow-xs">
            <h3 className="font-semibold text-sm">Add Internal Operator Note</h3>
            <textarea
              className="w-full rounded-md border border-border bg-background p-2.5 text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
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
                <div key={n.id} className="rounded-lg border border-border bg-card p-3.5 text-xs space-y-1 shadow-2xs">
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
            <p className="rounded-md bg-muted p-2 text-muted-foreground">
              Sessions always start <strong>read-only</strong>. An admin can grant write access afterwards from the Support Sessions page.
            </p>
            <div>
              <label className="font-semibold">Consent Verification Mode</label>
              <Select value={supportConsent} onValueChange={(val) => setSupportConsent(val as typeof supportConsent)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner_approved">Owner approves in their store admin (Settings → Support access)</SelectItem>
                  <SelectItem value="standing_consent">Standing consent (the owner switched it on)</SelectItem>
                  <SelectItem value="emergency">Emergency (platform owners only, flagged in the audit log)</SelectItem>
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

      {/* One-time support link */}
      <Dialog open={supportLink !== null} onOpenChange={(open) => !open && setSupportLink(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Support session created</DialogTitle>
            <DialogDescription>
              {supportLink?.status === "pending_owner_approval"
                ? "The store owner must approve it in their store admin (Settings → Support access) before the link works."
                : "The link works now, for 60 minutes."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-xs">
            <label className="font-semibold">Store admin link (shown once, it opens the store as support)</label>
            <Input readOnly value={supportLink?.url ?? ""} className="font-mono select-all bg-muted" />
            <p className="text-muted-foreground">Only a hash of the token is stored, so this link cannot be shown again. Start a new session if you lose it.</p>
          </div>
          <DialogFooter>
            <Button variant="default" onClick={() => void navigator.clipboard?.writeText(supportLink?.url ?? "")}>Copy link</Button>
            <Button onClick={() => window.open(supportLink?.url, "_blank", "noopener")}>Open store admin</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change plan */}
      <Dialog open={planOpen} onOpenChange={setPlanOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change plan</DialogTitle>
            <DialogDescription>The plan sets the store's limits (size tier). This changes the plan record; it does not charge the merchant.</DialogDescription>
          </DialogHeader>
          <div className="py-2 text-xs space-y-2">
            <label className="font-semibold">New plan</label>
            <Select value={planCode} onValueChange={setPlanCode}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(plans ?? []).map((p) => (
                  <SelectItem key={p.code} value={p.code}>
                    {p.name} (₹{(p.priceMonthlyPaise / 100).toLocaleString("en-IN")}/month)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="default" onClick={() => setPlanOpen(false)}>Cancel</Button>
            <Button onClick={handleChangePlan} disabled={actionLoading}>Change plan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transfer ownership */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transfer ownership</DialogTitle>
            <DialogDescription>The new owner must already have an account. They become the store owner immediately.</DialogDescription>
          </DialogHeader>
          <div className="py-2 text-xs space-y-2">
            <label className="font-semibold">New owner's email</label>
            <Input type="email" value={newOwnerEmail} onChange={(e) => setNewOwnerEmail(e.target.value)} placeholder="new.owner@example.com" />
          </div>
          <DialogFooter>
            <Button variant="default" onClick={() => setTransferOpen(false)}>Cancel</Button>
            <Button onClick={() => setTransferConfirmOpen(true)} disabled={actionLoading || !newOwnerEmail.trim()}>Transfer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={archiveConfirmOpen}
        onOpenChange={setArchiveConfirmOpen}
        title={`Archive ${tenant.name}?`}
        description="The storefront goes offline and custom domains are released. It can be restored later."
        confirmLabel="Archive Store"
        destructive
        onConfirm={executeArchive}
      />

      <ConfirmDialog
        open={transferConfirmOpen}
        onOpenChange={setTransferConfirmOpen}
        title={`Transfer ownership of ${tenant.name}?`}
        description={`Make ${newOwnerEmail.trim()} the owner of ${tenant.name}? They must already have an account.`}
        confirmLabel="Transfer Ownership"
        onConfirm={executeTransfer}
      />

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

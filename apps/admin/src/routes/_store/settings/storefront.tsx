import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Calendar, Check, CheckCircle2, Clock, Copy, ShieldAlert } from "lucide-react";
import { EmptyState, FormSkeleton, PageSkeleton, toast } from "@bs/ui";
import type { StorefrontStatus } from "@bs/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ConfirmDialog } from "../../../components/confirm-dialog.tsx";
import { Field } from "../../../components/field.tsx";
import { HeaderActions, SettingsPageFrame, SettingsSection, useUnsavedGuard } from "../../../components/settings/settings-page.tsx";
import { orpc } from "../../../lib/orpc.ts";
import { errorMessage } from "../../../lib/errors.ts";

export const Route = createFileRoute("/_store/settings/storefront")({
  pendingComponent: () => <PageSkeleton />,
  component: StorefrontSettingsPage,
});

type Mode = "live" | "coming_soon" | "maintenance" | "password";

const MODES: Array<{ value: Mode; title: string; description: string }> = [
  { value: "live", title: "Live", description: "Anyone can browse, add to cart, and checkout." },
  { value: "coming_soon", title: "Coming soon", description: "Visitors see your holding page. They cannot browse products or checkout." },
  { value: "password", title: "Password protected", description: "Only visitors with the password can enter. Staff with admin sessions always have access." },
  { value: "maintenance", title: "Maintenance", description: "Returns a 503 Service Unavailable with Retry-After header. Use during planned maintenance." },
];

const TITLE = "Storefront";
const DESCRIPTION = "Choose whether customers can see and buy from your store. New stores start on the coming-soon page.";

export function StorefrontSettingsPage() {
  const status = useQuery(orpc.admin.storefront.getStatus.queryOptions());

  if (status.isLoading) {
    return (
      <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
        <SettingsSection>
          <FormSkeleton />
        </SettingsSection>
      </SettingsPageFrame>
    );
  }
  if (status.isError || !status.data) {
    return (
      <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
        <SettingsSection>
          <EmptyState
            icon={AlertTriangle}
            title="Could not load storefront settings"
            description={errorMessage(status.error)}
            action={<Button onClick={() => void status.refetch()}>Try again</Button>}
          />
        </SettingsSection>
      </SettingsPageFrame>
    );
  }
  return <StorefrontForm current={status.data} />;
}

function StorefrontForm({ current }: { current: StorefrontStatus }) {
  const queryClient = useQueryClient();
  const routeCtx = useRouteContext({ strict: false }) as { store?: { role?: string; timezone?: string } } | undefined;
  const isOwner = routeCtx?.store?.role === "store_owner";

  const update = useMutation(orpc.admin.storefront.updateStatus.mutationOptions());
  const scheduleMutation = useMutation(orpc.admin.storefront.scheduleMaintenance.mutationOptions());
  const cancelScheduleMutation = useMutation(orpc.admin.storefront.cancelScheduledMaintenance.mutationOptions());
  const endMaintenanceMutation = useMutation(orpc.admin.storefront.endMaintenance.mutationOptions());

  const transitionsQuery = useQuery(
    orpc.admin.storefront.listTransitions.queryOptions({ input: { limit: 10, offset: 0 } }),
  );

  const [mode, setMode] = useState<Mode>(current.mode);
  const [headline, setHeadline] = useState(current.headline ?? "");
  const [collectEmails, setCollectEmails] = useState(current.collectEmails);
  const [password, setPassword] = useState("");
  const [confirmOfflineOpen, setConfirmOfflineOpen] = useState(false);
  const [confirmEndMaintenanceOpen, setConfirmEndMaintenanceOpen] = useState(false);
  const [confirmCancelScheduleOpen, setConfirmCancelScheduleOpen] = useState(false);

  // Scheduled maintenance form state
  const [scheduleStartsAt, setScheduleStartsAt] = useState("");
  const [scheduleEndsAt, setScheduleEndsAt] = useState("");
  const [allowStaffPreview, setAllowStaffPreview] = useState(current.maintenanceAllowStaffPreview ?? true);
  const [copiedAnnouncement, setCopiedAnnouncement] = useState(false);

  const needsPassword = mode === "password" && !current.hasPassword && password.length < 6;
  const unchanged = current.mode === mode && (current.headline ?? "") === headline && current.collectEmails === collectEmails && password === "";
  const guard = useUnsavedGuard(!unchanged);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: orpc.admin.storefront.key() });
  }

  function doSave() {
    update.mutate(
      {
        mode,
        headline: headline.trim() === "" ? null : headline.trim(),
        collectEmails,
        ...(password ? { password } : {}),
      },
      {
        onSuccess: () => {
          setPassword("");
          setConfirmOfflineOpen(false);
          refresh();
          toast.success("Saved. Live to shoppers within a minute");
        },
        onError: (e) => {
          setConfirmOfflineOpen(false);
          toast.error(errorMessage(e));
        },
      },
    );
  }

  function handleSave() {
    if (current.mode === "live" && mode !== "live") {
      setConfirmOfflineOpen(true);
    } else {
      doSave();
    }
  }

  function handleScheduleMaintenance() {
    if (!scheduleStartsAt || !scheduleEndsAt) {
      toast.error("Please specify both start and end time.");
      return;
    }
    const starts = new Date(scheduleStartsAt);
    const ends = new Date(scheduleEndsAt);
    if (isNaN(starts.getTime()) || isNaN(ends.getTime())) {
      toast.error("Invalid dates provided.");
      return;
    }
    if (ends.getTime() <= starts.getTime()) {
      toast.error("End time must be after start time.");
      return;
    }
    const durationHours = (ends.getTime() - starts.getTime()) / (1000 * 60 * 60);
    if (durationHours > 72) {
      toast.error("Maintenance window cannot exceed 72 hours.");
      return;
    }
    if (starts.getTime() < Date.now() + 100_000) {
      toast.error("Scheduled maintenance must start at least 2 minutes in the future.");
      return;
    }

    scheduleMutation.mutate(
      {
        startsAt: starts.toISOString(),
        endsAt: ends.toISOString(),
        allowStaffPreview,
      },
      {
        onSuccess: () => {
          setScheduleStartsAt("");
          setScheduleEndsAt("");
          refresh();
          toast.success("Maintenance window scheduled.");
        },
        onError: (e) => {
          toast.error(errorMessage(e));
        },
      },
    );
  }

  function handleEndMaintenance() {
    endMaintenanceMutation.mutate(
      {},
      {
        onSuccess: () => {
          setConfirmEndMaintenanceOpen(false);
          refresh();
          toast.success("Maintenance ended. Store restored.");
        },
        onError: (e) => {
          setConfirmEndMaintenanceOpen(false);
          toast.error(errorMessage(e));
        },
      },
    );
  }

  function handleCancelScheduled() {
    cancelScheduleMutation.mutate(
      {},
      {
        onSuccess: () => {
          setConfirmCancelScheduleOpen(false);
          refresh();
          toast.success("Scheduled maintenance cancelled.");
        },
        onError: (e) => {
          setConfirmCancelScheduleOpen(false);
          toast.error(errorMessage(e));
        },
      },
    );
  }

  function copyAnnouncement() {
    const text = `Dear customers, our store will undergo scheduled maintenance to improve our services. During this brief window, browsing and checkout will be paused. We appreciate your patience and look forward to welcoming you back shortly!`;
    navigator.clipboard.writeText(text);
    setCopiedAnnouncement(true);
    setTimeout(() => setCopiedAnnouncement(false), 2500);
    toast.success("Maintenance announcement copied to clipboard.");
  }

  return (
    <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
      {guard}
      <ConfirmDialog
        open={confirmOfflineOpen}
        onOpenChange={setConfirmOfflineOpen}
        title="Take store offline?"
        description="Taking your store offline will prevent customers from browsing and purchasing."
        confirmLabel="Take offline"
        destructive
        pending={update.isPending}
        onConfirm={doSave}
      />

      <ConfirmDialog
        open={confirmEndMaintenanceOpen}
        onOpenChange={setConfirmEndMaintenanceOpen}
        title="End maintenance now?"
        description={`This will immediately restore your store to ${current.modeBeforeMaintenance ?? "live"} mode and allow customers to browse and checkout.`}
        confirmLabel="End maintenance"
        pending={endMaintenanceMutation.isPending}
        onConfirm={handleEndMaintenance}
      />

      <ConfirmDialog
        open={confirmCancelScheduleOpen}
        onOpenChange={setConfirmCancelScheduleOpen}
        title="Cancel scheduled maintenance?"
        description="This will cancel the scheduled maintenance window. The store will remain in its current mode."
        confirmLabel="Cancel schedule"
        destructive
        pending={cancelScheduleMutation.isPending}
        onConfirm={handleCancelScheduled}
      />

      <HeaderActions>
        <Button onClick={handleSave} disabled={update.isPending || unchanged || needsPassword}>
          {update.isPending ? "Saving…" : mode === "live" && current.mode !== "live" ? "Take my store live" : "Save changes"}
        </Button>
      </HeaderActions>

      {/* Active Maintenance Alert Banner */}
      {current.mode === "maintenance" && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-900 dark:text-amber-300" role="status">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <ShieldAlert className="size-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" aria-hidden />
              <div>
                <p className="font-semibold text-sm">Store is currently in Maintenance Mode</p>
                <p className="text-amber-800/90 dark:text-amber-400/90 mt-0.5">
                  Public shoppers receive an HTTP 503 Service Unavailable status.
                  {current.maintenanceEndsAt && (
                    <span> Auto-restore scheduled for {new Date(current.maintenanceEndsAt).toLocaleString()}.</span>
                  )}
                </p>
              </div>
            </div>
            {isOwner && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmEndMaintenanceOpen(true)}
                className="border-amber-600/40 text-amber-900 dark:text-amber-200 hover:bg-amber-500/20 shrink-0"
              >
                End maintenance now
              </Button>
            )}
          </div>
        </div>
      )}

      {current.mode === "live" && (
        <SettingsSection>
          <div className="flex items-center gap-2 text-xs" role="status">
            <CheckCircle2 className="size-4 text-primary" aria-hidden />
            Your store is live.
          </div>
        </SettingsSection>
      )}

      <SettingsSection title="Store visibility" description="You can change this at any time.">
        <RadioGroup aria-label="Store visibility" className="gap-2" value={mode} onValueChange={(v) => setMode(v as Mode)}>
          {MODES.map((m) => (
            <label key={m.value} className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 has-data-checked:border-primary/50 has-data-checked:bg-muted">
              <RadioGroupItem value={m.value} className="mt-0.5" />
              <span>
                <span className="block text-xs font-medium text-foreground">{m.title}</span>
                <span className="block text-muted-foreground">{m.description}</span>
              </span>
            </label>
          ))}
        </RadioGroup>
      </SettingsSection>

      {/* Scheduled Maintenance Section (Slice 8B) */}
      <SettingsSection
        title="Scheduled maintenance"
        description="Plan a future maintenance window (up to 72 hours). Automatic restoration ensures stores are never stranded."
      >
        <div className="space-y-4">
          {current.maintenanceStartsAt && current.maintenanceEndsAt ? (
            <div className="rounded-md border border-border bg-muted/40 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Calendar className="size-4 text-primary" aria-hidden />
                  Scheduled maintenance window
                </span>
                <Badge variant="outline">Scheduled</Badge>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-muted-foreground block">Starts at:</span>
                  <strong className="text-foreground">{new Date(current.maintenanceStartsAt).toLocaleString()}</strong>
                  <span className="text-[11px] text-muted-foreground block">({new Date(current.maintenanceStartsAt).toUTCString()})</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Ends at:</span>
                  <strong className="text-foreground">{new Date(current.maintenanceEndsAt).toLocaleString()}</strong>
                  <span className="text-[11px] text-muted-foreground block">({new Date(current.maintenanceEndsAt).toUTCString()})</span>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Staff preview: {current.maintenanceAllowStaffPreview ? "Allowed" : "Blocked"}.
                Store will automatically return to previous mode at end time.
              </p>
              {isOwner && (
                <div className="pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10"
                    onClick={() => setConfirmCancelScheduleOpen(true)}
                  >
                    Cancel scheduled maintenance
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field id="schedule-start" label="Starts at (local time)" hint="At least 2 minutes in future">
                  <Input
                    id="schedule-start"
                    type="datetime-local"
                    value={scheduleStartsAt}
                    onChange={(e) => setScheduleStartsAt(e.target.value)}
                    disabled={!isOwner}
                  />
                </Field>
                <Field id="schedule-end" label="Ends at (local time)" hint="Maximum 72 hours window">
                  <Input
                    id="schedule-end"
                    type="datetime-local"
                    value={scheduleEndsAt}
                    onChange={(e) => setScheduleEndsAt(e.target.value)}
                    disabled={!isOwner}
                  />
                </Field>
              </div>

              <label className="flex items-center gap-2 text-xs text-foreground pt-1">
                <Checkbox
                  checked={allowStaffPreview}
                  onCheckedChange={(c) => setAllowStaffPreview(Boolean(c))}
                  disabled={!isOwner}
                />
                Allow staff with active admin sessions to preview the store during maintenance
              </label>

              <div className="pt-2 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={handleScheduleMaintenance}
                  disabled={!isOwner || scheduleMutation.isPending || !scheduleStartsAt || !scheduleEndsAt}
                >
                  <Clock className="size-3.5 mr-1.5" aria-hidden />
                  {scheduleMutation.isPending ? "Scheduling…" : "Schedule window"}
                </Button>
                {!isOwner && (
                  <span className="text-xs text-muted-foreground italic">
                    (Only the Store Owner can schedule or modify maintenance windows)
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Customer Announcement Template */}
          <div className="rounded-md border border-border p-3 space-y-2 bg-card">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">Customer announcement template</span>
              <Button variant="ghost" size="sm" onClick={copyAnnouncement} className="h-7 text-xs gap-1">
                {copiedAnnouncement ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
                {copiedAnnouncement ? "Copied" : "Copy text"}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              No automated email or SMS notifications are sent to customers for storefront maintenance.
              Use this message for your social media or marketing channels before scheduled downtime.
            </p>
          </div>
        </div>
      </SettingsSection>

      {/* Transition History Table */}
      <SettingsSection
        title="Visibility transition log"
        description="Immutable record of storefront mode changes, scheduled window starts, and auto-restorations."
      >
        {transitionsQuery.isLoading ? (
          <FormSkeleton />
        ) : (transitionsQuery.data?.items ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">No mode transitions recorded yet.</p>
        ) : (
          <div className="rounded-md border border-border overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="border-b border-border bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="p-2.5 font-medium">Transition</th>
                  <th className="p-2.5 font-medium">Reason</th>
                  <th className="p-2.5 font-medium">Triggered by</th>
                  <th className="p-2.5 font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {transitionsQuery.data?.items.map((t) => (
                  <tr key={t.id} className="hover:bg-muted/30">
                    <td className="p-2.5 font-medium text-foreground">
                      <span className="capitalize">{t.fromMode.replace("_", " ")}</span>
                      {" → "}
                      <span className="capitalize">{t.toMode.replace("_", " ")}</span>
                    </td>
                    <td className="p-2.5">
                      <Badge variant="outline" className="text-[10px] capitalize">
                        {t.reason.replace("_", " ")}
                      </Badge>
                    </td>
                    <td className="p-2.5 text-muted-foreground capitalize">
                      {t.actorType}
                    </td>
                    <td className="p-2.5 text-muted-foreground">
                      {new Date(t.at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SettingsSection>

      {mode !== "live" && (
        <SettingsSection title="Holding page" description="What visitors see while the store is not live.">
          <Field id="storefront-headline" label="Headline">
            <Input id="storefront-headline" value={headline} maxLength={120} placeholder="Opening soon" onChange={(e) => setHeadline(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-xs text-foreground">
            <Checkbox checked={collectEmails} onCheckedChange={(c) => setCollectEmails(Boolean(c))} />
            Let visitors leave their email to be notified
          </label>
        </SettingsSection>
      )}

      {mode === "password" && (
        <SettingsSection
          title="Store password"
          description={current.hasPassword ? "A password is set. Enter a new one only if you want to change it." : "Set the password visitors must enter."}
        >
          <Field id="storefront-password" label={current.hasPassword ? "New password" : "Password"} hint="At least 6 characters.">
            <Input id="storefront-password" type="password" autoComplete="new-password" value={password} minLength={6} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        </SettingsSection>
      )}
    </SettingsPageFrame>
  );
}

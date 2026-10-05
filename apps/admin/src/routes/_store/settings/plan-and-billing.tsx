import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { EmptyState, FormSkeleton, PageSkeleton, toast } from "@bs/ui";
import { Badge } from "@bs/ui";
import { Button } from "@bs/ui";
import { Input } from "@bs/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@bs/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@bs/ui";
import { ConfirmDialog } from "@bs/ui";
import { Field } from "@bs/ui";
import { SimpleSelect } from "@bs/ui";
import { SettingsPageFrame, SettingsSection } from "../../../components/settings/settings-page.tsx";
import { orpc } from "../../../lib/orpc.ts";
import { errorMessage } from "../../../lib/errors.ts";

export const Route = createFileRoute("/_store/settings/plan-and-billing")({
  pendingComponent: () => <PageSkeleton />,
  component: PlanAndBillingPage,
});

const TITLE = "Plan & billing";
const DESCRIPTION = "View current subscription, plan quotas, usage, invoices, and submit plan change requests.";

export function PlanAndBillingPage() {
  const queryClient = useQueryClient();
  const query = useQuery(orpc.admin.planAndBilling.get.queryOptions());
  const availablePlansQuery = useQuery(orpc.admin.planAndBilling.availablePlans.queryOptions());
  const { store } = useRouteContext({ from: "/_store" });
  const isOwner = (store?.permissions ?? []).includes("settings.write") && store?.role === "store_owner";

  const requestMutation = useMutation(orpc.admin.planAndBilling.requestChange.mutationOptions());
  const cancelMutation = useMutation(orpc.admin.planAndBilling.cancelRequest.mutationOptions());

  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  const [selectedInterval, setSelectedInterval] = useState<"monthly" | "yearly">("monthly");
  const [requestNote, setRequestNote] = useState("");
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: orpc.admin.planAndBilling.key() });
  }

  if (query.isLoading) {
    return (
      <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
        <SettingsSection>
          <FormSkeleton />
        </SettingsSection>
      </SettingsPageFrame>
    );
  }

  if (query.isError || !query.data) {
    return (
      <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
        <SettingsSection>
          <EmptyState
            icon={AlertTriangle}
            title="Could not load plan and billing details"
            description={errorMessage(query.error)}
            action={<Button onClick={() => void query.refetch()}>Try again</Button>}
          />
        </SettingsSection>
      </SettingsPageFrame>
    );
  }

  const { plan, usage, invoices, openPlanChangeRequest } = query.data;
  const availablePlans = availablePlansQuery.data ?? [];

  function handleOpenRequestDialog() {
    const defaultTarget = availablePlans.find((p) => p.code !== plan?.code) ?? availablePlans[0];
    if (defaultTarget) {
      setSelectedPlanId(defaultTarget.id);
    }
    setSelectedInterval(plan?.interval ?? "monthly");
    setRequestNote("");
    setRequestDialogOpen(true);
  }

  function handleSubmitRequest(e: FormEvent) {
    e.preventDefault();
    if (!selectedPlanId) {
      toast.error("Please select a target plan.");
      return;
    }

    requestMutation.mutate(
      {
        toPlanId: selectedPlanId,
        interval: selectedInterval,
        note: requestNote.trim() || undefined,
      },
      {
        onSuccess: (data) => {
          toast.success(data.message || "Plan change request submitted.");
          setRequestDialogOpen(false);
          refresh();
        },
        onError: (err) => {
          toast.error(errorMessage(err));
        },
      },
    );
  }

  function handleCancelRequest() {
    if (!openPlanChangeRequest) return;
    cancelMutation.mutate(
      { id: openPlanChangeRequest.id },
      {
        onSuccess: () => {
          toast.success("Plan change request cancelled.");
          setConfirmCancelOpen(false);
          refresh();
        },
        onError: (err) => {
          toast.error(errorMessage(err));
        },
      },
    );
  }

  return (
    <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
      {/* Open Plan Change Request Banner */}
      {openPlanChangeRequest ? (
        <SettingsSection>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <div className="flex items-start gap-3">
              <Clock className="h-5 w-5 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-foreground">
                  Plan change request pending review ({openPlanChangeRequest.toPlanName} · {openPlanChangeRequest.interval})
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Requested on {new Date(openPlanChangeRequest.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}. Our team is processing your request.
                  {openPlanChangeRequest.note ? ` Note: "${openPlanChangeRequest.note}"` : null}
                </p>
              </div>
            </div>
            {isOwner ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmCancelOpen(true)}
                disabled={cancelMutation.isPending}
              >
                Cancel request
              </Button>
            ) : null}
          </div>
        </SettingsSection>
      ) : null}

      <Tabs defaultValue="plan" className="w-full">
        <TabsList>
          <TabsTrigger value="plan">Plan & usage</TabsTrigger>
          <TabsTrigger value="invoices">Invoices ({invoices.length})</TabsTrigger>
        </TabsList>

        {/* Tab 1: Plan & Usage */}
        <TabsContent value="plan" className="space-y-6 pt-4">
          <SettingsSection
            title="Current plan"
            description="Your active subscription tier and billing schedule."
            actions={
              isOwner && !openPlanChangeRequest ? (
                <Button onClick={handleOpenRequestDialog} size="sm">
                  Request plan change
                </Button>
              ) : undefined
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-border p-4 bg-card">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-foreground">{plan?.name ?? "Custom Plan"}</h3>
                  <Badge variant={plan?.status === "active" ? "default" : "secondary"}>
                    {plan?.status === "trialing" ? `Trial (${plan.daysLeftInTrial ?? 0} days left)` : plan?.status ?? "Active"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Billed {plan?.interval ?? "monthly"}
                  {plan?.currentPeriodEnd
                    ? ` · Renews ${new Date(plan.currentPeriodEnd).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
                    : null}
                </p>

                {!isOwner ? (
                  <p className="text-xs text-muted-foreground mt-4 italic">
                    Note: Only the store owner can submit plan change requests.
                  </p>
                ) : null}
              </div>

              <div className="rounded-lg border border-border p-4 bg-muted/20">
                <h4 className="text-xs font-medium text-foreground mb-2">Plan features & benefits</h4>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" /> Multi-theme customizer & drag-and-drop builder
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" /> Full India commerce suite (COD, PIN codes, GST invoicing)
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" /> Automatic edge caching & fast storefront delivery
                  </li>
                </ul>
              </div>
            </div>
          </SettingsSection>

          <SettingsSection
            title="Usage & quotas"
            description="Active resource utilization for this store."
          >
            <div className="grid gap-4 sm:grid-cols-3">
              {usage.map((item) => (
                <div key={item.key} className="rounded-lg border border-border p-4 bg-card">
                  <p className="text-xs font-medium text-muted-foreground">{item.description}</p>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-2xl font-semibold text-foreground">{item.used}</span>
                    <span className="text-xs text-muted-foreground">
                      / {item.limit != null ? `${item.limit} ${item.unit}` : "Unlimited"}
                    </span>
                  </div>
                  {item.limit != null ? (
                    <div className="mt-2 w-full bg-muted rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-full ${item.percentUsed > 90 ? "bg-destructive" : item.percentUsed > 75 ? "bg-amber-500" : "bg-primary"}`}
                        style={{ width: `${Math.min(item.percentUsed, 100)}%` }}
                      />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </SettingsSection>
        </TabsContent>

        {/* Tab 2: Invoices */}
        <TabsContent value="invoices" className="pt-4">
          <SettingsSection
            title="Platform billing invoices"
            description="History of subscription charges and platform fees for your store."
          >
            {invoices.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                No invoices issued yet.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-border bg-muted/40 font-medium text-muted-foreground">
                    <tr>
                      <th className="p-3">Invoice #</th>
                      <th className="p-3">Issued date</th>
                      <th className="p-3">Amount</th>
                      <th className="p-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {invoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-muted/20">
                        <td className="p-3 font-medium text-foreground">{inv.number}</td>
                        <td className="p-3 text-muted-foreground">
                          {new Date(inv.issuedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                        </td>
                        <td className="p-3 font-medium text-foreground">
                          ₹{(inv.amountPaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </td>
                        <td className="p-3">
                          <Badge variant={inv.status === "paid" ? "outline" : "secondary"}>
                            {inv.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SettingsSection>
        </TabsContent>
      </Tabs>

      {/* Request Plan Change Modal Dialog */}
      <Dialog open={requestDialogOpen} onOpenChange={setRequestDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request plan change</DialogTitle>
            <DialogDescription>
              Select a target plan and billing interval. Our platform team will review your request.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmitRequest} className="grid gap-4 py-2">
            <Field id="targetPlan" label="Target plan">
              <SimpleSelect
                id="targetPlan"
                value={selectedPlanId}
                placeholder="Select a plan"
                onChange={setSelectedPlanId}
                options={availablePlans.map((p) => ({
                  value: p.id,
                  label: `${p.name} (₹${(p.priceMonthlyPaise / 100).toLocaleString("en-IN")}/mo)`,
                }))}
              />
            </Field>

            <Field id="targetInterval" label="Billing interval">
              <SimpleSelect
                id="targetInterval"
                value={selectedInterval}
                placeholder="Select interval"
                onChange={(val) => setSelectedInterval(val as "monthly" | "yearly")}
                options={[
                  { value: "monthly", label: "Monthly billing" },
                  { value: "yearly", label: "Yearly billing" },
                ]}
              />
            </Field>

            <Field id="requestNote" label="Note (optional)" hint="Any specific requests or requirements.">
              <Input
                id="requestNote"
                value={requestNote}
                onChange={(e) => setRequestNote(e.target.value)}
                placeholder="e.g. Higher catalog limit needed for festive season"
              />
            </Field>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRequestDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={requestMutation.isPending || !selectedPlanId}>
                {requestMutation.isPending ? "Submitting…" : "Submit request"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Confirm Cancel Dialog */}
      <ConfirmDialog
        open={confirmCancelOpen}
        onOpenChange={setConfirmCancelOpen}
        title="Cancel plan change request?"
        description="Are you sure you want to withdraw this plan change request?"
        confirmLabel="Yes, cancel request"
        cancelLabel="Keep request"
        destructive
        pending={cancelMutation.isPending}
        onConfirm={handleCancelRequest}
      />
    </SettingsPageFrame>
  );
}

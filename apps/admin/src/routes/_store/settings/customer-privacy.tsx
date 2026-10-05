import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { AlertTriangle, Download, Shield, Trash2, UserMinus } from "lucide-react";
import { EmptyState, FormSkeleton, PageSkeleton, toast } from "@bs/ui";
import { Button } from "@bs/ui";
import { Input } from "@bs/ui";
import { Field } from "@bs/ui";
import { ConfirmDialog } from "@bs/ui";
import { HeaderActions, SettingsPageFrame, SettingsSection, useUnsavedGuard } from "../../../components/settings/settings-page.tsx";
import { orpc } from "../../../lib/orpc.ts";
import { errorMessage } from "../../../lib/errors.ts";
import type { CookieInventoryItem, PrivacyRequestItem, PrivacySettings } from "@bs/contracts";

export const Route = createFileRoute("/_store/settings/customer-privacy")({
  pendingComponent: () => <PageSkeleton />,
  component: CustomerPrivacySettingsPage,
});

const TITLE = "Customer Privacy";
const DESCRIPTION = "Manage customer data privacy requests, contact points, statutory turnaround times, and cookie disclosure.";

export function CustomerPrivacySettingsPage() {
  const query = useQuery(orpc.admin.customerPrivacy.getSettings.queryOptions());
  const requestsQuery = useQuery(orpc.admin.customerPrivacy.listRequests.queryOptions({ input: {} }));
  const cookiesQuery = useQuery(orpc.admin.customerPrivacy.cookieInventory.queryOptions());

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
            title="Could not load privacy settings"
            description={errorMessage(query.error)}
            action={<Button onClick={() => void query.refetch()}>Try again</Button>}
          />
        </SettingsSection>
      </SettingsPageFrame>
    );
  }

  return (
    <PrivacyForm
      data={query.data}
      requests={requestsQuery.data?.items ?? []}
      requestsLoading={requestsQuery.isLoading}
      onRequestsRefetch={() => void requestsQuery.refetch()}
      cookies={cookiesQuery.data ?? []}
    />
  );
}

function PrivacyForm({
  data,
  requests,
  requestsLoading,
  onRequestsRefetch,
  cookies,
}: {
  data: PrivacySettings;
  requests: PrivacyRequestItem[];
  requestsLoading: boolean;
  onRequestsRefetch: () => void;
  cookies: CookieInventoryItem[];
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    privacyContactEmail: data.privacyContactEmail ?? "",
    grievanceOfficerName: data.grievanceOfficerName ?? "",
    requestSlaDays: data.requestSlaDays,
  });

  const [saved, setSaved] = useState(form);
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  useUnsavedGuard(dirty);

  const [activeRequest, setActiveRequest] = useState<PrivacyRequestItem | null>(null);
  const [confirmAction, setConfirmAction] = useState<"export" | "erase" | "withdraw" | null>(null);

  const settingsMutation = useMutation(
    orpc.admin.customerPrivacy.updateSettings.mutationOptions({
      onSuccess: (updated) => {
        void queryClient.invalidateQueries({ queryKey: orpc.admin.customerPrivacy.getSettings.key() });
        const nextState = {
          privacyContactEmail: updated.privacyContactEmail ?? "",
          grievanceOfficerName: updated.grievanceOfficerName ?? "",
          requestSlaDays: updated.requestSlaDays,
        };
        setForm(nextState);
        setSaved(nextState);
        toast.success("Privacy settings saved");
      },
      onError: (err) => {
        toast.error(errorMessage(err));
      },
    }),
  );

  const updateStatusMutation = useMutation(
    orpc.admin.customerPrivacy.updateRequestStatus.mutationOptions({
      onSuccess: () => {
        toast.success("Request updated");
        onRequestsRefetch();
      },
      onError: (err) => {
        toast.error(errorMessage(err));
      },
    }),
  );

  const exportMutation = useMutation(
    orpc.admin.customerPrivacy.exportCustomerData.mutationOptions({
      onSuccess: () => {
        setConfirmAction(null);
        toast.success("Export generated successfully");
        onRequestsRefetch();
      },
      onError: (err) => {
        toast.error(errorMessage(err));
      },
    }),
  );

  const eraseMutation = useMutation(
    orpc.admin.customerPrivacy.eraseCustomerData.mutationOptions({
      onSuccess: (res) => {
        setConfirmAction(null);
        toast.success(`Customer data erased (${res.mode})`);
        onRequestsRefetch();
      },
      onError: (err) => {
        toast.error(errorMessage(err));
      },
    }),
  );

  const withdrawMutation = useMutation(
    orpc.admin.customerPrivacy.withdrawConsent.mutationOptions({
      onSuccess: () => {
        setConfirmAction(null);
        toast.success("Marketing consent withdrawn");
        onRequestsRefetch();
      },
      onError: (err) => {
        toast.error(errorMessage(err));
      },
    }),
  );

  const handleSubmit = (e?: FormEvent) => {
    e?.preventDefault();
    settingsMutation.mutate({
      privacyContactEmail: form.privacyContactEmail.trim() || null,
      grievanceOfficerName: form.grievanceOfficerName.trim() || null,
      requestSlaDays: Number(form.requestSlaDays),
      expectedVersion: data.version,
    });
  };



  return (
    <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
      <HeaderActions>
        <Button
          type="submit"
          form="settings-privacy"
          disabled={settingsMutation.isPending || !dirty}
        >
          {settingsMutation.isPending ? "Saving…" : "Save changes"}
        </Button>
      </HeaderActions>
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <Shield className="size-5 text-primary mt-0.5" />
          <div className="text-xs/relaxed text-muted-foreground space-y-1">
            <p className="font-semibold text-foreground text-sm">Customer Data Protection (DPDP Act, 2023)</p>
            <p>
              Merchants must address data principal rights including access, correction, erasure, and consent withdrawal. Requests from customers require identity confirmation via single-use email verification before fulfillment.
            </p>
            <p>
              Note: Commercial transaction history and tax invoices must be retained for required accounting compliance and are preserved during customer profile erasure.
            </p>
          </div>
        </div>
      </div>

      <form id="settings-privacy" onSubmit={handleSubmit} className="space-y-6">
        <SettingsSection
          title="Privacy contacts & SLA"
          description="Designate official contact points for privacy communications and statutory turnaround limits."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="privacyContactEmail" label="Privacy contact email" hint="Public contact point for privacy inquiries.">
              <Input
                id="privacyContactEmail"
                type="email"
                value={form.privacyContactEmail}
                onChange={(e) => setForm({ ...form, privacyContactEmail: e.target.value })}
                placeholder="privacy@example.com"
              />
            </Field>

            <Field id="grievanceOfficerName" label="Grievance officer name" hint="Statutory grievance redressal officer.">
              <Input
                id="grievanceOfficerName"
                value={form.grievanceOfficerName}
                onChange={(e) => setForm({ ...form, grievanceOfficerName: e.target.value })}
                placeholder="Full name"
                maxLength={120}
              />
            </Field>

            <Field id="requestSlaDays" label="Response SLA (Days)" hint="Statutory limit to resolve requests (7 to 90 days).">
              <Input
                id="requestSlaDays"
                type="number"
                min={7}
                max={90}
                value={form.requestSlaDays}
                onChange={(e) => setForm({ ...form, requestSlaDays: Number(e.target.value) })}
              />
            </Field>
          </div>
        </SettingsSection>
      </form>

      <SettingsSection
        title="Privacy requests queue"
        description="Data principal requests submitted by customers through the storefront privacy portal."
      >
        {requestsLoading ? (
          <FormSkeleton />
        ) : requests.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">No privacy requests logged yet.</p>
        ) : (
          <div className="rounded-lg border border-border divide-y divide-border text-xs">
            {requests.map((req) => (
              <div key={req.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium text-foreground">{req.requesterEmail}</span>
                    <span className="inline-flex rounded-full bg-muted px-1.5 py-0.2 text-[10px] uppercase font-semibold text-muted-foreground">
                      {req.kind.replace("_", " ")}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${
                        req.status === "completed"
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                          : req.status === "pending_verification"
                          ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                          : "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400"
                      }`}
                    >
                      {req.status.replace("_", " ")}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-muted-foreground">
                    <span>Due: {new Date(req.dueAt).toLocaleDateString()}</span>
                    {req.details ? <span>· {req.details}</span> : null}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {req.status === "pending_verification" ? (
                    <span className="text-[11px] text-muted-foreground italic">Awaiting email click</span>
                  ) : (
                    <>
                      {req.kind === "access" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setActiveRequest(req);
                            setConfirmAction("export");
                          }}
                        >
                          <Download className="mr-1 size-3" /> Export
                        </Button>
                      )}
                      {req.kind === "erasure" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setActiveRequest(req);
                            setConfirmAction("erase");
                          }}
                        >
                          <Trash2 className="mr-1 size-3 text-destructive" /> Erase
                        </Button>
                      )}
                      {req.kind === "withdraw_consent" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setActiveRequest(req);
                            setConfirmAction("withdraw");
                          }}
                        >
                          <UserMinus className="mr-1 size-3" /> Unsubscribe
                        </Button>
                      )}
                      {req.status !== "completed" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            updateStatusMutation.mutate({
                              id: req.id,
                              status: "completed",
                              resolutionNote: "Fulfilled by store staff",
                            })
                          }
                        >
                          Mark Complete
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title="Cookie inventory"
        description="This storefront sets strictly necessary cookies only. No tracking, analytics, or third-party marketing cookies are loaded."
      >
        <div className="divide-y divide-border rounded-lg border border-border">
          {cookies.map((c) => (
            <div key={c.name} className="flex items-center justify-between p-3 text-xs">
              <div>
                <span className="font-mono font-semibold text-foreground">{c.name}</span>
                <p className="text-muted-foreground mt-0.5">{c.purpose}</p>
              </div>
              <div className="text-right">
                <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                  Strictly Necessary
                </span>
                <p className="text-[10px] text-muted-foreground mt-0.5">{c.duration}</p>
              </div>
            </div>
          ))}
        </div>
      </SettingsSection>

      <ConfirmDialog
        open={confirmAction === "export"}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title="Export Customer Data"
        description={
          <div>
            <p>
              Compile an official JSON data bundle for <strong>{activeRequest?.requesterEmail}</strong>?
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Internal staff notes and other customers' private data will be strictly omitted. The signed download link expires after 7 days.
            </p>
          </div>
        }
        confirmLabel="Generate Export"
        pending={exportMutation.isPending}
        onConfirm={() => activeRequest && exportMutation.mutate({ id: activeRequest.id })}
      />

      <ConfirmDialog
        open={confirmAction === "erase"}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        destructive
        title="Erase Customer Data"
        description={
          <div>
            <p>
              Are you sure you want to erase personal data for <strong>{activeRequest?.requesterEmail}</strong>?
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              If past orders exist, profile PII will be anonymized while order transaction records will be retained for statutory tax compliance. If no orders exist, the profile will be deleted.
            </p>
          </div>
        }
        confirmLabel="Erase Data"
        pending={eraseMutation.isPending}
        onConfirm={() => activeRequest && eraseMutation.mutate({ id: activeRequest.id })}
      />

      <ConfirmDialog
        open={confirmAction === "withdraw"}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title="Withdraw Marketing Consent"
        description={
          <p>
            Record an immediate consent withdrawal and unsubscribe <strong>{activeRequest?.requesterEmail}</strong> from all promotional and newsletter communications?
          </p>
        }
        confirmLabel="Confirm Unsubscribe"
        pending={withdrawMutation.isPending}
        onConfirm={() => activeRequest && withdrawMutation.mutate({ id: activeRequest.id })}
      />
    </SettingsPageFrame>
  );
}

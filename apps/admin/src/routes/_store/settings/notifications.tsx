import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { EmptyState, FormSkeleton, PageSkeleton, toast } from "@bs/ui";
import { Button } from "@bs/ui";
import { Input } from "@bs/ui";
import { Switch } from "@bs/ui";
import { Field } from "@bs/ui";
import { HeaderActions, SettingsCard, SettingsPageFrame, useUnsavedGuard } from "../../../components/settings/settings-page.tsx";
import { orpc } from "../../../lib/orpc.ts";
import { errorMessage } from "../../../lib/errors.ts";
import type { NotificationSettings } from "@bs/contracts";

export const Route = createFileRoute("/_store/settings/notifications")({
  pendingComponent: () => <PageSkeleton />,
  component: NotificationSettingsPage,
});

const TITLE = "Notifications";
const DESCRIPTION = "Configure customer email notifications, sender details, and staff order alerts.";

interface NotificationFormState {
  displayName: string;
  replyToEmail: string;
  orderConfirmation: boolean;
  shipment: boolean;
  delivery: boolean;
  cancellation: boolean;
  refund: boolean;
  returnUpdates: boolean;
  preorderReminders: boolean;
  staffNewOrderEnabled: boolean;
  staffNewOrderRecipients: string;
  footerNote: string;
}

export function NotificationSettingsPage() {
  const query = useQuery(orpc.admin.notificationSettings.get.queryOptions());

  if (query.isLoading) {
    return (
      <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
        <SettingsCard>
          <FormSkeleton />
        </SettingsCard>
      </SettingsPageFrame>
    );
  }

  if (query.isError || !query.data) {
    return (
      <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
        <SettingsCard>
          <EmptyState
            icon={AlertTriangle}
            title="Could not load notification settings"
            description={errorMessage(query.error)}
            action={<Button onClick={() => void query.refetch()}>Try again</Button>}
          />
        </SettingsCard>
      </SettingsPageFrame>
    );
  }

  return <NotificationForm data={query.data} />;
}

function NotificationForm({ data }: { data: NotificationSettings }) {
  const queryClient = useQueryClient();
  const prefs = data.preferences;

  const [form, setForm] = useState<NotificationFormState>({
    displayName: prefs.sender.displayName ?? "",
    replyToEmail: prefs.sender.replyToEmail ?? "",
    orderConfirmation: prefs.customer.orderConfirmation,
    shipment: prefs.customer.shipment,
    delivery: prefs.customer.delivery,
    cancellation: prefs.customer.cancellation,
    refund: prefs.customer.refund,
    returnUpdates: prefs.customer.returnUpdates,
    preorderReminders: prefs.customer.preorderReminders,
    staffNewOrderEnabled: prefs.staff.newOrder.enabled,
    staffNewOrderRecipients: prefs.staff.newOrder.recipients.join(", "),
    footerNote: prefs.footerNote ?? "",
  });

  const [saved, setSaved] = useState<NotificationFormState>(form);
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  useUnsavedGuard(dirty);

  const mutation = useMutation(
    orpc.admin.notificationSettings.update.mutationOptions({
      onSuccess: (updatedPrefs) => {
        void queryClient.invalidateQueries({ queryKey: orpc.admin.notificationSettings.get.key() });
        const nextState: NotificationFormState = {
          displayName: updatedPrefs.sender.displayName ?? "",
          replyToEmail: updatedPrefs.sender.replyToEmail ?? "",
          orderConfirmation: updatedPrefs.customer.orderConfirmation,
          shipment: updatedPrefs.customer.shipment,
          delivery: updatedPrefs.customer.delivery,
          cancellation: updatedPrefs.customer.cancellation,
          refund: updatedPrefs.customer.refund,
          returnUpdates: updatedPrefs.customer.returnUpdates,
          preorderReminders: updatedPrefs.customer.preorderReminders,
          staffNewOrderEnabled: updatedPrefs.staff.newOrder.enabled,
          staffNewOrderRecipients: updatedPrefs.staff.newOrder.recipients.join(", "),
          footerNote: updatedPrefs.footerNote ?? "",
        };
        setForm(nextState);
        setSaved(nextState);
        toast.success("Notification settings saved");
      },
      onError: (err) => {
        toast.error(errorMessage(err));
      },
    }),
  );

  const handleSubmit = (e?: FormEvent) => {
    e?.preventDefault();

    const recipients = form.staffNewOrderRecipients
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);

    mutation.mutate({
      sender: {
        displayName: form.displayName.trim() || undefined,
        replyToEmail: form.replyToEmail.trim() || undefined,
      },
      customer: {
        orderConfirmation: form.orderConfirmation,
        shipment: form.shipment,
        delivery: form.delivery,
        cancellation: form.cancellation,
        refund: form.refund,
        returnUpdates: form.returnUpdates,
        preorderReminders: form.preorderReminders,
      },
      staff: {
        newOrder: {
          enabled: form.staffNewOrderEnabled,
          recipients,
        },
      },
      footerNote: form.footerNote.trim() || undefined,
    });
  };

  return (
    <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
      <HeaderActions>
        <Button
          type="submit"
          form="settings-notifications"
          disabled={mutation.isPending || !dirty}
        >
          {mutation.isPending ? "Saving…" : "Save changes"}
        </Button>
      </HeaderActions>
      {!data.platformMailerConfigured && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          <div className="flex items-start gap-3">
            <Info className="size-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
            <div>
              <p className="text-sm font-semibold">Email delivery is not enabled on this platform yet</p>
              <p className="mt-1 text-xs/relaxed">
                Your settings are saved and will apply once platform email credentials are fully configured.
              </p>
            </div>
          </div>
        </div>
      )}

      <form id="settings-notifications" onSubmit={handleSubmit} className="space-y-6">
        <SettingsCard
          title="Sender details"
          description="Display name and reply address shown on customer emails"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="displayName" label="Sender display name" hint="The store name customers see in their inbox.">
              <Input
                id="displayName"
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                placeholder="e.g. Acme Store"
                maxLength={60}
              />
            </Field>

            <Field id="replyToEmail" label="Reply-to email" hint="Where customer replies are routed.">
              <Input
                id="replyToEmail"
                type="email"
                value={form.replyToEmail}
                onChange={(e) => setForm({ ...form, replyToEmail: e.target.value })}
                placeholder="support@example.com"
              />
            </Field>
          </div>
        </SettingsCard>

        <SettingsCard
          title="Customer notifications"
          description="Transactional updates automatically dispatched to shoppers"
        >
          <div className="divide-y divide-border">
            <div className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium text-foreground">Order confirmation</p>
                <p className="text-xs text-muted-foreground">Sent immediately when a shopper places an order.</p>
              </div>
              <Switch
                checked={form.orderConfirmation}
                onCheckedChange={(c) => setForm({ ...form, orderConfirmation: c })}
              />
            </div>

            <div className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium text-foreground">Shipment updates</p>
                <p className="text-xs text-muted-foreground">Sent when an order is fulfilled and assigned tracking.</p>
              </div>
              <Switch
                checked={form.shipment}
                onCheckedChange={(c) => setForm({ ...form, shipment: c })}
              />
            </div>

            <div className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium text-foreground">Delivery confirmation</p>
                <p className="text-xs text-muted-foreground">Sent once the courier marks the package delivered.</p>
              </div>
              <Switch
                checked={form.delivery}
                onCheckedChange={(c) => setForm({ ...form, delivery: c })}
              />
            </div>

            <div className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium text-foreground">Order cancellation</p>
                <p className="text-xs text-muted-foreground">Sent if an order is cancelled before fulfillment.</p>
              </div>
              <Switch
                checked={form.cancellation}
                onCheckedChange={(c) => setForm({ ...form, cancellation: c })}
              />
            </div>

            <div className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium text-foreground">Refund confirmation</p>
                <p className="text-xs text-muted-foreground">Sent when a refund transaction is issued.</p>
              </div>
              <Switch
                checked={form.refund}
                onCheckedChange={(c) => setForm({ ...form, refund: c })}
              />
            </div>

            <div className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium text-foreground">Return status updates</p>
                <p className="text-xs text-muted-foreground">Sent when return requests are authorized or inspected.</p>
              </div>
              <Switch
                checked={form.returnUpdates}
                onCheckedChange={(c) => setForm({ ...form, returnUpdates: c })}
              />
            </div>

            <div className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium text-foreground">Pre-order reminders</p>
                <p className="text-xs text-muted-foreground">Sent before anticipated release or shipping dates.</p>
              </div>
              <Switch
                checked={form.preorderReminders}
                onCheckedChange={(c) => setForm({ ...form, preorderReminders: c })}
              />
            </div>

            <div className="flex items-center justify-between py-3">
              <div>
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-medium text-foreground">Account security & auth</p>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    Required
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Password resets, verification codes, and sign-in links cannot be suppressed.
                </p>
              </div>
              <Switch checked={true} disabled />
            </div>
          </div>
        </SettingsCard>

        <SettingsCard
          title="Staff alerts"
          description="Instant order summaries sent to your team on new sales"
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">New order email alert</p>
                <p className="text-xs text-muted-foreground">Receive instant alerts with order totals and items.</p>
              </div>
              <Switch
                checked={form.staffNewOrderEnabled}
                onCheckedChange={(c) => setForm({ ...form, staffNewOrderEnabled: c })}
              />
            </div>

            {form.staffNewOrderEnabled && (
              <Field
                id="staffNewOrderRecipients"
                label="Recipient email addresses"
                hint="Comma-separated list of staff emails (up to 5 addresses)."
              >
                <Input
                  id="staffNewOrderRecipients"
                  value={form.staffNewOrderRecipients}
                  onChange={(e) => setForm({ ...form, staffNewOrderRecipients: e.target.value })}
                  placeholder="orders@example.com, manager@example.com"
                />
              </Field>
            )}
          </div>
        </SettingsCard>

        <SettingsCard
          title="Email footer note"
          description="Appended to all customer transactional emails (up to 300 chars)"
        >
          <Field id="footerNote" label="Footer note">
            <Input
              id="footerNote"
              value={form.footerNote}
              onChange={(e) => setForm({ ...form, footerNote: e.target.value })}
              placeholder="e.g. Thank you for supporting our handcrafted business!"
              maxLength={300}
            />
          </Field>
        </SettingsCard>
      </form>

      <SettingsCard
        title="Recent email delivery history"
        description="The last 100 email delivery events (masked for privacy)"
      >
        {data.recentDeliveries.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">No email activity logged yet.</p>
        ) : (
          <div className="rounded-lg border border-border divide-y divide-border text-xs">
            {data.recentDeliveries.map((item) => (
              <div key={item.id} className="flex items-center justify-between p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium text-foreground">{item.toEmailMasked}</span>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${
                        item.status === "sent"
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                          : item.status === "skipped"
                          ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-muted-foreground">
                    <span className="truncate">{item.subject}</span>
                    <span>·</span>
                    <span className="font-mono">{item.template}</span>
                  </div>
                </div>
                <div className="text-right text-[11px] text-muted-foreground shrink-0 pl-3">
                  {new Date(item.createdAt).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingsCard>
    </SettingsPageFrame>
  );
}

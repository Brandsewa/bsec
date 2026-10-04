import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { AlertCircle, AlertTriangle, Clock, Mail, Phone, UserCheck } from "lucide-react";
import { EmptyState, FormSkeleton, PageSkeleton, toast } from "@bs/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SimpleSelect } from "../../../components/simple-select.tsx";
import { Field } from "../../../components/field.tsx";
import { HeaderActions, SettingsPageFrame, SettingsSection, useUnsavedGuard } from "../../../components/settings/settings-page.tsx";
import { orpc } from "../../../lib/orpc.ts";
import { errorMessage } from "../../../lib/errors.ts";
import type { CheckoutSettings } from "@bs/contracts";

export const Route = createFileRoute("/_store/settings/checkout")({
  pendingComponent: () => <PageSkeleton />,
  component: CheckoutSettingsPage,
});

const TITLE = "Checkout settings";
const DESCRIPTION = "Manage customer contact fields, account requirements, and abandoned checkout recovery.";

interface CheckoutFormState {
  guestCheckout: boolean;
  accountCreation: "none" | "after_completed_order";
  phoneRequired: boolean;
  addressLine2: "hidden" | "optional";
  companyName: "hidden" | "optional";
  marketingEmailEnabled: boolean;
  marketingEmailLabel: string;
  recoveryEnabled: boolean;
  detectAfterMinutes: number;
}

export function CheckoutSettingsPage() {
  const query = useQuery(orpc.admin.checkoutSettings.get.queryOptions());

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
            title="Could not load checkout settings"
            description={errorMessage(query.error)}
            action={<Button onClick={() => void query.refetch()}>Try again</Button>}
          />
        </SettingsSection>
      </SettingsPageFrame>
    );
  }

  return <CheckoutSettingsForm initial={query.data} />;
}

function CheckoutSettingsForm({
  initial,
}: {
  initial: CheckoutSettings;
}) {
  const queryClient = useQueryClient();

  const [form, setForm] = useState<CheckoutFormState>({
    guestCheckout: initial.guestCheckout,
    accountCreation: initial.accountCreation,
    phoneRequired: initial.phoneRequired,
    addressLine2: initial.addressLine2,
    companyName: initial.companyName,
    marketingEmailEnabled: initial.marketingEmail.enabled,
    marketingEmailLabel: initial.marketingEmail.label,
    recoveryEnabled: initial.abandoned.recoveryEnabled,
    detectAfterMinutes: initial.abandoned.detectAfterMinutes,
  });

  const dirty =
    form.guestCheckout !== initial.guestCheckout ||
    form.accountCreation !== initial.accountCreation ||
    form.phoneRequired !== initial.phoneRequired ||
    form.addressLine2 !== initial.addressLine2 ||
    form.companyName !== initial.companyName ||
    form.marketingEmailEnabled !== initial.marketingEmail.enabled ||
    form.marketingEmailLabel !== initial.marketingEmail.label ||
    form.recoveryEnabled !== initial.abandoned.recoveryEnabled ||
    form.detectAfterMinutes !== initial.abandoned.detectAfterMinutes;

  const guard = useUnsavedGuard(dirty);

  const update = useMutation(
    orpc.admin.checkoutSettings.update.mutationOptions({
      onSuccess: () => {
        toast.success("Checkout settings saved");
        void queryClient.invalidateQueries({ queryKey: orpc.admin.checkoutSettings.key() });
      },
      onError: (err) => toast.error(errorMessage(err)),
    }),
  );

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    update.mutate({
      guestCheckout: form.guestCheckout,
      accountCreation: form.accountCreation,
      phoneRequired: form.phoneRequired,
      addressLine2: form.addressLine2,
      companyName: form.companyName,
      marketingEmail: {
        enabled: form.marketingEmailEnabled,
        label: form.marketingEmailLabel,
      },
      abandoned: {
        recoveryEnabled: form.recoveryEnabled,
        detectAfterMinutes: form.detectAfterMinutes,
        steps: initial.abandoned.steps,
      },
      expectedUpdatedAt: initial.updatedAt,
    });
  }

  return (
    <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
      {guard}
      <HeaderActions>
        <Button
          type="submit"
          form="settings-checkout"
          disabled={update.isPending || !dirty}
        >
          {update.isPending ? "Saving…" : "Save changes"}
        </Button>
      </HeaderActions>

      <form id="settings-checkout" onSubmit={onSubmit} className="space-y-6">
        <SettingsSection
          title="Customer accounts & contact"
          description="Control whether customer accounts are optional, required, or prompted after ordering."
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
              <div className="space-y-0.5">
                <label htmlFor="guest-checkout" className="text-sm font-medium text-foreground cursor-pointer flex items-center gap-2">
                  <UserCheck className="h-4 w-4 text-muted-foreground" />
                  Allow guest checkout
                </label>
                <p className="text-xs text-muted-foreground">
                  Customers can check out with just an email address without creating a password or signing in first.
                </p>
              </div>
              <Switch
                id="guest-checkout"
                checked={form.guestCheckout}
                onCheckedChange={(checked) => setForm((prev) => ({ ...prev, guestCheckout: Boolean(checked) }))}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
              <div className="space-y-0.5">
                <label htmlFor="phone-required" className="text-sm font-medium text-foreground cursor-pointer flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  Require phone number at checkout
                </label>
                <p className="text-xs text-muted-foreground">
                  Require a mobile phone number for shipping updates and courier delivery verification. Always required for Cash on Delivery (COD).
                </p>
              </div>
              <Switch
                id="phone-required"
                checked={form.phoneRequired}
                onCheckedChange={(checked) => setForm((prev) => ({ ...prev, phoneRequired: Boolean(checked) }))}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3 pt-2">
              <Field
                id="accountCreation"
                label="Account creation prompt"
                hint="When to encourage customers to create an account."
              >
                <SimpleSelect
                  value={form.accountCreation}
                  onChange={(val) => setForm((prev) => ({ ...prev, accountCreation: val as "none" | "after_completed_order" }))}
                  options={[
                    { value: "after_completed_order", label: "On order confirmation page" },
                    { value: "none", label: "Do not prompt" },
                  ]}
                />
              </Field>

              <Field
                id="addressLine2"
                label="Apartment, suite, unit (Line 2)"
                hint="Visibility of optional address details on shipping form."
              >
                <SimpleSelect
                  value={form.addressLine2}
                  onChange={(val) => setForm((prev) => ({ ...prev, addressLine2: val as "hidden" | "optional" }))}
                  options={[
                    { value: "optional", label: "Optional (recommended)" },
                    { value: "hidden", label: "Hidden" },
                  ]}
                />
              </Field>

              <Field
                id="companyName"
                label="Company name"
                hint="Visibility of company / business field."
              >
                <SimpleSelect
                  value={form.companyName}
                  onChange={(val) => setForm((prev) => ({ ...prev, companyName: val as "hidden" | "optional" }))}
                  options={[
                    { value: "hidden", label: "Hidden (default)" },
                    { value: "optional", label: "Optional" },
                  ]}
                />
              </Field>
            </div>
          </div>
        </SettingsSection>

        <SettingsSection
          title="Marketing consent"
          description="Capture email marketing permissions at checkout in compliance with data privacy regulations."
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
              <div className="space-y-0.5">
                <label htmlFor="marketing-enabled" className="text-sm font-medium text-foreground cursor-pointer flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  Email marketing opt-in checkbox
                </label>
                <p className="text-xs text-muted-foreground">
                  Display an opt-in checkbox during checkout for store updates and promotional discounts.
                </p>
              </div>
              <Switch
                id="marketing-enabled"
                checked={form.marketingEmailEnabled}
                onCheckedChange={(checked) => setForm((prev) => ({ ...prev, marketingEmailEnabled: Boolean(checked) }))}
              />
            </div>

            {form.marketingEmailEnabled && (
              <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
                <Field
                  id="marketing-label"
                  label="Opt-in checkbox label"
                  hint="The text customers read before consenting."
                >
                  <Input
                    id="marketing-label"
                    value={form.marketingEmailLabel}
                    maxLength={120}
                    onChange={(e) => setForm((prev) => ({ ...prev, marketingEmailLabel: e.target.value }))}
                  />
                </Field>
              </div>
            )}
          </div>
        </SettingsSection>

        <SettingsSection
          title="Abandoned checkouts"
          description="Recover lost sales by identifying abandoned carts and sending recovery reminders."
        >
          <div className="space-y-4">
            <div className="rounded-md border border-amber-500/20 bg-amber-50/50 p-4 text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/20 dark:text-amber-200">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="text-xs leading-relaxed">
                  <strong>Email delivery notice:</strong> Recovery emails can't be sent until email delivery is enabled for the platform. Settings will be saved and active when email dispatch is live.
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
              <div className="space-y-0.5">
                <label htmlFor="recovery-enabled" className="text-sm font-medium text-foreground cursor-pointer flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  Enable abandoned checkout recovery emails
                </label>
                <p className="text-xs text-muted-foreground">
                  Send automated reminder emails with a recovery link to shoppers who started checkout but did not complete it.
                </p>
              </div>
              <Switch
                id="recovery-enabled"
                checked={form.recoveryEnabled}
                onCheckedChange={(checked) => setForm((prev) => ({ ...prev, recoveryEnabled: Boolean(checked) }))}
              />
            </div>

            <Field
              id="detectAfterMinutes"
              label="Abandonment threshold"
              hint="How long after customer inactivity a checkout is marked as abandoned (15 to 10,080 minutes)."
            >
              <div className="flex items-center gap-2 max-w-xs">
                <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                <Input
                  id="detectAfterMinutes"
                  type="number"
                  min={15}
                  max={10080}
                  value={form.detectAfterMinutes}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!Number.isNaN(val)) {
                      setForm((prev) => ({ ...prev, detectAfterMinutes: Math.min(10080, Math.max(15, val)) }));
                    }
                  }}
                />
                <span className="text-xs text-muted-foreground">minutes</span>
              </div>
            </Field>
          </div>
        </SettingsSection>
      </form>
    </SettingsPageFrame>
  );
}

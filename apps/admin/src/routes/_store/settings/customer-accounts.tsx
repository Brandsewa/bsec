import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { AlertTriangle, ArrowRight, KeyRound, Lock, Phone, RotateCcw, ShieldAlert, UserCheck, XCircle } from "lucide-react";
import { EmptyState, FormSkeleton, PageSkeleton, toast } from "@bs/ui";
import { Badge } from "@bs/ui";
import { Button } from "@bs/ui";
import { Switch } from "@bs/ui";
import { HeaderActions, SettingsPageFrame, SettingsSection, useUnsavedGuard } from "../../../components/settings/settings-page.tsx";
import { orpc } from "../../../lib/orpc.ts";
import { errorMessage } from "../../../lib/errors.ts";

export const Route = createFileRoute("/_store/settings/customer-accounts")({
  pendingComponent: () => <PageSkeleton />,
  component: CustomerAccountSettingsPage,
});

const TITLE = "Customer accounts";
const DESCRIPTION = "Manage customer sign-in methods, storefront navigation links, and self-service portal actions.";

interface CustomerAccountFormState {
  showSignInLinks: boolean;
  emailPasswordEnabled: boolean;
  phoneOtpEnabled: boolean;
  allowSelfServeReturns: boolean;
  allowSelfServeCancellation: boolean;
}

export function CustomerAccountSettingsPage() {
  const query = useQuery(orpc.admin.customerAccountSettings.get.queryOptions());

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
            title="Could not load customer account settings"
            description={errorMessage(query.error)}
            action={<Button onClick={() => void query.refetch()}>Try again</Button>}
          />
        </SettingsSection>
      </SettingsPageFrame>
    );
  }

  return <CustomerAccountSettingsForm initial={query.data} />;
}

function CustomerAccountSettingsForm({
  initial,
}: {
  initial: {
    showSignInLinks: boolean;
    emailPasswordEnabled: boolean;
    phoneOtpEnabled: boolean;
    allowSelfServeReturns: boolean;
    allowSelfServeCancellation: boolean;
    version: number;
  };
}) {
  const queryClient = useQueryClient();

  const [form, setForm] = useState<CustomerAccountFormState>({
    showSignInLinks: initial.showSignInLinks,
    emailPasswordEnabled: initial.emailPasswordEnabled,
    phoneOtpEnabled: initial.phoneOtpEnabled,
    allowSelfServeReturns: initial.allowSelfServeReturns,
    allowSelfServeCancellation: initial.allowSelfServeCancellation,
  });

  const dirty =
    form.showSignInLinks !== initial.showSignInLinks ||
    form.emailPasswordEnabled !== initial.emailPasswordEnabled ||
    form.phoneOtpEnabled !== initial.phoneOtpEnabled ||
    form.allowSelfServeReturns !== initial.allowSelfServeReturns ||
    form.allowSelfServeCancellation !== initial.allowSelfServeCancellation;

  const noLoginMethodSelected = !form.emailPasswordEnabled && !form.phoneOtpEnabled;

  const guard = useUnsavedGuard(dirty);

  const update = useMutation(
    orpc.admin.customerAccountSettings.update.mutationOptions({
      onSuccess: () => {
        toast.success("Customer account settings saved");
        void queryClient.invalidateQueries({ queryKey: orpc.admin.customerAccountSettings.key() });
      },
      onError: (err) => toast.error(errorMessage(err)),
    }),
  );

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (noLoginMethodSelected) {
      toast.error("At least one customer sign-in method must be enabled.");
      return;
    }

    update.mutate({
      showSignInLinks: form.showSignInLinks,
      emailPasswordEnabled: form.emailPasswordEnabled,
      phoneOtpEnabled: form.phoneOtpEnabled,
      allowSelfServeReturns: form.allowSelfServeReturns,
      allowSelfServeCancellation: form.allowSelfServeCancellation,
      expectedVersion: initial.version,
    });
  }

  return (
    <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
      {guard}
      <HeaderActions>
        <Button
          type="submit"
          form="settings-customer-accounts"
          disabled={update.isPending || !dirty || noLoginMethodSelected}
        >
          {update.isPending ? "Saving…" : "Save changes"}
        </Button>
      </HeaderActions>

      <form id="settings-customer-accounts" onSubmit={onSubmit} className="space-y-6">
        <SettingsSection
          title="Storefront links"
          description="Control whether login and account links are visible to shoppers on your storefront."
        >
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
            <div className="space-y-0.5">
              <label htmlFor="show-signin" className="text-sm font-medium text-foreground cursor-pointer flex items-center gap-2">
                <UserCheck className="h-4 w-4 text-muted-foreground" />
                Show sign-in links in header
              </label>
              <p className="text-xs text-muted-foreground">
                Display "Sign in" or account links in the storefront navigation header and checkout prompt.
              </p>
            </div>
            <Switch
              id="show-signin"
              checked={form.showSignInLinks}
              onCheckedChange={(checked) => setForm((prev) => ({ ...prev, showSignInLinks: Boolean(checked) }))}
            />
          </div>
        </SettingsSection>

        <SettingsSection
          title="Sign-in methods"
          description="Select which authentication methods customers can use to create an account and sign in."
        >
          <div className="space-y-4">
            {noLoginMethodSelected && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 shrink-0" />
                <span>At least one sign-in method must remain enabled to prevent customer lockout.</span>
              </div>
            )}

            <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
              <div className="space-y-0.5">
                <label htmlFor="email-password" className="text-sm font-medium text-foreground cursor-pointer flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-muted-foreground" />
                  Email and password
                </label>
                <p className="text-xs text-muted-foreground">
                  Customers register and sign in with an email address and password. Includes self-service password reset.
                </p>
              </div>
              <Switch
                id="email-password"
                checked={form.emailPasswordEnabled}
                onCheckedChange={(checked) => setForm((prev) => ({ ...prev, emailPasswordEnabled: Boolean(checked) }))}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
              <div className="space-y-0.5">
                <label htmlFor="phone-otp" className="text-sm font-medium text-foreground cursor-pointer flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  Phone number (SMS OTP)
                </label>
                <p className="text-xs text-muted-foreground">
                  Customers sign in with a mobile number and a one-time verification code sent via SMS.
                </p>
              </div>
              <Switch
                id="phone-otp"
                checked={form.phoneOtpEnabled}
                onCheckedChange={(checked) => setForm((prev) => ({ ...prev, phoneOtpEnabled: Boolean(checked) }))}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border border-border/50 bg-muted/30 p-4 opacity-75">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">Social sign-in (Google, Facebook)</span>
                  <Badge variant="outline" className="text-[10px] font-medium py-0 px-1.5 text-muted-foreground">
                    Not available yet
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  One-tap social login with Google and Facebook will be available in an upcoming platform release.
                </p>
              </div>
              <Switch disabled checked={false} aria-label="Social sign-in not available" />
            </div>
          </div>
        </SettingsSection>

        <SettingsSection
          title="Customer self-service"
          description="Allow customers to manage their own orders from the order confirmation and tracking page."
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
              <div className="space-y-0.5">
                <label htmlFor="self-serve-returns" className="text-sm font-medium text-foreground cursor-pointer flex items-center gap-2">
                  <RotateCcw className="h-4 w-4 text-muted-foreground" />
                  Allow self-service return requests
                </label>
                <p className="text-xs text-muted-foreground">
                  Eligible customers can submit return or exchange requests directly from their order page.
                </p>
              </div>
              <Switch
                id="self-serve-returns"
                checked={form.allowSelfServeReturns}
                onCheckedChange={(checked) => setForm((prev) => ({ ...prev, allowSelfServeReturns: Boolean(checked) }))}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
              <div className="space-y-0.5">
                <label htmlFor="self-serve-cancellation" className="text-sm font-medium text-foreground cursor-pointer flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-muted-foreground" />
                  Allow self-service order cancellation
                </label>
                <p className="text-xs text-muted-foreground">
                  Customers can cancel unpaid or COD orders before they are marked as packed or shipped.
                </p>
              </div>
              <Switch
                id="self-serve-cancellation"
                checked={form.allowSelfServeCancellation}
                onCheckedChange={(checked) => setForm((prev) => ({ ...prev, allowSelfServeCancellation: Boolean(checked) }))}
              />
            </div>

            <div className="rounded-md border bg-muted/40 p-3 flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                Return window and reasons are configured in Returns settings.
              </div>
              <Link
                to="/settings/returns"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                Go to Returns settings
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </SettingsSection>
      </form>
    </SettingsPageFrame>
  );
}

import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { AlertTriangle } from "lucide-react";
import { EmptyState, FormSkeleton, PageSkeleton, toast } from "@bs/ui";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "../../../components/confirm-dialog.tsx";
import { Field } from "../../../components/field.tsx";
import { SettingsPageFrame, SettingsSection, useUnsavedGuard } from "../../../components/settings/settings-page.tsx";
import { orpc } from "../../../lib/orpc.ts";
import { errorMessage } from "../../../lib/errors.ts";

export const Route = createFileRoute("/_store/settings/payments")({
  pendingComponent: () => <PageSkeleton />,
  component: PaymentsSettingsPage,
});

const TITLE = "Payments";
const DESCRIPTION = "Choose how customers can pay and connect your own payment gateway.";

export function PaymentsSettingsPage() {
  const status = useQuery(orpc.admin.payments.get.queryOptions());
  const { store } = useRouteContext({ from: "/_store" });
  // ADR-020: gateway credentials are owner-only; others see status, not the form.
  const canManageCredentials = (store?.permissions ?? []).includes("payments.manage");

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
            title="Could not load payment settings"
            description={errorMessage(status.error)}
            action={<Button onClick={() => void status.refetch()}>Try again</Button>}
          />
        </SettingsSection>
      </SettingsPageFrame>
    );
  }

  return (
    <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
      {!status.data.encryptionKeyConfigured ? (
        <SettingsSection>
          <Alert role="alert">
            Saving payment keys is not available yet: the platform operator still has to configure the server encryption key (TENANT_SECRETS_KEY). Cash on delivery settings below work now.
          </Alert>
        </SettingsSection>
      ) : null}
      <CodForm initial={status.data.cod} />
      {canManageCredentials ? (
        <RazorpayForm razorpay={status.data.razorpay} keyMissing={!status.data.encryptionKeyConfigured} />
      ) : (
        <SettingsSection title="Razorpay" description="Payment gateway keys can only be changed by the Store Owner.">
          <p className="text-xs">Status: {status.data.razorpay.configured ? `Connected (key ${status.data.razorpay.keyIdHint ?? ""})` : "Not connected"}</p>
        </SettingsSection>
      )}
    </SettingsPageFrame>
  );
}

function CodForm({ initial }: { initial: { enabled: boolean; feePaise: number } }) {
  const queryClient = useQueryClient();
  const update = useMutation(orpc.admin.settings.update.mutationOptions());
  const [enabled, setEnabled] = useState(initial.enabled);
  const [fee, setFee] = useState(String(initial.feePaise / 100));

  const dirty = enabled !== initial.enabled || fee !== String(initial.feePaise / 100);
  const guard = useUnsavedGuard(dirty);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const rupees = Number(fee);
    if (!Number.isFinite(rupees) || rupees < 0) {
      toast.error("Enter a valid COD fee");
      return;
    }
    update.mutate(
      { cod: { enabled, feePaise: Math.round(rupees * 100) } },
      {
        onSuccess: () => {
          toast.success("Cash on delivery settings saved");
          void queryClient.invalidateQueries({ queryKey: orpc.admin.payments.key() });
          void queryClient.invalidateQueries({ queryKey: orpc.admin.settings.key() });
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  }

  return (
    <SettingsSection title="Cash on delivery" description="Let customers pay when the order arrives.">
      {guard}
      <form onSubmit={onSubmit} className="grid gap-3">
        <label className="flex items-center gap-2 text-xs text-foreground">
          <Checkbox checked={enabled} onCheckedChange={(c) => setEnabled(c)} />
          Accept cash on delivery orders
        </label>
        <div className="max-w-xs">
          <Field id="codFee" label="COD handling fee (₹)" hint="Added to the order total for COD orders. Use 0 for no fee.">
            <Input id="codFee" type="number" min={0} step="0.01" value={fee} disabled={!enabled} onChange={(e) => setFee(e.target.value)} />
          </Field>
        </div>
        <div>
          <Button type="submit" disabled={update.isPending || !dirty}>
            {update.isPending ? "Saving…" : "Save COD settings"}
          </Button>
        </div>
      </form>
    </SettingsSection>
  );
}

function RazorpayForm({
  razorpay,
  keyMissing,
}: {
  razorpay: { configured: boolean; keyIdHint: string | null; hasWebhookSecret: boolean };
  keyMissing: boolean;
}) {
  const queryClient = useQueryClient();
  const save = useMutation(orpc.admin.payments.saveRazorpay.mutationOptions());
  const clear = useMutation(orpc.admin.payments.clearRazorpay.mutationOptions());
  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: orpc.admin.payments.key() });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate(
      { keyId: keyId.trim(), keySecret: keySecret.trim(), ...(webhookSecret.trim() ? { webhookSecret: webhookSecret.trim() } : {}) },
      {
        onSuccess: () => {
          toast.success("Razorpay keys saved");
          setKeyId("");
          setKeySecret("");
          setWebhookSecret("");
          refresh();
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  }

  return (
    <SettingsSection
      title="Razorpay"
      description="Your own Razorpay account receives customer payments directly. Keys are stored encrypted and are never shown again."
    >
      <p className="text-xs">
        Status:{" "}
        <span className={razorpay.configured ? "font-medium text-foreground" : "text-muted-foreground"}>
          {razorpay.configured ? `Connected (key ${razorpay.keyIdHint ?? "saved"})` : "Not connected"}
        </span>
        {razorpay.configured ? <span className="text-muted-foreground"> · webhook secret {razorpay.hasWebhookSecret ? "saved" : "not set"}</span> : null}
      </p>
      <form onSubmit={onSubmit} className="grid gap-3">
        <Field id="keyId" label="Key ID" hint="Looks like rzp_test_… or rzp_live_…">
          <Input id="keyId" autoComplete="off" required value={keyId} disabled={keyMissing} onChange={(e) => setKeyId(e.target.value)} />
        </Field>
        <Field id="keySecret" label="Key secret">
          <Input id="keySecret" type="password" autoComplete="new-password" required value={keySecret} disabled={keyMissing} onChange={(e) => setKeySecret(e.target.value)} />
        </Field>
        <Field id="webhookSecret" label="Webhook secret (optional)" hint="From Razorpay dashboard > Webhooks.">
          <Input id="webhookSecret" type="password" autoComplete="new-password" value={webhookSecret} disabled={keyMissing} onChange={(e) => setWebhookSecret(e.target.value)} />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" disabled={keyMissing || save.isPending || !keyId || !keySecret}>
            {save.isPending ? "Saving…" : razorpay.configured ? "Replace keys" : "Save keys"}
          </Button>
          {razorpay.configured ? (
            <Button type="button" variant="outline" disabled={clear.isPending} onClick={() => setConfirmDisconnect(true)}>
              Disconnect
            </Button>
          ) : null}
        </div>
      </form>

      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title="Disconnect Razorpay?"
        description="Online payments will stop working until you add keys again."
        confirmLabel="Disconnect"
        cancelLabel="Keep connected"
        destructive
        pending={clear.isPending}
        onConfirm={() => {
          setConfirmDisconnect(false);
          clear.mutate(undefined, {
            onSuccess: () => {
              toast.success("Razorpay disconnected");
              refresh();
            },
            onError: (err) => toast.error(errorMessage(err)),
          });
        }}
      />
    </SettingsSection>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { AlertTriangle } from "lucide-react";
import {
  Button,
  EmptyState,
  FormSkeleton,
  Input,
  PageBreadcrumbs,
  PageContainer,
  PageHeader,
  PageSection,
  PageSkeleton,
  toast,
} from "@bs/ui";
import { orpc } from "../../../lib/orpc.ts";
import { errorMessage } from "../../../lib/errors.ts";
import { Field } from "../../../components/field.tsx";

export const Route = createFileRoute("/_store/settings/payments")({
  pendingComponent: () => <PageSkeleton />,
  component: PaymentsSettingsPage,
});

export function PaymentsSettingsPage() {
  const status = useQuery(orpc.admin.payments.get.queryOptions());
  return (
    <PageContainer size="small">
      <PageBreadcrumbs items={[{ label: "Settings" }, { label: "Payments" }]} />
      <PageHeader title="Payments" description="Choose how customers can pay and connect your own payment gateway." />
      {status.isLoading ? (
        <FormSkeleton />
      ) : status.isError || !status.data ? (
        <EmptyState
          icon={AlertTriangle}
          title="Could not load payment settings"
          description={errorMessage(status.error)}
          action={<Button onClick={() => void status.refetch()}>Try again</Button>}
        />
      ) : (
        <div className="grid gap-6">
          {!status.data.encryptionKeyConfigured ? (
            <div role="alert" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
              Saving payment keys is not available yet: the platform operator still has to configure the server encryption key
              (TENANT_SECRETS_KEY). Cash on delivery settings below work now.
            </div>
          ) : null}
          <CodForm initial={status.data.cod} />
          <RazorpayForm razorpay={status.data.razorpay} keyMissing={!status.data.encryptionKeyConfigured} />
        </div>
      )}
    </PageContainer>
  );
}

function CodForm({ initial }: { initial: { enabled: boolean; feePaise: number } }) {
  const queryClient = useQueryClient();
  const update = useMutation(orpc.admin.settings.update.mutationOptions());
  const [enabled, setEnabled] = useState(initial.enabled);
  const [fee, setFee] = useState(String(initial.feePaise / 100));

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
    <PageSection title="Cash on delivery" description="Let customers pay when the order arrives.">
      <form onSubmit={onSubmit} className="grid gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Accept cash on delivery orders
        </label>
        <Field id="codFee" label="COD handling fee (₹)" hint="Added to the order total for COD orders. Use 0 for no fee.">
          <Input id="codFee" type="number" min={0} step="0.01" value={fee} disabled={!enabled} onChange={(e) => setFee(e.target.value)} />
        </Field>
        <div>
          <Button type="submit" disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save COD settings"}
          </Button>
        </div>
      </form>
    </PageSection>
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
    <PageSection
      title="Razorpay"
      description="Your own Razorpay account receives customer payments directly. Keys are stored encrypted and are never shown again."
    >
      <p className="text-sm">
        Status:{" "}
        <span className={razorpay.configured ? "font-medium text-foreground" : "text-foreground-lighter"}>
          {razorpay.configured ? `Connected (key ${razorpay.keyIdHint ?? "saved"})` : "Not connected"}
        </span>
        {razorpay.configured ? (
          <span className="text-foreground-lighter"> · webhook secret {razorpay.hasWebhookSecret ? "saved" : "not set"}</span>
        ) : null}
      </p>
      <form onSubmit={onSubmit} className="grid gap-4">
        <Field id="keyId" label="Key ID" hint="Looks like rzp_test_… or rzp_live_…">
          <Input id="keyId" autoComplete="off" required value={keyId} disabled={keyMissing} onChange={(e) => setKeyId(e.target.value)} />
        </Field>
        <Field id="keySecret" label="Key secret">
          <Input
            id="keySecret"
            type="password"
            autoComplete="new-password"
            required
            value={keySecret}
            disabled={keyMissing}
            onChange={(e) => setKeySecret(e.target.value)}
          />
        </Field>
        <Field id="webhookSecret" label="Webhook secret (optional)" hint="From Razorpay dashboard > Webhooks.">
          <Input
            id="webhookSecret"
            type="password"
            autoComplete="new-password"
            value={webhookSecret}
            disabled={keyMissing}
            onChange={(e) => setWebhookSecret(e.target.value)}
          />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" disabled={keyMissing || save.isPending || !keyId || !keySecret}>
            {save.isPending ? "Saving…" : razorpay.configured ? "Replace keys" : "Save keys"}
          </Button>
          {razorpay.configured ? (
            <Button
              type="button"
              variant="default"
              disabled={clear.isPending}
              onClick={() => {
                if (!window.confirm("Disconnect Razorpay? Online payments will stop working until you add keys again.")) return;
                clear.mutate(undefined, {
                  onSuccess: () => {
                    toast.success("Razorpay disconnected");
                    refresh();
                  },
                  onError: (err) => toast.error(errorMessage(err)),
                });
              }}
            >
              Disconnect
            </Button>
          ) : null}
        </div>
      </form>
    </PageSection>
  );
}

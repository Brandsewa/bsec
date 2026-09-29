import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { AlertTriangle } from "lucide-react";
import { GSTIN_PATTERN } from "@bs/contracts";
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
import { INDIAN_STATES } from "../../../lib/india.ts";
import { Field } from "../../../components/field.tsx";

export const Route = createFileRoute("/_store/settings/taxes")({
  pendingComponent: () => <PageSkeleton />,
  component: TaxSettingsPage,
});

interface TaxValues {
  gstin: string | null;
  sellerState: string | null;
  pricesIncludeTax: boolean;
}

export function TaxSettingsPage() {
  const query = useQuery(orpc.admin.settings.get.queryOptions());
  return (
    <PageContainer size="small">
      <PageBreadcrumbs items={[{ label: "Settings" }, { label: "Taxes" }]} />
      <PageHeader
        title="Taxes"
        description="GST details used on your tax invoices. Your state decides whether a sale is charged CGST + SGST or IGST."
      />
      {query.isLoading ? (
        <FormSkeleton />
      ) : query.isError || !query.data ? (
        <EmptyState
          icon={AlertTriangle}
          title="Could not load tax settings"
          description={errorMessage(query.error)}
          action={<Button onClick={() => void query.refetch()}>Try again</Button>}
        />
      ) : (
        <TaxForm initial={query.data.tax ?? { gstin: null, sellerState: null, pricesIncludeTax: true }} />
      )}
    </PageContainer>
  );
}

function TaxForm({ initial }: { initial: TaxValues }) {
  const queryClient = useQueryClient();
  const update = useMutation(orpc.admin.settings.update.mutationOptions());
  const [gstin, setGstin] = useState(initial.gstin ?? "");
  const [sellerState, setSellerState] = useState(initial.sellerState ?? "");
  const [pricesIncludeTax, setPricesIncludeTax] = useState(initial.pricesIncludeTax);
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const g = gstin.trim().toUpperCase();
    if (g && !GSTIN_PATTERN.test(g)) {
      setError("Enter a valid 15-character GSTIN, for example 29ABCDE1234F1Z5.");
      return;
    }
    setError(null);
    update.mutate(
      { tax: { gstin: g || null, sellerState: sellerState || null, pricesIncludeTax } },
      {
        onSuccess: () => {
          toast.success("Tax settings saved");
          void queryClient.invalidateQueries({ queryKey: orpc.admin.settings.key() });
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-6">
      {!initial.sellerState ? (
        <div role="alert" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          Your state is not set, so invoices assume Delhi. Choose your state below so CGST/SGST and IGST are calculated
          correctly.
        </div>
      ) : null}
      <PageSection title="GST registration">
        <div className="grid gap-4">
          <Field id="gstin" label="GSTIN" hint="Leave blank if you are not GST registered.">
            <Input
              id="gstin"
              maxLength={15}
              autoCapitalize="characters"
              value={gstin}
              onChange={(e) => setGstin(e.target.value.toUpperCase())}
              aria-invalid={Boolean(error)}
            />
            {error ? (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </Field>
          <Field id="sellerState" label="Your state (place of supply)" hint="The state your GST registration is in.">
            <select
              id="sellerState"
              className="h-9 w-full rounded-md border border-border-control bg-control px-3 text-sm"
              value={sellerState}
              onChange={(e) => setSellerState(e.target.value)}
            >
              <option value="">Select state</option>
              {INDIAN_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </PageSection>

      <PageSection title="Pricing">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={pricesIncludeTax} onChange={(e) => setPricesIncludeTax(e.target.checked)} />
          Product prices already include GST
        </label>
        <p className="text-xs text-foreground-lighter">
          When on, the invoice splits the price you charge into taxable value and GST. When off, GST is added on top.
        </p>
      </PageSection>

      <div className="flex justify-end">
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

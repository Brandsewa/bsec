import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { AlertTriangle } from "lucide-react";
import { GSTIN_PATTERN } from "@bs/contracts";
import { EmptyState, FormSkeleton, PageSkeleton, toast } from "@bs/ui";
import { Alert } from "@bs/ui";
import { Button } from "@bs/ui";
import { Checkbox } from "@bs/ui";
import { FieldError } from "@bs/ui";
import { Input } from "@bs/ui";
import { Field } from "../../../components/field.tsx";
import { HeaderActions, SettingsPageFrame, SettingsSection, useUnsavedGuard } from "../../../components/settings/settings-page.tsx";
import { SimpleSelect } from "../../../components/simple-select.tsx";
import { orpc } from "../../../lib/orpc.ts";
import { errorMessage } from "../../../lib/errors.ts";
import { INDIAN_STATES } from "../../../lib/india.ts";

export const Route = createFileRoute("/_store/settings/taxes")({
  pendingComponent: () => <PageSkeleton />,
  component: TaxSettingsPage,
});

interface TaxValues {
  gstin: string | null;
  sellerState: string | null;
  pricesIncludeTax: boolean;
}

const TITLE = "Taxes";
const DESCRIPTION = "GST details used on your tax invoices. Your state decides whether a sale is charged CGST + SGST or IGST.";

export function TaxSettingsPage() {
  const query = useQuery(orpc.admin.settings.get.queryOptions());

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
            title="Could not load tax settings"
            description={errorMessage(query.error)}
            action={<Button onClick={() => void query.refetch()}>Try again</Button>}
          />
        </SettingsSection>
      </SettingsPageFrame>
    );
  }
  return <TaxForm initial={query.data.tax ?? { gstin: null, sellerState: null, pricesIncludeTax: true }} />;
}

function TaxForm({ initial }: { initial: TaxValues }) {
  const queryClient = useQueryClient();
  const update = useMutation(orpc.admin.settings.update.mutationOptions());
  const [gstin, setGstin] = useState(initial.gstin ?? "");
  const [sellerState, setSellerState] = useState(initial.sellerState ?? "");
  const [pricesIncludeTax, setPricesIncludeTax] = useState(initial.pricesIncludeTax);
  const [error, setError] = useState<string | null>(null);

  const dirty = gstin !== (initial.gstin ?? "") || sellerState !== (initial.sellerState ?? "") || pricesIncludeTax !== initial.pricesIncludeTax;
  const guard = useUnsavedGuard(dirty);

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
    <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
      {guard}
      <HeaderActions>
        <Button type="submit" form="settings-taxes" disabled={update.isPending || !dirty}>
          {update.isPending ? "Saving…" : "Save changes"}
        </Button>
      </HeaderActions>

      <form id="settings-taxes" onSubmit={onSubmit}>
        {!initial.sellerState ? (
          <SettingsSection>
            <Alert role="alert">
              Your state is not set, so invoices assume Delhi. Choose your state below so CGST/SGST and IGST are calculated correctly.
            </Alert>
          </SettingsSection>
        ) : null}

        <SettingsSection title="GST registration">
          <Field id="gstin" label="GSTIN" hint="Leave blank if you are not GST registered.">
            <Input id="gstin" maxLength={15} autoCapitalize="characters" value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} aria-invalid={Boolean(error)} />
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
          <Field id="sellerState" label="Your state (place of supply)" hint="The state your GST registration is in.">
            <SimpleSelect id="sellerState" value={sellerState} placeholder="Select state" onChange={setSellerState} options={INDIAN_STATES.map((s) => ({ value: s, label: s }))} />
          </Field>
        </SettingsSection>

        <SettingsSection title="Pricing">
          <label className="flex items-center gap-2 text-xs text-foreground">
            <Checkbox checked={pricesIncludeTax} onCheckedChange={(c) => setPricesIncludeTax(c)} />
            Product prices already include GST
          </label>
          <p className="text-muted-foreground">When on, the invoice splits the price you charge into taxable value and GST. When off, GST is added on top.</p>
        </SettingsSection>
      </form>
    </SettingsPageFrame>
  );
}

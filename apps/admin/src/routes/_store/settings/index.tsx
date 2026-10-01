import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { AlertTriangle } from "lucide-react";
import { EmptyState, FormSkeleton, PageSkeleton, toast } from "@bs/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HeaderActions, SettingsPageFrame, SettingsSection, useUnsavedGuard } from "../../../components/settings/settings-page.tsx";
import { Field } from "../../../components/field.tsx";
import { SimpleSelect } from "../../../components/simple-select.tsx";
import { orpc } from "../../../lib/orpc.ts";
import { errorMessage } from "../../../lib/errors.ts";
import { INDIAN_STATES } from "../../../lib/india.ts";

export const Route = createFileRoute("/_store/settings/")({
  pendingComponent: () => <PageSkeleton />,
  component: GeneralSettingsPage,
});

interface FormState {
  storeName: string;
  legalName: string;
  supportEmail: string;
  supportPhone: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
  orderPrefix: string;
}

interface SettingsData {
  storeName: string;
  legalName?: string | null | undefined;
  supportEmail?: string | null | undefined;
  supportPhone?: string | null | undefined;
  address?:
    | {
        line1?: string | undefined;
        line2?: string | undefined;
        city?: string | undefined;
        state?: string | undefined;
        pincode?: string | undefined;
      }
    | null
    | undefined;
  orderPrefix?: string | undefined;
  currency: string;
  timezone: string;
}

function toFormState(s: SettingsData): FormState {
  return {
    storeName: s.storeName,
    legalName: s.legalName ?? "",
    supportEmail: s.supportEmail ?? "",
    supportPhone: s.supportPhone ?? "",
    line1: s.address?.line1 ?? "",
    line2: s.address?.line2 ?? "",
    city: s.address?.city ?? "",
    state: s.address?.state ?? "",
    pincode: s.address?.pincode ?? "",
    orderPrefix: s.orderPrefix ?? "#",
  };
}

const TITLE = "General";
const DESCRIPTION = "Your store name, contact details and address. These appear on invoices and emails.";

export function GeneralSettingsPage() {
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
            title="Could not load settings"
            description={errorMessage(query.error)}
            action={<Button onClick={() => void query.refetch()}>Try again</Button>}
          />
        </SettingsSection>
      </SettingsPageFrame>
    );
  }
  return <GeneralForm data={query.data} />;
}

function GeneralForm({ data }: { data: SettingsData }) {
  const queryClient = useQueryClient();
  const update = useMutation(orpc.admin.settings.update.mutationOptions());
  const baseline = toFormState(data);
  const [form, setForm] = useState<FormState>(baseline);
  const set = (k: keyof FormState) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);
  const guard = useUnsavedGuard(dirty);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const address = {
      ...(form.line1 ? { line1: form.line1 } : {}),
      ...(form.line2 ? { line2: form.line2 } : {}),
      ...(form.city ? { city: form.city } : {}),
      ...(form.state ? { state: form.state } : {}),
      ...(form.pincode ? { pincode: form.pincode } : {}),
    };
    update.mutate(
      {
        storeName: form.storeName.trim(),
        legalName: form.legalName.trim() || null,
        supportEmail: form.supportEmail.trim() || null,
        supportPhone: form.supportPhone.trim() || null,
        address: Object.keys(address).length ? address : null,
        orderPrefix: form.orderPrefix || "#",
      },
      {
        onSuccess: () => {
          toast.success("Store settings saved");
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
        <Button type="submit" form="settings-general" disabled={update.isPending || !dirty || !form.storeName.trim()}>
          {update.isPending ? "Saving…" : "Save changes"}
        </Button>
      </HeaderActions>

      <form id="settings-general" onSubmit={onSubmit}>
        <SettingsSection title="Store details">
          <Field id="storeName" label="Store name">
            <Input id="storeName" required maxLength={120} value={form.storeName} onChange={set("storeName")} />
          </Field>
          <Field id="legalName" label="Legal business name" hint="Printed on tax invoices.">
            <Input id="legalName" maxLength={200} value={form.legalName} onChange={set("legalName")} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="supportEmail" label="Support email">
              <Input id="supportEmail" type="email" value={form.supportEmail} onChange={set("supportEmail")} />
            </Field>
            <Field id="supportPhone" label="Support phone">
              <Input id="supportPhone" type="tel" value={form.supportPhone} onChange={set("supportPhone")} />
            </Field>
          </div>
        </SettingsSection>

        <SettingsSection title="Business address" description="Your registered or dispatch address.">
          <Field id="line1" label="Address line 1">
            <Input id="line1" value={form.line1} onChange={set("line1")} />
          </Field>
          <Field id="line2" label="Address line 2">
            <Input id="line2" value={form.line2} onChange={set("line2")} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field id="city" label="City">
              <Input id="city" value={form.city} onChange={set("city")} />
            </Field>
            <Field id="state" label="State">
              <SimpleSelect id="state" value={form.state} placeholder="Select state" onChange={(v) => setForm((f) => ({ ...f, state: v }))} options={INDIAN_STATES.map((s) => ({ value: s, label: s }))} />
            </Field>
            <Field id="pincode" label="PIN code">
              <Input id="pincode" inputMode="numeric" maxLength={6} value={form.pincode} onChange={set("pincode")} />
            </Field>
          </div>
        </SettingsSection>

        <SettingsSection title="Orders and currency">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field id="orderPrefix" label="Order number prefix" hint="For example # or ORD-.">
              <Input id="orderPrefix" maxLength={10} value={form.orderPrefix} onChange={set("orderPrefix")} />
            </Field>
            <Field id="currency" label="Currency">
              <Input id="currency" disabled readOnly value={data.currency} />
            </Field>
            <Field id="timezone" label="Time zone">
              <Input id="timezone" disabled readOnly value={data.timezone} />
            </Field>
          </div>
        </SettingsSection>
      </form>
    </SettingsPageFrame>
  );
}

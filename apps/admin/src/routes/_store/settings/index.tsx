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
import { INDIAN_STATES } from "../../../lib/india.ts";
import { Field } from "../../../components/field.tsx";

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

export function GeneralSettingsPage() {
  const query = useQuery(orpc.admin.settings.get.queryOptions());
  return (
    <PageContainer size="small">
      <PageBreadcrumbs items={[{ label: "Settings" }, { label: "General" }]} />
      <PageHeader title="General" description="Your store name, contact details and address. These appear on invoices and emails." />
      {query.isLoading ? (
        <FormSkeleton />
      ) : query.isError || !query.data ? (
        <EmptyState
          icon={AlertTriangle}
          title="Could not load settings"
          description={errorMessage(query.error)}
          action={<Button onClick={() => void query.refetch()}>Try again</Button>}
        />
      ) : (
        <GeneralForm data={query.data} />
      )}
    </PageContainer>
  );
}

function GeneralForm({ data }: { data: SettingsData }) {
  const queryClient = useQueryClient();
  const update = useMutation(orpc.admin.settings.update.mutationOptions());
  const [form, setForm] = useState<FormState>(() => toFormState(data));
  const set = (k: keyof FormState) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

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
    <form onSubmit={onSubmit} className="grid gap-6">
      <PageSection title="Store details">
        <div className="grid gap-4">
          <Field id="storeName" label="Store name">
            <Input id="storeName" required maxLength={120} value={form.storeName} onChange={set("storeName")} />
          </Field>
          <Field id="legalName" label="Legal business name" hint="Printed on tax invoices.">
            <Input id="legalName" maxLength={200} value={form.legalName} onChange={set("legalName")} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="supportEmail" label="Support email">
              <Input id="supportEmail" type="email" value={form.supportEmail} onChange={set("supportEmail")} />
            </Field>
            <Field id="supportPhone" label="Support phone">
              <Input id="supportPhone" type="tel" value={form.supportPhone} onChange={set("supportPhone")} />
            </Field>
          </div>
        </div>
      </PageSection>

      <PageSection title="Business address" description="Your registered or dispatch address.">
        <div className="grid gap-4">
          <Field id="line1" label="Address line 1">
            <Input id="line1" value={form.line1} onChange={set("line1")} />
          </Field>
          <Field id="line2" label="Address line 2">
            <Input id="line2" value={form.line2} onChange={set("line2")} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="city" label="City">
              <Input id="city" value={form.city} onChange={set("city")} />
            </Field>
            <Field id="state" label="State">
              <select
                id="state"
                className="h-9 w-full rounded-md border border-border-control bg-control px-3 text-sm"
                value={form.state}
                onChange={set("state")}
              >
                <option value="">Select state</option>
                {INDIAN_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="pincode" label="PIN code">
              <Input id="pincode" inputMode="numeric" maxLength={6} value={form.pincode} onChange={set("pincode")} />
            </Field>
          </div>
        </div>
      </PageSection>

      <PageSection title="Orders and currency">
        <div className="grid gap-4 sm:grid-cols-3">
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
      </PageSection>

      <div className="flex justify-end">
        <Button type="submit" disabled={update.isPending || !form.storeName.trim()}>
          {update.isPending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

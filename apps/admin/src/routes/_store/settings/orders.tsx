import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { AlertTriangle, Hash } from "lucide-react";
import { EmptyState, FormSkeleton, PageSkeleton, toast } from "@bs/ui";
import { Button } from "@bs/ui";
import { Input } from "@bs/ui";
import { Field } from "../../../components/field.tsx";
import { HeaderActions, SettingsPageFrame, SettingsSection, useUnsavedGuard } from "../../../components/settings/settings-page.tsx";
import { orpc } from "../../../lib/orpc.ts";
import { errorMessage } from "../../../lib/errors.ts";

export const Route = createFileRoute("/_store/settings/orders")({
  pendingComponent: () => <PageSkeleton />,
  component: OrderSettingsPage,
});

interface OrderSettingsFormState {
  prefix: string;
  padding: number;
  nextValue: number;
}

const TITLE = "Order settings";
const DESCRIPTION = "Customise order numbering and processing rules.";

export function OrderSettingsPage() {
  const query = useQuery(orpc.admin.orderSettings.get.queryOptions());

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
            title="Could not load order settings"
            description={errorMessage(query.error)}
            action={<Button onClick={() => void query.refetch()}>Try again</Button>}
          />
        </SettingsSection>
      </SettingsPageFrame>
    );
  }

  return <OrderSettingsForm initial={query.data} />;
}

function OrderSettingsForm({
  initial,
}: {
  initial: {
    prefix: string;
    padding: number;
    nextValue: number;
    currentNextValue: number;
  };
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<OrderSettingsFormState>({
    prefix: initial.prefix,
    padding: initial.padding,
    nextValue: initial.nextValue,
  });

  const dirty =
    form.prefix !== initial.prefix ||
    form.padding !== initial.padding ||
    form.nextValue !== initial.nextValue;

  const guard = useUnsavedGuard(dirty);

  const update = useMutation(
    orpc.admin.orderSettings.update.mutationOptions({
      onSuccess: () => {
        toast.success("Order settings saved");
        void queryClient.invalidateQueries({ queryKey: orpc.admin.orderSettings.key() });
      },
      onError: (err) => toast.error(errorMessage(err)),
    }),
  );

  const preview = `${form.prefix}${String(Math.max(1, form.nextValue || 1)).padStart(form.padding || 5, "0")}`;
  const isLowerThanCurrent = form.nextValue < initial.currentNextValue;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (isLowerThanCurrent) {
      toast.error(`Next order number cannot be lower than ${initial.currentNextValue}.`);
      return;
    }
    update.mutate({
      prefix: form.prefix,
      padding: form.padding,
      nextValue: form.nextValue,
    });
  }

  return (
    <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
      {guard}
      <HeaderActions>
        <Button
          type="submit"
          form="settings-orders"
          disabled={update.isPending || !dirty || isLowerThanCurrent}
        >
          {update.isPending ? "Saving…" : "Save changes"}
        </Button>
      </HeaderActions>

      <form id="settings-orders" onSubmit={onSubmit}>
        <SettingsSection
          title="Order numbers"
          description="Prefix and digits applied to new orders placed online or created in the store admin. Existing orders are never renumbered."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Field
              id="prefix"
              label="Prefix"
              hint="0 to 10 characters (letters, numbers, #, -, _, /)."
            >
              <Input
                id="prefix"
                maxLength={10}
                value={form.prefix}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^A-Za-z0-9#\-_/]/g, "");
                  setForm((f) => ({ ...f, prefix: val }));
                }}
              />
            </Field>

            <Field
              id="digits"
              label="Digits (padding)"
              hint="Zero-padding length (3 to 8 digits)."
            >
              <Input
                id="digits"
                type="number"
                min={3}
                max={8}
                value={form.padding}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!Number.isNaN(val)) {
                    setForm((f) => ({ ...f, padding: Math.min(8, Math.max(3, val)) }));
                  }
                }}
              />
            </Field>

            <Field
              id="nextValue"
              label="Next order number"
              hint={`Current next is ${initial.currentNextValue}. May only be raised.`}
              error={isLowerThanCurrent ? `Cannot be lower than ${initial.currentNextValue}` : undefined}
            >
              <Input
                id="nextValue"
                type="number"
                min={initial.currentNextValue}
                value={form.nextValue}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!Number.isNaN(val)) {
                    setForm((f) => ({ ...f, nextValue: val }));
                  }
                }}
              />
            </Field>
          </div>

          <div className="mt-4 rounded-md border bg-muted/40 p-4">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Hash className="h-4 w-4" />
              Live preview
            </div>
            <p className="mt-1 text-sm">
              Your next order will be{" "}
              <code className="rounded bg-background px-2 py-0.5 font-mono font-semibold text-foreground border">
                {preview}
              </code>
            </p>
          </div>
        </SettingsSection>
      </form>
    </SettingsPageFrame>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { EmptyState, FormSkeleton, PageSkeleton, toast } from "@bs/ui";
import { Button } from "@bs/ui";
import { Checkbox } from "@bs/ui";
import { Input } from "@bs/ui";
import { Textarea } from "@bs/ui";
import { SimpleSelect } from "../../../components/simple-select.tsx";
import { Field } from "../../../components/field.tsx";
import { HeaderActions, SettingsPageFrame, SettingsSection, useUnsavedGuard } from "../../../components/settings/settings-page.tsx";
import { orpc } from "../../../lib/orpc.ts";
import { errorMessage } from "../../../lib/errors.ts";

export const Route = createFileRoute("/_store/settings/returns")({
  pendingComponent: () => <PageSkeleton />,
  component: ReturnSettingsPage,
});

interface ReasonItem {
  id: string;
  label: string;
  photoRequirement: "required" | "optional" | "not_asked";
}

interface ReturnSettingsFormState {
  acceptReturns: boolean;
  allowExchanges: boolean;
  returnWindowDays: number;
  reasons: ReasonItem[];
  instructions: string;
  policyText: string;
}

const TITLE = "Return & exchange settings";
const DESCRIPTION = "Manage return window, reasons, photo requirements, and policy instructions.";

export function ReturnSettingsPage() {
  const query = useQuery(orpc.admin.returnSettings.get.queryOptions());

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
            title="Could not load return settings"
            description={errorMessage(query.error)}
            action={<Button onClick={() => void query.refetch()}>Try again</Button>}
          />
        </SettingsSection>
      </SettingsPageFrame>
    );
  }

  return <ReturnSettingsForm initial={query.data} />;
}

function ReturnSettingsForm({
  initial,
}: {
  initial: {
    acceptReturns: boolean;
    allowExchanges: boolean;
    returnWindowDays: number;
    reasons: ReasonItem[];
    instructions: string;
    policyText: string;
  };
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ReturnSettingsFormState>({
    acceptReturns: initial.acceptReturns,
    allowExchanges: initial.allowExchanges,
    returnWindowDays: initial.returnWindowDays,
    reasons: initial.reasons,
    instructions: initial.instructions,
    policyText: initial.policyText,
  });

  const dirty =
    form.acceptReturns !== initial.acceptReturns ||
    form.allowExchanges !== initial.allowExchanges ||
    form.returnWindowDays !== initial.returnWindowDays ||
    form.instructions !== initial.instructions ||
    form.policyText !== initial.policyText ||
    JSON.stringify(form.reasons) !== JSON.stringify(initial.reasons);

  const guard = useUnsavedGuard(dirty);

  const update = useMutation(
    orpc.admin.returnSettings.update.mutationOptions({
      onSuccess: () => {
        toast.success("Return settings saved");
        void queryClient.invalidateQueries({ queryKey: orpc.admin.returnSettings.key() });
      },
      onError: (err) => toast.error(errorMessage(err)),
    }),
  );

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (form.returnWindowDays < 1 || form.returnWindowDays > 90) {
      toast.error("Return window must be between 1 and 90 days.");
      return;
    }
    if (form.reasons.length === 0) {
      toast.error("At least one return reason is required.");
      return;
    }
    update.mutate(form);
  }

  function addReason() {
    if (form.reasons.length >= 12) {
      toast.error("You can add at most 12 return reasons.");
      return;
    }
    const newReason: ReasonItem = {
      id: crypto.randomUUID().slice(0, 8),
      label: "",
      photoRequirement: "optional",
    };
    setForm((prev) => ({ ...prev, reasons: [...prev.reasons, newReason] }));
  }

  function removeReason(index: number) {
    if (form.reasons.length <= 1) {
      toast.error("You need at least one return reason.");
      return;
    }
    setForm((prev) => ({
      ...prev,
      reasons: prev.reasons.filter((_, i) => i !== index),
    }));
  }

  function updateReason(index: number, patch: Partial<ReasonItem>) {
    setForm((prev) => ({
      ...prev,
      reasons: prev.reasons.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    }));
  }

  return (
    <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
      {guard}
      <HeaderActions>
        <Button
          type="submit"
          form="settings-returns"
          disabled={update.isPending || !dirty}
        >
          {update.isPending ? "Saving…" : "Save changes"}
        </Button>
      </HeaderActions>

      <form id="settings-returns" onSubmit={onSubmit} className="space-y-6">
        <SettingsSection
          title="Policy & Rules"
          description="Control whether customer self-service return and exchange requests are enabled and set the eligibility window."
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
              <div className="space-y-0.5">
                <label htmlFor="accept-returns" className="text-sm font-medium text-foreground cursor-pointer">
                  Accept return requests
                </label>
                <p className="text-xs text-muted-foreground">
                  Allow customers to submit return and replacement requests from their order status page.
                </p>
              </div>
              <Checkbox
                id="accept-returns"
                checked={form.acceptReturns}
                onCheckedChange={(checked) => setForm((prev) => ({ ...prev, acceptReturns: Boolean(checked) }))}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
              <div className="space-y-0.5">
                <label htmlFor="allow-exchanges" className="text-sm font-medium text-foreground cursor-pointer">
                  Allow product exchanges
                </label>
                <p className="text-xs text-muted-foreground">
                  Give customers the option to request an exchange for a different variant or item.
                </p>
              </div>
              <Checkbox
                id="allow-exchanges"
                checked={form.allowExchanges}
                disabled={!form.acceptReturns}
                onCheckedChange={(checked) => setForm((prev) => ({ ...prev, allowExchanges: Boolean(checked) }))}
              />
            </div>

            <Field
              id="returnWindowDays"
              label="Return window (days)"
              hint="How many days after order delivery a customer can request a return or exchange."
            >
              <div className="max-w-xs">
                <Input
                  id="returnWindowDays"
                  type="number"
                  min={1}
                  max={90}
                  value={form.returnWindowDays}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, returnWindowDays: Number(e.target.value) || 1 }))
                  }
                />
              </div>
            </Field>
          </div>
        </SettingsSection>

        <SettingsSection
          title="Return Reasons & Photo Rules"
          description="Customise the reasons customers can pick from and whether photo proof is required."
        >
          <div className="space-y-3">
            {form.reasons.map((reason, index) => (
              <div key={reason.id} className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center">
                <div className="flex-1">
                  <Input
                    placeholder="Reason (e.g. Damaged or defective)"
                    maxLength={60}
                    value={reason.label}
                    onChange={(e) => updateReason(index, { label: e.target.value })}
                  />
                </div>
                <div className="w-full sm:w-48">
                  <SimpleSelect
                    value={reason.photoRequirement}
                    onChange={(val) =>
                      updateReason(index, {
                        photoRequirement: val as "required" | "optional" | "not_asked",
                      })
                    }
                    options={[
                      { value: "required", label: "Photo required" },
                      { value: "optional", label: "Photo optional" },
                      { value: "not_asked", label: "No photo asked" },
                    ]}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10"
                  onClick={() => removeReason(index)}
                  disabled={form.reasons.length <= 1}
                  aria-label={`Remove reason ${reason.label || index + 1}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}

            {form.reasons.length < 12 && (
              <Button type="button" variant="outline" size="sm" onClick={addReason} className="mt-2">
                <Plus className="mr-1.5 h-4 w-4" /> Add reason
              </Button>
            )}
          </div>
        </SettingsSection>

        <SettingsSection
          title="Customer Instructions & Policy Copy"
          description="Custom instructions and policy text displayed on the customer-facing return portal."
        >
          <div className="space-y-4">
            <Field
              id="instructions"
              label="Return instructions (sent upon approval)"
              hint="Included in the approval message and visible to customers after you approve their return."
            >
              <Textarea
                id="instructions"
                rows={3}
                maxLength={1000}
                placeholder="e.g. Please keep all original tags intact and hand the package over in its original box."
                value={form.instructions}
                onChange={(e) => setForm((prev) => ({ ...prev, instructions: e.target.value }))}
              />
            </Field>

            <Field
              id="policyText"
              label="Policy summary (shown on request form)"
              hint="Brief policy highlights displayed to the customer before submitting a request."
            >
              <Textarea
                id="policyText"
                rows={3}
                maxLength={1000}
                placeholder="e.g. Items can be returned within 7 days of delivery. Refunds are processed within 3 business days of receipt."
                value={form.policyText}
                onChange={(e) => setForm((prev) => ({ ...prev, policyText: e.target.value }))}
              />
            </Field>
          </div>
        </SettingsSection>
      </form>
    </SettingsPageFrame>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { GSTIN_PATTERN, type TaxClassItem } from "@bs/contracts";
import { EmptyState, FormSkeleton, PageSkeleton, toast } from "@bs/ui";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "../../../components/confirm-dialog.tsx";
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

const TITLE = "Taxes";
const DESCRIPTION = "GST details used on your tax invoices. Your state decides whether a sale is charged CGST + SGST or IGST.";

const GST_RATES = [
  { value: "0", label: "0% (Exempt / Nil rated)" },
  { value: "250", label: "2.5% (Precious metals)" },
  { value: "300", label: "3% (Gold / Jewellery)" },
  { value: "500", label: "5% (Essential items)" },
  { value: "1200", label: "12% (Standard lower)" },
  { value: "1800", label: "18% (Standard)" },
  { value: "2800", label: "28% (Luxury / Sin goods)" },
];

export function TaxSettingsPage() {
  const query = useQuery(orpc.admin.taxSettings.get.queryOptions());

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

  return <TaxForm initial={query.data} />;
}

interface TaxData {
  taxCollection: boolean;
  gstin: string | null;
  sellerState: string | null;
  pricesIncludeTax: boolean;
  shippingTax: "highest_line_rate" | "none";
  defaultTaxClassId?: string | null | undefined;
  classes: TaxClassItem[];
  version: number;
}

function TaxForm({ initial }: { initial: TaxData }) {
  const queryClient = useQueryClient();
  const update = useMutation(orpc.admin.taxSettings.update.mutationOptions());

  const [taxCollection, setTaxCollection] = useState(initial.taxCollection);
  const [gstin, setGstin] = useState(initial.gstin ?? "");
  const [sellerState, setSellerState] = useState(initial.sellerState ?? "");
  const [pricesIncludeTax, setPricesIncludeTax] = useState(initial.pricesIncludeTax);
  const [shippingTax, setShippingTax] = useState<"highest_line_rate" | "none">(initial.shippingTax);
  const [error, setError] = useState<string | null>(null);

  // New tax class modal state
  const [isAddingClass, setIsAddingClass] = useState(false);
  const [newClassName, setNewClassName] = useState("");
  const [newClassRate, setNewClassRate] = useState("1800");
  const [newClassHsn, setNewClassHsn] = useState("");

  // Delete modal state
  const [deletingClassId, setDeletingClassId] = useState<string | null>(null);

  const createClassMutation = useMutation(orpc.admin.taxClasses.create.mutationOptions());
  const deleteClassMutation = useMutation(orpc.admin.taxClasses.delete.mutationOptions());

  const dirty =
    taxCollection !== initial.taxCollection ||
    gstin !== (initial.gstin ?? "") ||
    sellerState !== (initial.sellerState ?? "") ||
    pricesIncludeTax !== initial.pricesIncludeTax ||
    shippingTax !== initial.shippingTax;

  const guard = useUnsavedGuard(dirty);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const g = gstin.trim().toUpperCase();
    if (g && !GSTIN_PATTERN.test(g)) {
      setError("Enter a valid 15-character GSTIN, for example 29AAFCD5862R1ZR.");
      return;
    }
    setError(null);

    update.mutate(
      {
        taxCollection,
        gstin: g || null,
        sellerState: sellerState || null,
        pricesIncludeTax,
        shippingTax,
        expectedVersion: initial.version,
      },
      {
        onSuccess: () => {
          toast.success("Tax settings saved");
          void queryClient.invalidateQueries({ queryKey: orpc.admin.taxSettings.key() });
          void queryClient.invalidateQueries({ queryKey: orpc.admin.settings.key() });
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  }

  function handleCreateTaxClass(e: FormEvent) {
    e.preventDefault();
    if (!newClassName.trim()) return;

    createClassMutation.mutate(
      {
        name: newClassName.trim(),
        rateBps: parseInt(newClassRate, 10),
        defaultHsn: newClassHsn.trim() || undefined,
        isDefault: false,
      },
      {
        onSuccess: () => {
          toast.success("Tax class created");
          setIsAddingClass(false);
          setNewClassName("");
          setNewClassRate("1800");
          setNewClassHsn("");
          void queryClient.invalidateQueries({ queryKey: orpc.admin.taxSettings.key() });
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  }

  function handleDeleteTaxClass() {
    if (!deletingClassId) return;

    deleteClassMutation.mutate(
      { id: deletingClassId },
      {
        onSuccess: () => {
          toast.success("Tax class removed");
          setDeletingClassId(null);
          void queryClient.invalidateQueries({ queryKey: orpc.admin.taxSettings.key() });
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
        {!initial.sellerState && taxCollection ? (
          <SettingsSection>
            <Alert role="alert">
              Your state is not set. Choose your state below so CGST/SGST and IGST are calculated accurately.
            </Alert>
          </SettingsSection>
        ) : null}

        <SettingsSection
          title="Tax collection"
          description="Enable GST tax lines on invoices and storefront orders. If disabled, sales are non-taxable (suitable for unregistered businesses below the turnover threshold)."
        >
          <label className="flex items-center gap-2 text-xs font-medium text-foreground">
            <Checkbox checked={taxCollection} onCheckedChange={(c) => setTaxCollection(c === true)} />
            Collect GST on customer orders
          </label>
        </SettingsSection>

        {taxCollection ? (
          <>
            <SettingsSection title="GST registration">
              <Field id="gstin" label="GSTIN" hint="Leave blank if you are not GST registered.">
                <Input
                  id="gstin"
                  maxLength={15}
                  autoCapitalize="characters"
                  value={gstin}
                  onChange={(e) => setGstin(e.target.value.toUpperCase())}
                  aria-invalid={Boolean(error)}
                />
                {error ? <FieldError>{error}</FieldError> : null}
              </Field>
              <Field id="sellerState" label="Your state (place of supply)" hint="The state your GST registration is in.">
                <SimpleSelect
                  id="sellerState"
                  value={sellerState}
                  placeholder="Select state"
                  onChange={setSellerState}
                  options={INDIAN_STATES.map((s) => ({ value: s, label: s }))}
                />
              </Field>
            </SettingsSection>

            <SettingsSection title="Pricing & Shipping">
              <label className="flex items-center gap-2 text-xs text-foreground">
                <Checkbox checked={pricesIncludeTax} onCheckedChange={(c) => setPricesIncludeTax(c === true)} />
                Product prices already include GST
              </label>
              <p className="text-muted-foreground text-xs">
                When on, the invoice splits the price you charge into taxable value and GST. When off, GST is added on top.
              </p>

              <div className="mt-2 max-w-sm">
                <Field id="shippingTax" label="Shipping tax rule" hint="How tax is charged on shipping fees.">
                  <SimpleSelect
                    id="shippingTax"
                    value={shippingTax}
                    onChange={(v) => setShippingTax(v as "highest_line_rate" | "none")}
                    options={[
                      { value: "highest_line_rate", label: "Tax at highest product rate in cart (standard mixed supply)" },
                      { value: "none", label: "No tax on shipping" },
                    ]}
                  />
                </Field>
              </div>
            </SettingsSection>
          </>
        ) : null}
      </form>

      {taxCollection ? (
        <SettingsSection
          title="Tax classes"
          description="Standard GST slabs assigned to products. Existing orders and invoices retain their original rates."
          actions={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsAddingClass(true)}
              className="gap-1.5"
            >
              <Plus className="h-4 w-4" />
              Add tax class
            </Button>
          }
        >
          <div className="rounded border border-border divide-y divide-border text-xs">
            {initial.classes.map((cls) => (
              <div key={cls.id} className="flex items-center justify-between p-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">{cls.name}</span>
                    {cls.isDefault ? (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        Default
                      </span>
                    ) : null}
                  </div>
                  <div className="text-muted-foreground mt-0.5">
                    Rate: {(cls.rateBps / 100).toFixed(cls.rateBps % 100 === 0 ? 0 : 2)}%
                    {cls.defaultHsn ? ` · Default HSN: ${cls.defaultHsn}` : ""}
                  </div>
                </div>
                {!cls.isDefault ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => setDeletingClassId(cls.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            ))}
          </div>

          {/* New Tax Class Dialog */}
          {isAddingClass ? (
            <form onSubmit={handleCreateTaxClass} className="rounded border border-border bg-muted/30 p-3 mt-3 grid gap-3">
              <h3 className="text-xs font-semibold text-foreground">New GST Class</h3>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field id="newClassName" label="Class name">
                  <Input
                    id="newClassName"
                    value={newClassName}
                    onChange={(e) => setNewClassName(e.target.value)}
                    placeholder="e.g. Essential Foods 5%"
                    required
                  />
                </Field>
                <Field id="newClassRate" label="GST Rate">
                  <SimpleSelect
                    id="newClassRate"
                    value={newClassRate}
                    onChange={setNewClassRate}
                    options={GST_RATES}
                  />
                </Field>
                <Field id="newClassHsn" label="Default HSN code (optional)">
                  <Input
                    id="newClassHsn"
                    value={newClassHsn}
                    onChange={(e) => setNewClassHsn(e.target.value)}
                    placeholder="e.g. 1006"
                    maxLength={8}
                  />
                </Field>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setIsAddingClass(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={createClassMutation.isPending}>
                  {createClassMutation.isPending ? "Creating…" : "Create class"}
                </Button>
              </div>
            </form>
          ) : null}

          {/* Confirm Delete Dialog */}
          <ConfirmDialog
            open={Boolean(deletingClassId)}
            onOpenChange={(open) => {
              if (!open) setDeletingClassId(null);
            }}
            title="Delete tax class?"
            description="Are you sure you want to delete this tax class? Products using this class will prevent deletion."
            confirmLabel="Delete class"
            cancelLabel="Cancel"
            destructive
            pending={deleteClassMutation.isPending}
            onConfirm={handleDeleteTaxClass}
          />
        </SettingsSection>
      ) : null}
    </SettingsPageFrame>
  );
}

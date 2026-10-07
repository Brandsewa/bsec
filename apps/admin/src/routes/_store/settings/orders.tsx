import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { AlertTriangle, ArrowRight, Clock, Coins, Hash } from "lucide-react";
import { EmptyState, FormSkeleton, PageSkeleton, toast } from "@bs/ui";
import { Button } from "@bs/ui";
import { Input } from "@bs/ui";
import { Field } from "@bs/ui";
import { HeaderActions, SettingsCard, SettingsPageFrame, useUnsavedGuard } from "../../../components/settings/settings-page.tsx";
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
  stockHoldMinutes: number;
  minimumOrderRupees: number;
}

const TITLE = "Order settings";
const DESCRIPTION = "Customise order numbering and processing rules.";

export function OrderSettingsPage() {
  const query = useQuery(orpc.admin.orderSettings.get.queryOptions());

  if (query.isLoading) {
    return (
      <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
        <SettingsCard>
          <FormSkeleton />
        </SettingsCard>
      </SettingsPageFrame>
    );
  }

  if (query.isError || !query.data) {
    return (
      <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
        <SettingsCard>
          <EmptyState
            icon={AlertTriangle}
            title="Could not load order settings"
            description={errorMessage(query.error)}
            action={<Button onClick={() => void query.refetch()}>Try again</Button>}
          />
        </SettingsCard>
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
    stockHoldMinutes?: number;
    minimumOrderPaise?: number;
  };
}) {
  const queryClient = useQueryClient();
  const initialStockHold = initial.stockHoldMinutes ?? 30;
  const initialMinRupees = Math.round((initial.minimumOrderPaise ?? 0) / 100);

  const [form, setForm] = useState<OrderSettingsFormState>({
    prefix: initial.prefix,
    padding: initial.padding,
    nextValue: initial.nextValue,
    stockHoldMinutes: initialStockHold,
    minimumOrderRupees: initialMinRupees,
  });

  const dirty =
    form.prefix !== initial.prefix ||
    form.padding !== initial.padding ||
    form.nextValue !== initial.nextValue ||
    form.stockHoldMinutes !== initialStockHold ||
    form.minimumOrderRupees !== initialMinRupees;

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
      stockHoldMinutes: form.stockHoldMinutes,
      minimumOrderPaise: Math.round(form.minimumOrderRupees * 100),
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

      <form id="settings-orders" onSubmit={onSubmit} className="space-y-6">
        <SettingsCard
          title="Order numbers"
          description="Prefix and zero-padding format applied to new orders"
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

          <div className="mt-4 rounded-lg border border-border bg-muted/20 p-3.5 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Hash className="h-4 w-4" />
              <span>Next generated order preview:</span>
            </div>
            <code className="rounded bg-background px-2.5 py-1 font-mono font-semibold text-foreground text-sm border border-border">
              {preview}
            </code>
          </div>
        </SettingsCard>

        <SettingsCard
          title="Order processing rules"
          description="Cart holding duration and minimum checkout value limits"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="stockHoldMinutes"
              label="Inventory hold duration"
              hint="How long reserved items are held during checkout (5 to 120 mins)."
            >
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                <Input
                  id="stockHoldMinutes"
                  type="number"
                  min={5}
                  max={120}
                  value={form.stockHoldMinutes}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!Number.isNaN(val)) {
                      setForm((f) => ({ ...f, stockHoldMinutes: Math.min(120, Math.max(5, val)) }));
                    }
                  }}
                />
                <span className="text-xs text-muted-foreground">minutes</span>
              </div>
            </Field>

            <Field
              id="minimumOrderRupees"
              label="Minimum order value"
              hint="Minimum subtotal required to place order (0 for no limit)."
            >
              <div className="flex items-center gap-2">
                <Coins className="h-4 w-4 text-muted-foreground shrink-0" />
                <Input
                  id="minimumOrderRupees"
                  type="number"
                  min={0}
                  max={10000}
                  value={form.minimumOrderRupees}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!Number.isNaN(val)) {
                      setForm((f) => ({ ...f, minimumOrderRupees: Math.min(10000, Math.max(0, val)) }));
                    }
                  }}
                />
                <span className="text-xs text-muted-foreground">₹</span>
              </div>
            </Field>
          </div>
        </SettingsCard>

        <SettingsCard
          title="Related settings"
          description="Other store settings that affect order handling and fulfillment"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              to="/settings/shipping"
              className="flex items-center justify-between rounded-lg border border-border p-3.5 hover:bg-muted/40 transition-colors"
            >
              <div>
                <p className="text-sm font-medium text-foreground">Shipping</p>
                <p className="text-xs text-muted-foreground">Delivery zones, rates, and free shipping thresholds</p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </Link>

            <Link
              to="/settings/payments"
              className="flex items-center justify-between rounded-lg border border-border p-3.5 hover:bg-muted/40 transition-colors"
            >
              <div>
                <p className="text-sm font-medium text-foreground">Payments</p>
                <p className="text-xs text-muted-foreground">Cash on Delivery rules and online payment gateways</p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </Link>

            <Link
              to="/settings/taxes"
              className="flex items-center justify-between rounded-lg border border-border p-3.5 hover:bg-muted/40 transition-colors"
            >
              <div>
                <p className="text-sm font-medium text-foreground">Taxes</p>
                <p className="text-xs text-muted-foreground">GST calculation and place of supply configurations</p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </Link>

            <Link
              to="/settings/returns"
              className="flex items-center justify-between rounded-lg border border-border p-3.5 hover:bg-muted/40 transition-colors"
            >
              <div>
                <p className="text-sm font-medium text-foreground">Returns</p>
                <p className="text-xs text-muted-foreground">Return policy window, valid reasons, and photo requirements</p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          </div>
        </SettingsCard>
      </form>
    </SettingsPageFrame>
  );
}

import { useState } from "react";
import { AlertCircle, AlertTriangle, ShieldAlert } from "lucide-react";
import { Badge, Button, Switch, toast } from "@bs/ui";
import type { MarketDetail } from "@bs/contracts";
import { client } from "../../lib/orpc.ts";
import { errorMessage } from "../../lib/errors.ts";

export function MarketPaymentsTab({
  market,
  onUpdated,
}: {
  market: MarketDetail;
  onUpdated: () => void;
}) {
  // Store connected payment methods for this market
  const [methods, setMethods] = useState(market.paymentMethods);
  const [isSaving, setIsSaving] = useState(false);

  function handleToggle(provider: string, enabled: boolean) {
    setMethods((prev) =>
      prev.map((m) => (m.provider === provider ? { ...m, enabled } : m)),
    );
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      await client.admin.markets.setPaymentMethods({
        id: market.id,
        methods: methods.map((m) => ({
          provider: m.provider as "cod" | "razorpay" | "stripe" | "paypal" | "cashfree",
          enabled: m.enabled,
        })),
      });

      toast.success("Market payment methods updated");
      onUpdated();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-4 text-xs">
      <div>
        <h3 className="font-medium text-foreground text-sm">Market Payment Gateways</h3>
        <p className="text-muted-foreground mt-0.5">
          Choose which of your store&apos;s connected payment providers are enabled at checkout for customers in this market.
        </p>
      </div>

      <div className="space-y-3">
        {methods.length === 0 ? (
          <div className="rounded-lg border border-border p-4 text-center text-muted-foreground">
            No payment gateways configured on this store. Connect gateways under Settings &gt; Payments first.
          </div>
        ) : (
          methods.map((method) => {
            const hasBlocking = !!method.blocking;
            const hasWarning = !!method.warning;

            return (
              <div
                key={method.provider}
                className={`flex flex-col justify-between gap-3 rounded-lg border p-4 transition-colors ${
                  method.enabled ? "border-border bg-card" : "border-border/60 bg-muted/20 opacity-80"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-foreground capitalize">
                        {method.provider === "cod" ? "Cash on Delivery" : method.provider}
                      </span>
                      {hasBlocking ? (
                        <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 gap-1 text-[10px]">
                          <ShieldAlert className="h-3 w-3" /> Blocked
                        </Badge>
                      ) : hasWarning ? (
                        <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 gap-1 text-[10px]">
                          <AlertTriangle className="h-3 w-3" /> Warning
                        </Badge>
                      ) : null}
                    </div>

                    {hasBlocking ? (
                      <p className="text-destructive font-medium mt-1 text-[11px] flex items-center gap-1">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                        {method.blocking}
                      </p>
                    ) : hasWarning ? (
                      <p className="text-amber-600 dark:text-amber-400 font-medium mt-1 text-[11px] flex items-center gap-1">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        {method.warning}
                      </p>
                    ) : (
                      <p className="text-muted-foreground mt-0.5 text-[11px]">
                        Available for customer transactions in this market.
                      </p>
                    )}
                  </div>

                  <Switch
                    checked={method.enabled}
                    onCheckedChange={(checked) => handleToggle(method.provider, checked)}
                    disabled={hasBlocking && !method.enabled}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="flex justify-end pt-2">
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Saving…" : "Save payment methods"}
        </Button>
      </div>
    </div>
  );
}

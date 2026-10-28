import { useState } from "react";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { Button, Checkbox, toast } from "@bs/ui";
import type { MarketDetail } from "@bs/contracts";
import { client } from "../../lib/orpc.ts";
import { errorMessage } from "../../lib/errors.ts";

export function ComplianceAckCard({
  market,
  onUpdated,
}: {
  market: MarketDetail;
  onUpdated: () => void;
}) {
  const isAcknowledged = market.complianceAckAt !== null;
  const [checked, setChecked] = useState(isAcknowledged);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleAcknowledge() {
    if (!checked) return;
    setIsSubmitting(true);
    try {
      await client.admin.markets.acknowledgeCompliance({ id: market.id });
      toast.success("Compliance responsibility confirmed");
      onUpdated();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border border-border p-4 bg-muted/10 space-y-3 text-xs">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <span className="font-medium text-foreground text-sm">Regulatory Compliance & Responsibility</span>
      </div>

      <div className="flex items-start space-x-3 pt-1">
        <Checkbox
          id="compliance-ack"
          checked={isAcknowledged || checked}
          disabled={isAcknowledged}
          onCheckedChange={(c) => setChecked(!!c)}
        />
        <label
          htmlFor="compliance-ack"
          className="text-muted-foreground leading-relaxed cursor-pointer select-none"
        >
          I confirm that I am responsible for the accuracy of tax rates, registrations, returns and cancellation policies for this market. Brand Sewa provides software tools and does not offer tax, legal or compliance advice.
        </label>
      </div>

      <div className="flex items-center justify-between border-t border-border/60 pt-3">
        {market.complianceAckAt ? (
          <span className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium">
            <CheckCircle2 className="h-3.5 w-3.5" /> Acknowledged on {new Date(market.complianceAckAt).toLocaleDateString()}
          </span>
        ) : (
          <span className="text-[11px] text-amber-600 dark:text-amber-400">
            Acknowledgement required before activating this market.
          </span>
        )}

        {!isAcknowledged ? (
          <Button
            size="sm"
            onClick={handleAcknowledge}
            disabled={!checked || isSubmitting}
          >
            {isSubmitting ? "Confirming…" : "Confirm Acknowledgement"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

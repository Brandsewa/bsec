import { useState } from "react";
import { Copy, Info } from "lucide-react";
import { Button, toast } from "@bs/ui";
import type { MarketDetail } from "@bs/contracts";
import { client } from "../../lib/orpc.ts";
import { errorMessage } from "../../lib/errors.ts";

const EXAMPLE_RETURN_POLICY =
  "Items may be returned within 30 days of receipt in original condition with tags attached. Return shipping costs are the customer's responsibility unless the item received was damaged or incorrect. Refunds are issued to the original payment method upon inspection.";

const EXAMPLE_CANCELLATION_POLICY =
  "Orders may be cancelled before shipment has occurred. Once dispatched, the standard returns policy applies. To request cancellation, contact support immediately with your order reference number.";

export function MarketPoliciesTab({
  market,
  onUpdated,
}: {
  market: MarketDetail;
  onUpdated: () => void;
}) {
  const [policyText, setPolicyText] = useState(market.policy.policyText ?? "");
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    try {
      await client.admin.markets.setPolicy({
        id: market.id,
        policy: {
          returnSettings: null,
          cancellation: null,
          policyText: policyText.trim() ? policyText.trim() : null,
        },
      });

      toast.success("Policy saved");
      onUpdated();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsSaving(false);
    }
  }

  function handleCopyTemplate(template: string) {
    setPolicyText((prev) => (prev ? `${prev}\n\n${template}` : template));
    toast.success("Template copied into editor. Review and edit before saving.");
  }

  return (
    <form onSubmit={handleSave} className="space-y-6 text-xs">
      <div>
        <h3 className="font-medium text-foreground text-sm">Returns & Cancellation Policy</h3>
        <p className="text-muted-foreground mt-0.5">
          Write clear return and cancellation terms tailored to this regional market. The merchant owns policy wording; Brand Sewa does not publish generic defaults.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label htmlFor="market-policy-text" className="font-medium text-foreground">
            Market Policy Text
          </label>
          <span className="text-muted-foreground text-[11px]">{policyText.length} / 20,000 characters</span>
        </div>
        <textarea
          id="market-policy-text"
          value={policyText}
          onChange={(e) => setPolicyText(e.target.value)}
          rows={8}
          placeholder="Enter the returns and cancellation policy for shoppers in this market..."
          className="w-full rounded-md border border-input bg-background p-3 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
      </div>

      {/* Labelled Example Templates */}
      <div className="rounded-lg border border-border bg-muted/10 p-4 space-y-3">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <Info className="h-4 w-4 text-muted-foreground" />
          <span>Labelled Policy Examples (Draft aid only — edit before saving)</span>
        </div>
        <p className="text-muted-foreground text-[11px]">
          These examples illustrate common consumer terms. They are never published automatically. You must review and adapt them to match your store&apos;s fulfillment and local statutory rights.
        </p>

        <div className="grid gap-3 sm:grid-cols-2 pt-1">
          <div className="rounded-md border border-border bg-card p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-[11px] text-foreground">Example: 30-Day Return Terms</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11px]"
                onClick={() => handleCopyTemplate(EXAMPLE_RETURN_POLICY)}
              >
                <Copy className="mr-1 h-3 w-3" /> Insert
              </Button>
            </div>
            <p className="text-muted-foreground text-[11px] leading-relaxed line-clamp-3">
              {EXAMPLE_RETURN_POLICY}
            </p>
          </div>

          <div className="rounded-md border border-border bg-card p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-[11px] text-foreground">Example: Pre-Shipment Cancellation</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11px]"
                onClick={() => handleCopyTemplate(EXAMPLE_CANCELLATION_POLICY)}
              >
                <Copy className="mr-1 h-3 w-3" /> Insert
              </Button>
            </div>
            <p className="text-muted-foreground text-[11px] leading-relaxed line-clamp-3">
              {EXAMPLE_CANCELLATION_POLICY}
            </p>
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "Saving…" : "Save policy"}
        </Button>
      </div>
    </form>
  );
}

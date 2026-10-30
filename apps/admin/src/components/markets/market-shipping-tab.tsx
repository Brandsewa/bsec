import { Link } from "@tanstack/react-router";
import { ExternalLink, Truck } from "lucide-react";
import { Button } from "@bs/ui";
import type { MarketDetail } from "@bs/contracts";

export function MarketShippingTab({ market }: { market: MarketDetail }) {
  // Check rate readiness
  const shippingCheck = market.readiness.items.find((i) => i.key === "shipping");
  const hasRates = shippingCheck?.ok ?? false;

  return (
    <div className="space-y-4 text-xs">
      <div>
        <h3 className="font-medium text-foreground text-sm">Market Shipping Rates</h3>
        <p className="text-muted-foreground mt-0.5">
          Each market requires at least one configured shipping rate so shoppers can complete checkout.
        </p>
      </div>

      <div className="rounded-lg border border-border p-4 bg-muted/10 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Truck className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-foreground text-sm">
                {hasRates ? "Shipping Rates Configured" : "No Shipping Rates Assigned"}
              </div>
              <p className="text-muted-foreground text-xs mt-0.5">
                {hasRates
                  ? "This market has one or more active shipping zones and rates."
                  : "Shoppers in this market will not be able to checkout until a shipping zone and rate are added."}
              </p>
            </div>
          </div>

          <Button size="sm" variant="outline" asChild>
            <Link to="/settings/shipping">
              Configure in Shipping <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

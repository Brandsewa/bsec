import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Badge } from "@bs/ui";

export interface ReadinessItem {
  key: "currency_rate" | "countries" | "gateway" | "shipping" | "policy" | "tax_acknowledgement";
  ok: boolean;
  message: string;
}

const READINESS_TITLES: Record<ReadinessItem["key"], string> = {
  currency_rate: "Exchange rate",
  countries: "Target countries",
  gateway: "Payment gateway",
  shipping: "Shipping rate",
  policy: "Returns & cancellation policy",
  tax_acknowledgement: "Tax & compliance responsibility",
};

export function MarketReadinessCard({
  ready,
  items,
  onGoToTab,
}: {
  ready: boolean;
  items: ReadinessItem[];
  onGoToTab?: (tab: string) => void;
}) {
  const tabMapping: Record<ReadinessItem["key"], string> = {
    currency_rate: "pricing",
    countries: "general",
    gateway: "payments",
    shipping: "shipping",
    policy: "policies",
    tax_acknowledgement: "taxes",
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 text-xs space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground text-sm">Readiness Checklist</span>
          {ready ? (
            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 gap-1 text-[11px]">
              <CheckCircle2 className="h-3 w-3" /> Ready to activate
            </Badge>
          ) : (
            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 gap-1 text-[11px]">
              <AlertTriangle className="h-3 w-3" /> Setup required
            </Badge>
          )}
        </div>
        <span className="text-muted-foreground text-[11px]">
          {items.filter((i) => i.ok).length} of {items.length} checks passing
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <div
            key={item.key}
            className={`flex items-start gap-2 rounded-md border p-2.5 transition-colors ${
              item.ok
                ? "border-emerald-500/20 bg-emerald-500/5 text-foreground"
                : "border-amber-500/30 bg-amber-500/5 text-foreground"
            }`}
          >
            {item.ok ? (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-1">
                <span className="font-medium text-[11px]">{READINESS_TITLES[item.key]}</span>
                {!item.ok && onGoToTab ? (
                  <button
                    type="button"
                    onClick={() => onGoToTab(tabMapping[item.key])}
                    className="text-[10px] text-primary hover:underline font-normal"
                  >
                    Fix
                  </button>
                ) : null}
              </div>
              <p className="text-muted-foreground text-[11px] leading-tight mt-0.5">
                {item.ok ? "Configured" : item.message}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

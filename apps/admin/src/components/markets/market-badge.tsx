import { Badge } from "@bs/ui";

export function MarketBadge({
  status,
  isBase,
}: {
  status: "draft" | "active" | "disabled";
  isBase?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {isBase ? (
        <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary text-[11px] font-medium">
          Base Market
        </Badge>
      ) : null}
      {status === "active" ? (
        <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px]">
          Active
        </Badge>
      ) : status === "disabled" ? (
        <Badge variant="secondary" className="text-[11px] text-muted-foreground">
          Disabled
        </Badge>
      ) : (
        <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[11px]">
          Draft
        </Badge>
      )}
    </div>
  );
}

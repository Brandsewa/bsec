import type { ComponentType, ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "../lib/cn.ts";

export interface MetricCardProps {
  label: string;
  value: ReactNode;
  change?: {
    value: ReactNode;
    trend?: "up" | "down" | "neutral";
  };
  description?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  action?: ReactNode;
  className?: string;
}

/**
 * MetricCard (Supabase design fragment ported to shop admin).
 * Standard statistic display with trend indicator and optional action.
 */
export function MetricCard({
  label,
  value,
  change,
  description,
  icon: Icon,
  action,
  className,
}: MetricCardProps) {
  const trend = change?.trend ?? "neutral";

  return (
    <div
      className={cn(
        "flex flex-col justify-between rounded-lg border border-border-soft bg-card p-5 shadow-xs transition-colors",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {Icon ? <Icon className="size-4 text-faint-foreground" aria-hidden /> : null}
      </div>

      <div className="mt-3 flex items-baseline justify-between gap-3">
        <div className="text-2xl font-semibold tracking-tight text-foreground">
          {value}
        </div>
        {change ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium",
              trend === "up" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
              trend === "down" && "bg-rose-500/10 text-rose-600 dark:text-rose-400",
              trend === "neutral" && "bg-muted text-faint-foreground",
            )}
          >
            {trend === "up" ? <ArrowUpRight className="size-3" aria-hidden /> : null}
            {trend === "down" ? <ArrowDownRight className="size-3" aria-hidden /> : null}
            {trend === "neutral" ? <Minus className="size-3" aria-hidden /> : null}
            {change.value}
          </span>
        ) : null}
      </div>

      {(description || action) ? (
        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-faint-foreground">
          {description ? <span>{description}</span> : <span />}
          {action}
        </div>
      ) : null}
    </div>
  );
}

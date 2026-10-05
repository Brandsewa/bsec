import * as React from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip.tsx";
import { formatDistanceToNow, format } from "date-fns";
import { cn } from "../lib/cn.ts";

export type StatusTone = "neutral" | "brand" | "info" | "success" | "warning" | "destructive" | "outline";

const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: "bg-[var(--muted)] text-[var(--foreground)] border-transparent",
  brand: "bg-[var(--brand-soft)] text-[var(--brand-deep)] border-transparent",
  info: "bg-[var(--info-soft)] text-[var(--info)] border-transparent",
  success: "bg-[var(--success-soft)] text-[var(--success)] border-transparent",
  warning: "bg-[var(--warning-soft)] text-[var(--warning)] border-transparent",
  destructive: "bg-[var(--destructive-soft)] text-[var(--destructive)] border-transparent",
  outline: "bg-transparent text-[var(--foreground)] border-[var(--border)]",
};

export interface StatusBadgeProps {
  status?: string;
  label?: string;
  tone?: StatusTone;
  dot?: boolean;
  withDot?: boolean;
  className?: string;
}

export function StatusBadge({ status, label, tone = "neutral", dot = false, withDot, className }: StatusBadgeProps) {
  const text = label || status || "";
  const showDot = withDot ?? dot;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--radius-button)] text-[11px] font-medium border capitalize",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {showDot && (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            tone === "success" && "bg-[var(--success)]",
            tone === "warning" && "bg-[var(--warning)]",
            tone === "destructive" && "bg-[var(--destructive)]",
            tone === "info" && "bg-[var(--info)]",
            tone === "brand" && "bg-[var(--brand)]",
            tone === "neutral" && "bg-[var(--muted-foreground)]",
          )}
        />
      )}
      {text.replace(/_/g, " ")}
    </span>
  );
}

export interface MoneyProps {
  paise?: number;
  amountInPaise?: number;
  currency?: string;
  className?: string;
}

export function Money({ paise, amountInPaise, currency = "₹", className }: MoneyProps) {
  const value = paise ?? amountInPaise ?? 0;
  const formatted = `${currency}${(value / 100).toLocaleString("en-IN")}`;
  return (
    <span className={cn("font-mono tabular-nums", className)}>
      {formatted}
    </span>
  );
}

export interface RelativeTimeProps {
  date: Date | string | number;
  className?: string;
}

export function RelativeTime({ date, className }: RelativeTimeProps) {
  const d = React.useMemo(() => new Date(date), [date]);
  const relativeStr = React.useMemo(() => formatDistanceToNow(d, { addSuffix: true }), [d]);
  const absoluteStr = React.useMemo(() => format(d, "PPpp"), [d]);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <time dateTime={d.toISOString()} className={cn("cursor-help text-xs text-[var(--muted-foreground)]", className)}>
              {relativeStr}
            </time>
          }
        />
        <TooltipContent className="text-[11px]">
          {absoluteStr}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

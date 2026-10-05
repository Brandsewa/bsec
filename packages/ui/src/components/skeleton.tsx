import type { ComponentProps } from "react";
import { cn } from "../lib/cn.ts";

/**
 * Skeletons match the final layout so nothing jumps (PLAN §12). Hidden from screen readers;
 * the region that is loading carries aria-busy. Shimmer is off under prefers-reduced-motion (tokens.css).
 */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div aria-hidden className={cn("bs-skeleton rounded-md", className)} {...props} />;
}

export function TableSkeleton({ rows = 10, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div aria-hidden className="overflow-hidden rounded-md border border-border bg-background">
      <div className="flex gap-4 border-b border-border bg-surface-75 px-3 py-2.5">
        {Array.from({ length: columns }, (_, c) => (
          <Skeleton key={c} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-4 border-b border-border-muted px-3 py-3 last:border-0">
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className={cn("h-4 flex-1", c === 0 && "flex-[2]")} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function FormSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <div aria-hidden className="grid gap-6">
      {Array.from({ length: fields }, (_, i) => (
        <div key={i} className="grid gap-2">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-9 w-full max-md:h-touch" />
        </div>
      ))}
    </div>
  );
}

export function MetricCardSkeleton() {
  return (
    <div aria-hidden className="grid gap-3 rounded-md border border-border bg-background p-4">
      <Skeleton className="h-3.5 w-24" />
      <Skeleton className="h-7 w-32" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div aria-hidden className="grid gap-6 md:grid-cols-[2fr_1fr]">
      <div className="grid gap-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
      <div className="grid content-start gap-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    </div>
  );
}


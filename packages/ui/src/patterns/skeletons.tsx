import * as React from "react";
import { cn } from "../lib/cn.ts";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { Card } from "../components/ui/card.tsx";

/**
 * Composed skeletons matching real layouts with identical dimensions (CLS 0)
 * per DESIGN-SYSTEM-IMPLEMENTATION-GUIDE.md section 5.
 */

export function PageHeaderSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between py-4", className)}>
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-64" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-28" />
      </div>
    </div>
  );
}

export function MetricCardsSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div aria-hidden className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-4", className)}>
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-4 rounded-full" />
          </div>
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-3 w-40" />
        </Card>
      ))}
    </div>
  );
}

export function DataTableSkeleton({
  columns = 5,
  rows = 10,
  columnWidths,
  className,
}: {
  columns?: number;
  rows?: number;
  columnWidths?: string[];
  className?: string;
}) {
  return (
    <div aria-hidden className={cn("rounded-md border border-[var(--border)] bg-[var(--background)] overflow-hidden", className)}>
      {/* Table toolbar skeleton */}
      <div className="flex items-center justify-between p-4 border-b border-[var(--border)] gap-4">
        <Skeleton className="h-9 w-64 max-w-full" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-9" />
        </div>
      </div>
      {/* Table header */}
      <div className="flex items-center gap-4 bg-[var(--muted)]/50 px-4 py-3 border-b border-[var(--border)]">
        {Array.from({ length: columns }, (_, c) => (
          <div
            key={c}
            className="flex-1"
            style={{ width: columnWidths?.[c], flex: columnWidths?.[c] ? "none" : undefined }}
          >
            <Skeleton className="h-4 w-3/4" />
          </div>
        ))}
      </div>
      {/* Table rows */}
      <div className="divide-y divide-[var(--border)]">
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex items-center gap-4 px-4 py-3.5">
            {Array.from({ length: columns }, (_, c) => (
              <div
                key={c}
                className="flex-1"
                style={{ width: columnWidths?.[c], flex: columnWidths?.[c] ? "none" : undefined }}
              >
                <Skeleton className={cn("h-4", c === 0 ? "w-4/5" : "w-1/2")} />
              </div>
            ))}
          </div>
        ))}
      </div>
      {/* Pagination skeleton */}
      <div className="flex items-center justify-between p-4 border-t border-[var(--border)]">
        <Skeleton className="h-4 w-40" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-20" />
        </div>
      </div>
    </div>
  );
}

export function FormSectionSkeleton({ fields = 4, className }: { fields?: number; className?: string }) {
  return (
    <Card aria-hidden className={cn("p-6 space-y-6", className)}>
      <div className="space-y-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="grid gap-4">
        {Array.from({ length: fields }, (_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
      </div>
    </Card>
  );
}

export function DetailPageSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("space-y-6", className)}>
      <PageHeaderSkeleton />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <FormSectionSkeleton fields={3} />
          <FormSectionSkeleton fields={2} />
        </div>
        <div className="space-y-6">
          <Card className="p-6 space-y-4">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </Card>
        </div>
      </div>
    </div>
  );
}

export function AuthCardSkeleton({ className }: { className?: string }) {
  return (
    <Card aria-hidden className={cn("w-full max-w-md p-8 space-y-6", className)}>
      <div className="space-y-2 text-center flex flex-col items-center">
        <Skeleton className="h-8 w-8 rounded-lg mb-2" />
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
      <div className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-10 w-full" />
        </div>
        <Skeleton className="h-10 w-full mt-4" />
      </div>
    </Card>
  );
}

export function AccountPageSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("max-w-4xl mx-auto space-y-8 py-8 px-4", className)}>
      <div className="flex items-center gap-4">
        <Skeleton className="h-16 w-16 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <div className="grid gap-6 md:grid-cols-3">
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="md:col-span-2 space-y-6">
          <FormSectionSkeleton fields={3} />
        </div>
      </div>
    </div>
  );
}

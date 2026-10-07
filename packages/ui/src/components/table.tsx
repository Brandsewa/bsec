import type { ComponentProps } from "react";
import { cn } from "../lib/cn.ts";

/**
 * Plain table primitives; TanStack Table drives them in the admin.
 * Below 768px tables become card lists (PLAN §12) — screens pass a mobile renderer via DataList (M2).
 */
export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <div className="relative w-full overflow-x-auto rounded-md border border-border bg-card">
      <table className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  );
}
export function TableHeader({ className, ...props }: ComponentProps<"thead">) {
  return <thead className={cn("bg-surface-75 [&_tr]:border-b", className)} {...props} />;
}
export function TableBody({ className, ...props }: ComponentProps<"tbody">) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}
export function TableRow({ className, ...props }: ComponentProps<"tr">) {
  return <tr className={cn("border-b border-border-muted hover:bg-surface-75 data-[state=selected]:bg-surface-100", className)} {...props} />;
}
export function TableHead({ className, ...props }: ComponentProps<"th">) {
  return <th className={cn("h-9 px-3 text-left align-middle text-xs font-medium text-foreground-lighter", className)} {...props} />;
}
export function TableCell({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("px-3 py-2.5 align-middle", className)} {...props} />;
}


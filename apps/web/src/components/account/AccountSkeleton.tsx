import React from "react";
import { AuthCardSkeleton } from "@bs/ui";

/** One pulsing bar. The storefront draws it from `--muted` explicitly: the shared `bg-muted` class resolved to the card colour here, which left an empty outlined box. */
function Bar({ className }: { className: string }) {
  return <div aria-hidden className={`animate-pulse rounded-md bg-[var(--muted)] ${className}`} />;
}

/** Placeholder while an account tab or token page loads. `card` is an auth card skeleton, `list` fills the content column next to the account navigation. */
export function AccountSkeleton({ variant = "list" }: { variant?: "list" | "card" }) {
  if (variant === "card") {
    return <AuthCardSkeleton />;
  }
  return (
    <div aria-hidden className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <Bar className="h-24 rounded-2xl" />
        <Bar className="h-24 rounded-2xl" />
      </div>
      <Bar className="h-6 w-40" />
      <div className="space-y-2">
        <Bar className="h-14 w-full rounded-xl" />
        <Bar className="h-14 w-full rounded-xl" />
        <Bar className="h-14 w-full rounded-xl" />
      </div>
    </div>
  );
}

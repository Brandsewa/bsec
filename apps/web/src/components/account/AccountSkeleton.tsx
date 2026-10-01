import React from "react";

/** Placeholder while an account or token page loads. `card` is a single panel, `list` a few rows. */
export function AccountSkeleton({ variant = "list" }: { variant?: "list" | "card" }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8 space-y-4">
      <div aria-hidden className="store-skeleton h-8 w-48 rounded" />
      {variant === "card" ? (
        <div aria-hidden className="store-skeleton h-64 w-full rounded-2xl" />
      ) : (
        <>
          <div aria-hidden className="store-skeleton h-16 w-full rounded-2xl" />
          <div aria-hidden className="store-skeleton h-16 w-full rounded-2xl" />
          <div aria-hidden className="store-skeleton h-16 w-full rounded-2xl" />
        </>
      )}
    </div>
  );
}

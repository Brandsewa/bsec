import React from "react";

export default function CodConfirmationLoading() {
  return (
    <div className="mx-auto max-w-lg px-4 py-16 sm:px-6 lg:px-8 text-center">
      <div className="rounded-2xl border border-border bg-card p-8 shadow-sm space-y-4">
        <div aria-hidden className="store-skeleton h-16 w-16 rounded-full mx-auto" />
        <div aria-hidden className="store-skeleton h-8 w-48 rounded mx-auto" />
        <div aria-hidden className="store-skeleton h-4 w-72 rounded mx-auto" />
        <div aria-hidden className="store-skeleton h-10 w-full rounded-lg mx-auto" />
      </div>
    </div>
  );
}

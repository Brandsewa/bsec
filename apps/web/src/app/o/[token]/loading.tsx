import React from "react";

export default function OrderTrackingLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8 space-y-6">
        <div className="flex justify-between items-center border-b border-border pb-6">
          <div className="space-y-2">
            <div aria-hidden className="store-skeleton h-3 w-16 rounded" />
            <div aria-hidden className="store-skeleton h-7 w-32 rounded" />
          </div>
          <div aria-hidden className="store-skeleton h-6 w-24 rounded-full" />
        </div>
        <div className="space-y-4">
          <div aria-hidden className="store-skeleton h-4 w-20 rounded" />
          <div aria-hidden className="store-skeleton h-12 w-full rounded" />
          <div aria-hidden className="store-skeleton h-12 w-full rounded" />
        </div>
        <div className="border-t border-border pt-4 space-y-2">
          <div aria-hidden className="store-skeleton h-4 w-full rounded" />
          <div aria-hidden className="store-skeleton h-6 w-full rounded" />
        </div>
      </div>
    </div>
  );
}

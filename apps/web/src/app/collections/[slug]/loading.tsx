import React from "react";

export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Breadcrumb skeleton */}
      <div className="flex items-center gap-2 mb-6">
        <div aria-hidden className="store-skeleton h-4 w-12 rounded" />
        <span className="text-muted-foreground/40">/</span>
        <div aria-hidden className="store-skeleton h-4 w-20 rounded" />
        <span className="text-muted-foreground/40">/</span>
        <div aria-hidden className="store-skeleton h-4 w-28 rounded" />
      </div>

      {/* Header skeleton */}
      <div className="mb-6">
        <div aria-hidden className="store-skeleton h-10 w-64 rounded-lg" />
      </div>

      {/* Filter and Sort skeleton */}
      <div className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/60">
        <div aria-hidden className="store-skeleton h-4 w-36 rounded" />
        <div className="flex items-center gap-4">
          <div aria-hidden className="store-skeleton h-5 w-24 rounded" />
          <div aria-hidden className="store-skeleton h-9 w-40 rounded-lg" />
        </div>
      </div>

      {/* Products Grid skeleton */}
      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card"
          >
            <div aria-hidden className="store-skeleton aspect-square w-full" />
            <div className="flex flex-1 flex-col p-4 gap-3">
              <div aria-hidden className="store-skeleton h-3 w-20 rounded" />
              <div aria-hidden className="store-skeleton h-5 w-3/4 rounded" />
              <div aria-hidden className="store-skeleton h-4 w-16 rounded mt-auto" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

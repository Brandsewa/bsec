import React from "react";

export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Breadcrumb skeleton */}
      <div className="flex items-center gap-2 mb-6">
        <div aria-hidden className="store-skeleton h-4 w-12 rounded" />
        <span className="text-muted-foreground/40">/</span>
        <div aria-hidden className="store-skeleton h-4 w-16 rounded" />
      </div>

      {/* Search Header skeleton */}
      <div className="flex flex-col items-center justify-center text-center mb-10">
        <div aria-hidden className="store-skeleton h-10 w-64 rounded-lg mb-4" />
        <div aria-hidden className="store-skeleton h-4 w-96 rounded mb-6" />
        <div className="w-full flex justify-center">
          <div aria-hidden className="store-skeleton h-11 w-full max-w-xl rounded-xl" />
        </div>
      </div>

      {/* Query status count skeleton */}
      <div className="mb-6 border-b border-border/60 pb-4">
        <div aria-hidden className="store-skeleton h-5 w-48 rounded" />
      </div>

      {/* Products Grid skeleton */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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

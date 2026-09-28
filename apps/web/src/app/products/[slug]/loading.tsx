import React from "react";
import { StockEtaSkeleton } from "@/components/product/StockEtaHole.tsx";

export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Breadcrumb skeleton */}
      <div className="flex items-center gap-2 mb-6">
        <div aria-hidden className="store-skeleton h-4 w-12 rounded" />
        <span className="text-muted-foreground/40">/</span>
        <div aria-hidden className="store-skeleton h-4 w-16 rounded" />
        <span className="text-muted-foreground/40">/</span>
        <div aria-hidden className="store-skeleton h-4 w-32 rounded" />
      </div>

      <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-16">
        {/* Gallery skeleton */}
        <div className="flex flex-col gap-4">
          <div aria-hidden className="store-skeleton aspect-square w-full rounded-2xl" />
          <div className="flex gap-3">
            <div aria-hidden className="store-skeleton h-20 w-20 rounded-xl" />
            <div aria-hidden className="store-skeleton h-20 w-20 rounded-xl" />
            <div aria-hidden className="store-skeleton h-20 w-20 rounded-xl" />
          </div>
        </div>

        {/* Product details skeleton */}
        <div className="flex flex-col gap-6">
          <div>
            <div aria-hidden className="store-skeleton h-4 w-24 rounded mb-2" />
            <div aria-hidden className="store-skeleton h-8 w-3/4 rounded" />
          </div>

          <div className="flex items-center gap-2">
            <div aria-hidden className="store-skeleton h-5 w-28 rounded-md" />
            <div aria-hidden className="store-skeleton h-4 w-20 rounded" />
          </div>

          <div aria-hidden className="store-skeleton h-9 w-40 rounded" />

          <div className="space-y-2">
            <div aria-hidden className="store-skeleton h-4 w-full rounded" />
            <div aria-hidden className="store-skeleton h-4 w-5/6 rounded" />
          </div>

          {/* Variant picker skeleton */}
          <div className="flex flex-col gap-3">
            <div aria-hidden className="store-skeleton h-4 w-20 rounded" />
            <div className="flex gap-2">
              <div aria-hidden className="store-skeleton h-10 w-24 rounded-lg" />
              <div aria-hidden className="store-skeleton h-10 w-24 rounded-lg" />
            </div>
          </div>

          {/* StockEta hole skeleton */}
          <StockEtaSkeleton />

          {/* Add to cart skeleton */}
          <div aria-hidden className="store-skeleton h-14 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}

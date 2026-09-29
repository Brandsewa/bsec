import React from "react";

export default function CartLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div aria-hidden className="store-skeleton h-8 w-48 rounded mb-8" />
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-8">
        <div className="lg:col-span-8 space-y-4">
          <div aria-hidden className="store-skeleton h-24 w-full rounded-xl" />
          <div aria-hidden className="store-skeleton h-24 w-full rounded-xl" />
        </div>
        <div className="lg:col-span-4 space-y-4">
          <div aria-hidden className="store-skeleton h-48 w-full rounded-xl" />
          <div aria-hidden className="store-skeleton h-12 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}

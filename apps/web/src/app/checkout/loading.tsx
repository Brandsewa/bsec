import React from "react";

export default function CheckoutLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div aria-hidden className="store-skeleton h-8 w-48 rounded mb-8" />
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-8">
        <div className="lg:col-span-7 space-y-6">
          <div aria-hidden className="store-skeleton h-64 w-full rounded-2xl" />
          <div aria-hidden className="store-skeleton h-48 w-full rounded-2xl" />
        </div>
        <div className="lg:col-span-5 space-y-4">
          <div aria-hidden className="store-skeleton h-80 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

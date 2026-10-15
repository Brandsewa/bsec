import React from "react";

export default function CheckoutFailedLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 lg:px-8">
      <div aria-hidden className="store-skeleton mx-auto mb-6 h-20 w-20 rounded-full" />
      <div aria-hidden className="store-skeleton mx-auto h-9 w-72 rounded" />
    </div>
  );
}

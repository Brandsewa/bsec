import React from "react";

export default function ThankYouLoading() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 lg:px-8 text-center space-y-6">
      <div aria-hidden className="store-skeleton h-16 w-16 rounded-full mx-auto" />
      <div aria-hidden className="store-skeleton h-8 w-64 rounded mx-auto" />
      <div aria-hidden className="store-skeleton h-4 w-80 rounded mx-auto" />
      <div aria-hidden className="store-skeleton h-32 w-full rounded-2xl mx-auto" />
    </div>
  );
}

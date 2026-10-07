import React from "react";
import { DetailPageSkeleton } from "@bs/ui";

export default function ThankYouLoading() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 lg:px-8">
      <DetailPageSkeleton />
    </div>
  );
}


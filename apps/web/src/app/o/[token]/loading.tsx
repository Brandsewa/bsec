import React from "react";
import { DetailPageSkeleton } from "@bs/ui";

export default function OrderTrackingLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
      <DetailPageSkeleton />
    </div>
  );
}


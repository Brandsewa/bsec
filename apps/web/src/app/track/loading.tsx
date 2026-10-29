import React from "react";
import { DetailPageSkeleton } from "@bs/ui";

export default function TrackOrderLoading() {
  return (
    <div className="mx-auto max-w-lg px-4 py-16 sm:px-6">
      <DetailPageSkeleton />
    </div>
  );
}

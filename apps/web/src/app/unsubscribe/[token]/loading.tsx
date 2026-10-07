import React from "react";
import { AuthCardSkeleton } from "@bs/ui";

export default function Loading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <AuthCardSkeleton />
    </div>
  );
}


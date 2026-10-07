import React from "react";
import { AuthCardSkeleton } from "@bs/ui";

/** Route skeleton matching signup/page.tsx so nothing shifts when content streams in. */
export default function SignupLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <AuthCardSkeleton />
    </div>
  );
}


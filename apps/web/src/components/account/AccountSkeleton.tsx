import React from "react";
import { AccountPageSkeleton, AuthCardSkeleton } from "@bs/ui";

/** Placeholder while an account or token page loads. `card` is an auth card skeleton, `list` an account page skeleton. */
export function AccountSkeleton({ variant = "list" }: { variant?: "list" | "card" }) {
  if (variant === "card") {
    return <AuthCardSkeleton />;
  }
  return <AccountPageSkeleton />;
}


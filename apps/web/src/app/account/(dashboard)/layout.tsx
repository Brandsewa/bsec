import React, { Suspense } from "react";
import { AccountPageSkeleton } from "@bs/ui";
import { AccountGate } from "@/components/account/AccountGate.tsx";

/**
 * The signed-in pages (orders, addresses, profile). A visitor sees the sign-in screen here. The public pages (sign in, create
 * account, forgot and reset password, verify email) live next to this group, outside the gate, so they can be reached signed out.
 */
export default function AccountDashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<AccountPageSkeleton />}>
      <AccountGate>{children}</AccountGate>
    </Suspense>
  );
}

import React, { Suspense } from "react";
import type { Metadata } from "next";
import { AccountSkeleton } from "@/components/account/AccountSkeleton.tsx";
import { AccountGate } from "@/components/account/AccountGate.tsx";

export const metadata: Metadata = {
  title: "My Account",
  description: "Your orders, saved addresses and profile",
  robots: { index: false, follow: false },
};

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<AccountSkeleton />}>
      <AccountGate>{children}</AccountGate>
    </Suspense>
  );
}

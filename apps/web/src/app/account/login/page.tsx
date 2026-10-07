import React from "react";
import type { Metadata } from "next";
import { AuthShell } from "@bs/ui";
import { resolveStore } from "@/server/customer-session.ts";
import { getCachedStoreName } from "@/server/cached-storefront.ts";
import { LoginForm } from "@/components/account/LoginForm.tsx";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default async function LoginPage() {
  const store = await resolveStore();
  const storeName = store ? await getCachedStoreName(store.tenantId).catch(() => "Store") : "Store";

  return (
    <AuthShell
      variant="store"
      brand={{ name: storeName }}
      title="Sign in"
      description="Access your orders, addresses, and account details."
    >
      <LoginForm initialTab="password" />
    </AuthShell>
  );
}

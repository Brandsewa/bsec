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

/** Only same-site paths: an absolute or protocol-relative address would turn the sign-in into an open redirect. */
function safeNext(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.startsWith("/") && !v.startsWith("//") && !v.includes("\\") ? v : undefined;
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const next = safeNext((await searchParams)["next"]);
  const store = await resolveStore();
  const storeName = store ? await getCachedStoreName(store.tenantId).catch(() => "Store") : "Store";

  return (
    <AuthShell
      variant="store"
      brand={{ name: storeName }}
      title="Sign in"
      description="Access your orders, addresses, and account details."
    >
      <LoginForm initialTab="password" {...(next ? { redirectTo: next } : {})} />
    </AuthShell>
  );
}

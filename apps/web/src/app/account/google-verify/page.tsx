import React from "react";
import type { Metadata } from "next";
import { AuthShell } from "@bs/ui";
import { resolveStore } from "@/server/customer-session.ts";
import { getCachedStoreName } from "@/server/cached-storefront.ts";
import { GoogleVerifyClient } from "@/components/account/GoogleVerifyClient.tsx";

export const metadata: Metadata = {
  title: "Test Google sign-in",
  robots: { index: false, follow: false },
};

/** Opened from Store Admin on the store's own domain: runs one real Google sign-in to prove the owner's setup works. */
export default async function GoogleVerifyPage() {
  const store = await resolveStore();
  const storeName = store ? await getCachedStoreName(store.tenantId).catch(() => "Store") : "Store";
  return (
    <AuthShell
      variant="store"
      brand={{ name: storeName }}
      title="Test Google sign-in"
      description="Sign in once with Google to confirm your setup works on this domain."
    >
      <GoogleVerifyClient />
    </AuthShell>
  );
}

import React, { Suspense } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { evaluateStorefrontAccess } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { getCachedBrandSettings, getCachedThemeTokens } from "@/server/cached-storefront.ts";
import { computeThemeTokens } from "@/components/storefront/theme-tokens.ts";
import { deriveAccent } from "@bs/ui/server";
import { AccountPageSkeleton } from "@bs/ui";
import { AccountGate } from "@/components/account/AccountGate.tsx";

export const metadata: Metadata = {
  title: "My Account",
  description: "Your orders, saved addresses and profile",
  robots: { index: false, follow: false },
};

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  let primaryColor: string | undefined;

  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });

    if (access.tenantId) {
      const [brandSettings, activeThemeTokens] = await Promise.all([
        getCachedBrandSettings(access.tenantId).catch(() => null),
        getCachedThemeTokens(access.tenantId).catch(() => null),
      ]);

      const themeVars = activeThemeTokens
        ? computeThemeTokens(null, activeThemeTokens)
        : computeThemeTokens(brandSettings, null);

      primaryColor = themeVars["--bs-primary"] || themeVars["--color-primary"];
    }
  } catch {
    // Fall back to default platform mint
  }

  // Derive accent for the account subtree only, falling back to platform mint #00d4a4
  const derived = deriveAccent(primaryColor) ?? deriveAccent("#00d4a4") ?? {
    fill: "#00d4a4",
    deep: "#00a882",
    ink: "#007a5e",
    soft: "#e6fbf6",
    ring: "#00d4a4",
    onFill: "#000000",
  };

  const accountAccentVars = {
    "--brand": derived.fill,
    "--brand-deep": derived.deep,
    "--brand-ink": derived.ink,
    "--brand-soft": derived.soft,
    "--ring": derived.ring,
  } as React.CSSProperties;

  return (
    <div data-store-accent className="min-h-screen bg-background text-foreground" style={accountAccentVars}>
      <Suspense fallback={<AccountPageSkeleton />}>
        <AccountGate>{children}</AccountGate>
      </Suspense>
    </div>
  );
}

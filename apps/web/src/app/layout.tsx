import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { cacheTag } from "next/cache";
import { evaluateStorefrontAccess, tenantTag, type getBrandSettings } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { getCachedBrandSettings } from "@/server/cached-storefront.ts";
import { StoreHeader } from "@/components/storefront/StoreHeader.tsx";
import { StoreFooter } from "@/components/storefront/StoreFooter.tsx";
import { StoreStatusBanner } from "@/components/storefront/StoreStatusBanner.tsx";
import {
  ComingSoonScreen,
  MaintenanceScreen,
  PasswordScreen,
  SuspendedScreen,
  ProvisioningScreen,
} from "@/components/storefront/StoreStatusScreens.tsx";
import { computeThemeTokens } from "@/components/storefront/theme-tokens.ts";
import "./globals.css";

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });
    const isNoIndex = access.noindex ?? true;
    return {
      title: "Bs Commerce",
      description: "Launch your online store in 10 minutes.",
      robots: isNoIndex ? { index: false, follow: false } : { index: true, follow: true },
    };
  } catch {
    return {
      title: "Bs Commerce",
      description: "Launch your online store in 10 minutes.",
      robots: { index: false, follow: false },
    };
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  let access: Awaited<ReturnType<typeof evaluateStorefrontAccess>>;
  let brandSettings: Awaited<ReturnType<typeof getBrandSettings>> | null = null;
  const activeThemeTokens: Record<string, unknown> | null = null;

  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    const { rt } = server();

    access = await evaluateStorefrontAccess(rt, host, { headers: h });

    if (access.tenantId) {
      // In M3, retrieve published brand settings and theme tokens using tenant context with Cache Components
      try {
        brandSettings = await getCachedBrandSettings(access.tenantId);

        // Set tenant shell and theme cache tags for Next.js Cache Components (PLAN §11.6)
        try {
          cacheTag(tenantTag(access.tenantId, "theme"));
          cacheTag(tenantTag(access.tenantId, "store-shell"));
          cacheTag(tenantTag(access.tenantId, "nav"));
        } catch {
          // Ignore outside Next.js request context
        }
      } catch {
        // Fallback to null brand settings
      }
    }
  } catch {
    // If db/server is unconfigured during static build, fallback to allowed default
    access = {
      allowed: true,
      httpStatus: 200,
      mode: "live",
    };
  }

  // Derive theme tokens
  const themeVars = computeThemeTokens(brandSettings, activeThemeTokens);

  // Render blocked screens when access is not allowed and not in bypass mode
  if (!access.allowed && !access.isBypass) {
    let screenContent: ReactNode;

    if (access.reason === "coming_soon" || access.mode === "coming_soon") {
      screenContent = (
        <ComingSoonScreen
          headline={access.headline}
          launchAt={access.launchAt}
          showCountdown={access.showCountdown}
          collectEmails={access.collectEmails}
        />
      );
    } else if (access.reason === "maintenance" || access.mode === "maintenance") {
      screenContent = <MaintenanceScreen message={access.message} />;
    } else if (access.reason === "password_required" || access.mode === "password") {
      screenContent = <PasswordScreen />;
    } else if (access.reason === "suspended" || access.tenantStatus === "suspended") {
      screenContent = <SuspendedScreen />;
    } else if (access.reason === "provisioning" || access.tenantStatus === "provisioning") {
      screenContent = <ProvisioningScreen />;
    } else {
      screenContent = <ComingSoonScreen headline={access.headline} />;
    }

    return (
      <html lang="en" style={themeVars as React.CSSProperties}>
        <body className="min-h-dvh antialiased">{screenContent}</body>
      </html>
    );
  }

  const storeName = "Store";
  const logoWidth = typeof brandSettings?.logoWidth === "number" ? brandSettings.logoWidth : 150;

  return (
    <html lang="en" style={themeVars as React.CSSProperties}>
      <body className="flex min-h-dvh flex-col antialiased">
        <StoreStatusBanner isBypass={access.isBypass} mode={access.mode} />
        <StoreHeader storeName={storeName} logoWidth={logoWidth} />
        <main className="flex-1">{children}</main>
        <StoreFooter storeName={storeName} />
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { cacheTag } from "next/cache";
import { evaluateStorefrontAccess, tenantTag, type getBrandSettings } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { isPlatformMarketingHost } from "@/server/hosts.ts";
import { getCachedBrandSettings, getCachedStoreName, getCachedThemePage, getCachedThemeTokens } from "@/server/cached-storefront.ts";
import { StoreHeader } from "@/components/storefront/StoreHeader.tsx";
import { StoreFooter } from "@/components/storefront/StoreFooter.tsx";
import { ThemeChrome } from "@/components/storefront/ThemeChrome.tsx";
import { StoreStatusBanner } from "@/components/storefront/StoreStatusBanner.tsx";
import {
  ComingSoonScreen,
  MaintenanceScreen,
  PasswordScreen,
  SuspendedScreen,
  ProvisioningScreen,
} from "@/components/storefront/StoreStatusScreens.tsx";
import { computeThemeTokens } from "@/components/storefront/theme-tokens.ts";
import { googleFontsHref } from "@bs/blocks/theme-vars";
import { fontSans, fontMono } from "@/lib/fonts.ts";
import { makeThemeBootScript } from "@bs/ui/server";
import { WebThemeProvider } from "@/components/theme/WebThemeProvider.tsx";
import { THEMED_PATH_SOURCE } from "@/lib/themed-paths.ts";
import "./globals.css";

const themeBootScript = makeThemeBootScript(THEMED_PATH_SOURCE);

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    // The platform's own public site is meant to be found: the page sets its title and description.
    if (isPlatformMarketingHost(host)) {
      return { title: "Bs Commerce", description: "Launch your online store in 10 minutes.", robots: { index: true, follow: true } };
    }
    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });
    const isNoIndex = access.noindex ?? true;
    if (access.tenantId) {
      const name = await getCachedStoreName(access.tenantId).catch(() => "Store");
      return {
        title: name,
        description: `Shop at ${name}.`,
        robots: isNoIndex ? { index: false, follow: false } : { index: true, follow: true },
      };
    }
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
  // bcom.si and www.bcom.si are the platform's marketing site and signup, not a store: no store gate,
  // header, footer or "coming soon" screen. (Without this the page was always hidden behind "Opening Soon".)
  let isMarketing = false;
  try {
    const h = await headers();
    isMarketing = isPlatformMarketingHost(h.get("x-forwarded-host") ?? h.get("host"));
  } catch {
    // no request context (static build): treat as a store host, as before
  }
  if (isMarketing) {
    return (
      <html lang="en" suppressHydrationWarning className={`${fontSans.variable} ${fontMono.variable}`}>
        <head>
          <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        </head>
        <body className="min-h-dvh antialiased">
          <WebThemeProvider>{children}</WebThemeProvider>
        </body>
      </html>
    );
  }

  let access: Awaited<ReturnType<typeof evaluateStorefrontAccess>>;
  let brandSettings: Awaited<ReturnType<typeof getBrandSettings>> | null = null;
  let storeName = "Store";
  // Set when the store uses the theme system (activated a library theme / saved theme settings);
  // otherwise its Branding settings keep deciding the look, exactly as before.
  let activeThemeTokens: Record<string, unknown> | null = null;
  let themeHeader: Awaited<ReturnType<typeof getCachedThemePage>> = null;
  let themeFooter: Awaited<ReturnType<typeof getCachedThemePage>> = null;

  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";

    const { rt } = server();

    access = await evaluateStorefrontAccess(rt, host, { headers: h });

    if (access.tenantId) {
      storeName = await getCachedStoreName(access.tenantId).catch(() => "Store");
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

      try {
        [activeThemeTokens, themeHeader, themeFooter] = await Promise.all([
          getCachedThemeTokens(access.tenantId),
          getCachedThemePage(access.tenantId, "header"),
          getCachedThemePage(access.tenantId, "footer"),
        ]);
      } catch {
        // Built-in header, footer and Branding colours apply
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
  const themeVars = activeThemeTokens ? computeThemeTokens(null, activeThemeTokens) : computeThemeTokens(brandSettings, null);
  const fontsHref = googleFontsHref(activeThemeTokens);

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
      <html lang="en" suppressHydrationWarning className={`${fontSans.variable} ${fontMono.variable}`} style={themeVars as React.CSSProperties}>
        <head>
          <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        </head>
        <body className="min-h-dvh antialiased">
          <WebThemeProvider>{screenContent}</WebThemeProvider>
        </body>
      </html>
    );
  }

  const logoWidth = typeof brandSettings?.logoWidth === "number" ? brandSettings.logoWidth : 150;

  return (
    <html lang="en" suppressHydrationWarning className={`${fontSans.variable} ${fontMono.variable}`} style={themeVars as React.CSSProperties}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        {fontsHref ? <link rel="stylesheet" href={fontsHref} precedence="default" /> : null}
      </head>
      <body className="flex min-h-dvh flex-col antialiased">
        <WebThemeProvider>
          <StoreStatusBanner isBypass={access.isBypass} mode={access.mode} />
          {themeHeader ? (
            <ThemeChrome blocks={themeHeader.blocks} renderData={themeHeader.renderData} storeName={storeName} />
          ) : (
            <StoreHeader storeName={storeName} logoWidth={logoWidth} />
          )}
          <main className="flex-1">{children}</main>
          {themeFooter ? (
            <ThemeChrome blocks={themeFooter.blocks} renderData={themeFooter.renderData} storeName={storeName} />
          ) : (
            <StoreFooter storeName={storeName} />
          )}
        </WebThemeProvider>
      </body>
    </html>
  );
}

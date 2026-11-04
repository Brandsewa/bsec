import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies, headers } from "next/headers";
import { cacheTag } from "next/cache";
import { evaluateStorefrontAccess, platformSiteHeaderLinks, tenantTag, type getBrandSettings } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { SiteNavProvider } from "@/components/marketing/home/site-nav.tsx";
import { isPlatformMarketingHost } from "@/server/hosts.ts";
import { siteChrome, siteStatus } from "@/server/site-settings.ts";
import { getCachedBrandSettings, getCachedDefaultPages, getCachedStoreName, getCachedThemePage, getCachedThemeTokens } from "@/server/cached-storefront.ts";
import { MiniCartConfigProvider, type MiniCartCopy } from "@/components/storefront/MiniCartConfig.tsx";
import { StoreHeader } from "@/components/storefront/StoreHeader.tsx";
import { StoreFooter } from "@/components/storefront/StoreFooter.tsx";
import { ThemeChrome } from "@/components/storefront/ThemeChrome.tsx";
import { CartBadge } from "@/components/storefront/CartBadge.tsx";
import { SearchModal } from "@/components/storefront/SearchModal.tsx";
import { MobileBottomNav } from "@/components/storefront/MobileBottomNav.tsx";
import { StoreStatusBanner } from "@/components/storefront/StoreStatusBanner.tsx";
import {
  ComingSoonScreen,
  MaintenanceScreen,
  PasswordScreen,
  SuspendedScreen,
  ProvisioningScreen,
} from "@/components/storefront/StoreStatusScreens.tsx";
import { computeThemeTokens } from "@/components/storefront/theme-tokens.ts";
import { googleFontsHref, themeFontFallbackCss } from "@bs/blocks/theme-vars";
import { WEBSITE_BLOCK_VARS, renderBlockTree, websiteThemeCss } from "@bs/blocks";
import { BannerClient } from "@/components/blocks/BannerClient.tsx";
import { fontSans, fontMono } from "@/lib/fonts.ts";
import { makeThemeBootScript } from "@bs/ui/server";
import { WebThemeProvider } from "@/components/theme/WebThemeProvider.tsx";
import { countryName } from "@bs/contracts/countries";
import { MarketProvider } from "@/components/market/MarketProvider.tsx";
import { getMarketContext, type MarketContext } from "@/server/market.ts";
import { PATH_HEADER, PIN_ERROR_COOKIE } from "@/lib/market-constants.ts";
import { PincodeGate } from "@/components/market/pincode-gate.tsx";
import { THEMED_PATH_SOURCE } from "@/lib/themed-paths.ts";
import "./globals.css";

const themeBootScript = makeThemeBootScript(THEMED_PATH_SOURCE);
const websiteBlockCss = `.mk{${Object.entries(WEBSITE_BLOCK_VARS).map(([k, v]) => `${k}:${v}`).join(";")}}`;
/** The platform's own site follows the visitor's theme on every path; on a store host only the guarded paths do. */
const marketingThemeBootScript = makeThemeBootScript();

/**
 * Newsletter forms (footer, newsletter block, status screens) are plain HTML posts; without this the shopper lands on the raw JSON
 * reply. This sends them in the background and shows the message under the form. Inline on purpose: it adds nothing to the JS
 * bundle. A form that React already handled (the blog's) is left alone, and without JavaScript the normal post still works.
 */
const newsletterScript = `document.addEventListener("submit",function(e){var f=e.target;if(e.defaultPrevented||!f||!f.action||f.action.indexOf("/api/storefront/newsletter/subscribe")<0)return;e.preventDefault();var b=f.querySelector("button[type=submit]");if(b)b.disabled=true;fetch(f.action,{method:"POST",body:new FormData(f),headers:{Accept:"application/json"}}).then(function(r){return r.json().catch(function(){return null}).then(function(d){return{ok:r.ok&&(!d||d.success!==false),m:d&&d.message}})}).catch(function(){return{ok:false}}).then(function(x){if(b)b.disabled=false;var p=f.nextElementSibling;if(!p||!p.hasAttribute("data-nl-msg")){p=document.createElement("p");p.setAttribute("data-nl-msg","");p.setAttribute("role","status");p.style.cssText="margin:.5rem 0 0;font-size:.8125rem";f.after(p)}if(x.ok)f.reset();p.textContent=x.m||(x.ok?"Subscribed successfully":"Could not subscribe. Please try again.")})});`;

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    // The platform's own public site is meant to be found: the page sets its title and description.
    if (isPlatformMarketingHost(host)) {
      // Website visibility and "hide from search engines" in Super Admin > Storefront > Settings (ADR-042).
      const site = await siteStatus();
      const indexable = site.mode === "live" && !site.hideFromSearchEngines;
      return { title: "BCOM", description: "Launch your online store in 10 minutes.", robots: { index: indexable, follow: indexable } };
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
      title: "BCOM",
      description: "Launch your online store in 10 minutes.",
      robots: isNoIndex ? { index: false, follow: false } : { index: true, follow: true },
    };
  } catch {
    return {
      title: "BCOM",
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
    // A failed read keeps the built-in links; the marketing site must not depend on this query.
    const chrome = await siteChrome().catch(() => ({ header: null, announcement: null, footer: null, theme: null }));
    const design = websiteThemeCss(chrome.theme);
    const navLinks = await platformSiteHeaderLinks(server().rt._db.db, chrome.header?.menuHandle ?? "header").catch(() => null);
    const announcement = chrome.announcement
      ? renderBlockTree([{ id: "site-announcement", type: "Banner", version: 1, props: chrome.announcement }], { renderBanner: ({ children }) => <BannerClient>{children}</BannerClient> })
      : null;
    return (
      <html lang="en" suppressHydrationWarning className={`${fontSans.variable} ${fontMono.variable}`}>
        <head>
          <script dangerouslySetInnerHTML={{ __html: marketingThemeBootScript }} />
          {/* The store widgets read --bs-*; on the website they follow its own palette (light and dark). */}
          <style dangerouslySetInnerHTML={{ __html: websiteBlockCss + design.css }} />
          {design.fontsHref ? <link rel="stylesheet" href={design.fontsHref} /> : null}
        </head>
        <body className="min-h-dvh antialiased">
          <WebThemeProvider always>
            <SiteNavProvider links={navLinks} header={chrome.header} announcement={announcement}>{children}</SiteNavProvider>
          </WebThemeProvider>
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
  let miniCartCopy: MiniCartCopy | undefined;
  let themeHeader: Awaited<ReturnType<typeof getCachedThemePage>> = null;
  let themeFooter: Awaited<ReturnType<typeof getCachedThemePage>> = null;
  let marketCtx: MarketContext | null = null;
  let requestPath = "/";
  let requestHost = "localhost";
  let pinError: string | null = null;

  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";

    const { rt } = server();

    access = await evaluateStorefrontAccess(rt, host, { headers: h });
    requestHost = host;
    requestPath = h.get(PATH_HEADER) ?? "/";

    if (access.tenantId) {
      marketCtx = await getMarketContext(access.tenantId).catch(() => null);
      if (marketCtx?.regionState.needsPincode) pinError = (await cookies()).get(PIN_ERROR_COOKIE)?.value ?? null;
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

      miniCartCopy = await getCachedDefaultPages(access.tenantId).then((d) => d.miniCart).catch(() => undefined);

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
  const fontFallbackCss = themeFontFallbackCss(activeThemeTokens);

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
        <script dangerouslySetInnerHTML={{ __html: newsletterScript }} />
        {fontsHref ? (
          <>
            {/* Open the font connections while the stylesheet is still being fetched (it is render-blocking). */}
            <link rel="preconnect" href="https://fonts.googleapis.com" />
            <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
            {fontFallbackCss ? <style dangerouslySetInnerHTML={{ __html: fontFallbackCss }} /> : null}
            <link rel="stylesheet" href={fontsHref} precedence="default" />
          </>
        ) : null}
        {marketCtx && marketCtx.markets.length > 1
          ? [
              ...marketCtx.markets.map((m) => (
                <link key={m.id} rel="alternate" hrefLang={m.locale ?? (m.currency === "USD" ? "en-US" : m.currency === "CAD" ? "en-CA" : "en-IN")} href={`https://${requestHost}${m.pathPrefix ?? ""}${requestPath}`} />
              )),
              <link key="x-default" rel="alternate" hrefLang="x-default" href={`https://${requestHost}${requestPath}`} />,
            ]
          : null}
      </head>
      <body className="flex min-h-dvh flex-col antialiased">
        <WebThemeProvider>
          <MarketProvider value={{ currency: marketCtx?.currency ?? "INR", locale: marketCtx?.locale ?? "en-IN", prefix: marketCtx?.prefix ?? "", ...(marketCtx && marketCtx.markets.length > 1 && marketCtx.market ? { markets: marketCtx.markets.map((m) => ({ handle: m.handle, name: m.name, currency: m.currency, countries: m.countries.map((code) => ({ code, name: countryName(code) })) })), currentHandle: marketCtx.market.handle, path: requestPath } : {}) }}>
          <MiniCartConfigProvider copy={miniCartCopy}>
          {marketCtx?.regionState.needsPincode ? <PincodeGate error={pinError} /> : null}
          <StoreStatusBanner isBypass={access.isBypass} mode={access.mode} />
          {themeHeader ? (
            <ThemeChrome blocks={themeHeader.blocks} renderData={themeHeader.renderData} storeName={storeName} currency={marketCtx?.currency ?? "INR"} locale={marketCtx?.locale ?? "en-IN"} />
          ) : (
            <StoreHeader storeName={storeName} logoWidth={logoWidth} />
          )}
          <main className="flex-1">{children}</main>
          {themeFooter ? (
            <ThemeChrome blocks={themeFooter.blocks} renderData={themeFooter.renderData} storeName={storeName} currency={marketCtx?.currency ?? "INR"} locale={marketCtx?.locale ?? "en-IN"} />
          ) : (
            <StoreFooter storeName={storeName} />
          )}
          <SearchModal />
          <CartBadge dock />
          {themeHeader ? <MobileBottomNav /> : null}
          </MiniCartConfigProvider>
          </MarketProvider>
        </WebThemeProvider>
      </body>
    </html>
  );
}

import { evaluateStorefrontAccess } from "@bs/domain";
import { isPlatformMarketingHost } from "@/server/hosts.ts";
import { server } from "@/server/runtime.ts";
import { getCachedBrandAssets, getCachedBrandSettings, getCachedStoreName } from "@/server/cached-storefront.ts";
import { buildStoreWebManifest } from "@/lib/web-manifest.ts";

const HEADERS = {
  "Content-Type": "application/manifest+json; charset=utf-8",
  "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
};

/**
 * /manifest.webmanifest: the store's name, colours and icons for browsers and "add to home screen" (docs/SEO-GEO-AEO-PLAN.md
 * Phase 2). Built from Brand settings only; a store with no icons still gets a valid manifest. The platform's own site has its own
 * manifest at /api/brand/manifest.
 */
export async function GET(req: Request) {
  try {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost";
    if (isPlatformMarketingHost(host)) return new Response("Not found", { status: 404 });
    const access = await evaluateStorefrontAccess(server().rt, host, { headers: req.headers });
    if (!access.tenantId) return new Response("Not found", { status: 404 });
    const [name, assets, brand] = await Promise.all([
      getCachedStoreName(access.tenantId).catch(() => "Store"),
      getCachedBrandAssets(access.tenantId).catch(() => null),
      getCachedBrandSettings(access.tenantId).catch(() => null),
    ]);
    const manifest = buildStoreWebManifest({
      name,
      assets,
      themeColor: brand?.primaryColor,
      backgroundColor: brand?.backgroundColor,
    });
    return new Response(JSON.stringify(manifest), { status: 200, headers: HEADERS });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

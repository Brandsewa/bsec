import { evaluateStorefrontAccess, getStoreSettings, getStorefrontLlmsTxt, getStorefrontSeoSettings } from "@bs/domain";
import { isPlatformMarketingHost } from "@/server/hosts.ts";
import { server } from "@/server/runtime.ts";

const HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
};

/**
 * /llms.txt: a Markdown map of the store for AI agents and answer engines (llmstxt.org). It lists what the sitemap
 * lists, so it follows the same rules: a store that is hidden from search engines, not live, or not found has none.
 */
export async function GET(req: Request) {
  try {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost";
    // The platform's own marketing site is not a store; it has no catalogue to describe.
    if (isPlatformMarketingHost(host)) return new Response("Not found", { status: 404 });

    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: req.headers });
    const blockedModes = ["coming_soon", "password", "maintenance", "suspended"];
    if (!access.tenantId || access.noindex === true || (access.mode && blockedModes.includes(access.mode))) {
      return new Response("Not found", { status: 404 });
    }

    const ctx = {
      tenantId: access.tenantId,
      storeStatus: access.mode ?? "live",
      actor: { type: "system" as const },
      roles: ["store_admin"],
      permissions: ["products.read", "settings.write", "content.write"],
      requestId: crypto.randomUUID(),
    };
    const [store, seo] = await Promise.all([
      getStoreSettings(rt, ctx).catch(() => null),
      getStorefrontSeoSettings(rt, ctx).catch(() => null),
    ]);
    const body = await getStorefrontLlmsTxt(rt, ctx, host.split(",")[0]?.trim() ?? host, {
      storeName: store?.storeName ?? "Store",
      summary: seo?.defaultMetaDescription,
    });
    return new Response(body, { status: 200, headers: HEADERS });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

import { evaluateStorefrontAccess, generateRobotsTxt, getStorefrontSeoSettings } from "@bs/domain";
import { isPlatformMarketingHost } from "@/server/hosts.ts";
import { server } from "@/server/runtime.ts";
import { siteStatus } from "@/server/site-settings.ts";

export async function GET(req: Request) {
  try {
    const host =
      req.headers.get("x-forwarded-host") ??
      req.headers.get("host") ??
      "localhost";

    // The platform's own site is meant to be found (and reviewed by payment providers): allow the public pages.
    if (isPlatformMarketingHost(host)) {
      const proto = req.headers.get("x-forwarded-proto") ?? "https";
      const origin = `${proto}://${host.split(",")[0]?.trim()}`;
      const site = await siteStatus();
      if (site.mode !== "live" || site.hideFromSearchEngines) {
        return new Response("User-agent: *" + String.fromCharCode(10) + "Disallow: /" + String.fromCharCode(10), { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=60" } });
      }
      return new Response(`User-agent: *
Allow: /
Disallow: /api/
Disallow: /preview/

Sitemap: ${origin}/sitemap.xml
`, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
        },
      });
    }

    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: req.headers });

    if (!access.tenantId) {
      return new Response("User-agent: *\nDisallow: /\n", {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
        },
      });
    }

    const tenantCtx = {
      tenantId: access.tenantId,
      storeStatus: access.mode ?? "live",
      actor: { type: "system" as const },
      roles: ["store_admin"],
      permissions: ["settings.write"],
      requestId: crypto.randomUUID(),
    };

    const seoSettings = await getStorefrontSeoSettings(rt, tenantCtx).catch(() => null);
    const robotsTxt = generateRobotsTxt(seoSettings, access.mode ?? "live", host);

    return new Response(robotsTxt, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
      },
    });
  } catch {
    return new Response("User-agent: *\nDisallow: /\n", {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
      },
    });
  }
}

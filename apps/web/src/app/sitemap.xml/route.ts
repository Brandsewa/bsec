import {
  evaluateStorefrontAccess,
  generateSitemapXml,
  getStorefrontSitemapUrls,
} from "@bs/domain";
import { server } from "@/server/runtime.ts";

export async function GET(req: Request) {
  const headers = {
    "Content-Type": "application/xml; charset=utf-8",
    "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
  };

  try {
    const host =
      req.headers.get("x-forwarded-host") ??
      req.headers.get("host") ??
      "localhost";

    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: req.headers });

    // If no tenant or indexing is disallowed
    const blockedModes = ["coming_soon", "password", "maintenance", "suspended"];
    if (
      !access.tenantId ||
      access.noindex === true ||
      (access.mode && blockedModes.includes(access.mode))
    ) {
      return new Response(generateSitemapXml([]), {
        status: 200,
        headers,
      });
    }

    const tenantCtx = {
      tenantId: access.tenantId,
      storeStatus: access.mode ?? "live",
      actor: { type: "system" as const },
      roles: ["store_admin"],
      permissions: ["products.read", "settings.write", "content.write"],
      requestId: crypto.randomUUID(),
    };

    const sitemapItems = await getStorefrontSitemapUrls(rt, tenantCtx, host);
    const xml = generateSitemapXml(sitemapItems);

    return new Response(xml, {
      status: 200,
      headers,
    });
  } catch {
    return new Response(generateSitemapXml([]), {
      status: 200,
      headers,
    });
  }
}

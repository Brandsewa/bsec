import { evaluateStorefrontAccess, generateRobotsTxt, getStorefrontSeoSettings } from "@bs/domain";
import { server } from "@/server/runtime.ts";

export async function GET(req: Request) {
  try {
    const host =
      req.headers.get("x-forwarded-host") ??
      req.headers.get("host") ??
      "localhost";

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

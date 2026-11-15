import { evaluateStorefrontAccess, indexNowEnabled, indexNowKey } from "@bs/domain";
import { server } from "@/server/runtime.ts";

/**
 * Serves the store's IndexNow key as /<key>.txt (the root path is rewritten here in next.config.ts). The protocol proves a site's
 * ownership by fetching this file from the host being notified, so it answers only for the exact key of the store the request
 * is for, and only while IndexNow is switched on.
 */
export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  try {
    const { key } = await params;
    if (!indexNowEnabled() || !/^[a-f0-9]{32}$/.test(key)) return new Response("Not found", { status: 404 });
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost";
    const access = await evaluateStorefrontAccess(server().rt, host, { headers: req.headers });
    if (!access.tenantId || indexNowKey(access.tenantId) !== key) return new Response("Not found", { status: 404 });
    return new Response(key, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

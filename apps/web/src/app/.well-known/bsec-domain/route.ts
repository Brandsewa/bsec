import { lookupDomainIdForProbe } from "@bs/domain";
import { server } from "@/server/runtime.ts";

/**
 * Public probe for custom-domain setup (docs/CUSTOM-DOMAIN-ROUTING-PLAN.md): answers which domain row owns the Host
 * header, whatever its status, so the worker can prove that DNS, Cloudflare, the proxy and this app all line up.
 * Returns only an opaque domain id, never tenant data. The path contains a dot, so the storefront gate in the
 * middleware does not run for it (it would answer 404 for a domain that is not active yet).
 */
export async function GET(req: Request) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  try {
    const { rt } = server();
    const domainId = await lookupDomainIdForProbe(rt._db.db, host);
    return Response.json(
      { domainId },
      { status: domainId ? 200 : 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } },
    );
  } catch {
    return Response.json({ domainId: null }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

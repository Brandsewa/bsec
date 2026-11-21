import { recordAnalyticsEvent, getClientIp } from "@bs/domain";
import { resolveStore, sameOrigin } from "@/server/customer-session.ts";

/** Best-effort per-connection limiter kept in memory: analytics must not spend the store's database-backed request quota. */
const hits = new Map<string, { n: number; reset: number }>();
const LIMIT_PER_MINUTE = 120;
function allowed(key: string): boolean {
  const now = Date.now();
  if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  const e = hits.get(key);
  if (!e || e.reset < now) {
    hits.set(key, { n: 1, reset: now + 60_000 });
    return true;
  }
  e.n += 1;
  return e.n <= LIMIT_PER_MINUTE;
}

/** Edge country, trusted only when the request really came through Cloudflare (cf-ray present). */
function edgeCountry(h: Headers): string | null {
  const c = h.get("cf-ipcountry");
  return c && h.get("cf-ray") && c.toUpperCase() !== "XX" ? c : null;
}

/**
 * Cookieless storefront traffic collector (ADR-047). Always answers 204 so the beacon never retries or shows an error;
 * what is ignored (bots, Do Not Track, bad input, closed stores) is decided in the domain service.
 */
export async function POST(req: Request) {
  const ok = new Response(null, { status: 204 });
  try {
    if (!sameOrigin(req)) return ok;
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret) return ok;
    const ip = getClientIp(req.headers);
    if (!allowed(ip)) return ok;
    const store = await resolveStore(req);
    // Only a live storefront is measured: not holding pages, password gates or previews.
    if (!store || store.mode !== "live") return ok;

    const body = (await req.json().catch(() => null)) as { t?: unknown; p?: unknown; r?: unknown; s?: unknown } | null;
    if (!body || typeof body.t !== "string" || typeof body.p !== "string") return ok;
    const h = req.headers;
    await recordAnalyticsEvent(
      store.rt,
      store.tenantId,
      {
        type: body.t,
        path: body.p,
        referrer: typeof body.r === "string" ? body.r.slice(0, 500) : null,
        search: typeof body.s === "string" ? body.s.slice(0, 500) : null,
        ip,
        userAgent: h.get("user-agent") ?? "",
        country: edgeCountry(h),
        doNotTrack: h.get("sec-gpc") === "1" || h.get("dnt") === "1",
        ownHost: h.get("x-forwarded-host") ?? h.get("host") ?? undefined,
      },
      { secret },
    );
  } catch {
    // never surface analytics problems to the shopper
  }
  return ok;
}

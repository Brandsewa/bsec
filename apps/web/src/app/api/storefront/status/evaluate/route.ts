import { NextResponse, type NextRequest } from "next/server";
import { evaluateStorefrontAccess, listStorefrontMarkets, recordLookupFailure } from "@bs/domain";
import { server } from "@/server/runtime.ts";

/**
 * URL prefixes of the store's active non-base markets ("/us"), for the middleware. Kept for 30 seconds per process, the same
 * trade-off as the host resolver: a new market answers on its prefix within half a minute.
 */
const PREFIX_TTL_MS = 30_000;
const prefixCache = new Map<string, { at: number; prefixes: { prefix: string; handle: string }[] }>();
async function marketPrefixes(tenantId: string): Promise<{ prefix: string; handle: string }[]> {
  const hit = prefixCache.get(tenantId);
  if (hit && Date.now() - hit.at < PREFIX_TTL_MS) return hit.prefixes;
  const { rt } = server();
  const prefixes = (await listStorefrontMarkets(rt, tenantId).catch(() => [])).flatMap((m) => (m.pathPrefix ? [{ prefix: m.pathPrefix, handle: m.handle }] : []));
  prefixCache.set(tenantId, { at: Date.now(), prefixes });
  return prefixes;
}

export async function GET(request: NextRequest) {
  const host =
    request.nextUrl.searchParams.get("host") ??
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    "localhost";

  const cookiesRecord: Record<string, string> = {};
  for (const cookie of request.cookies.getAll()) {
    cookiesRecord[cookie.name] = cookie.value;
  }

  try {
    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, {
      headers: request.headers,
      cookies: cookiesRecord,
      searchParams: request.nextUrl.searchParams,
    });

    if (access.tenantId) {
      const { checkStorefrontRateLimit, RateLimitExceededError } = await import("@bs/domain");
      try {
        await checkStorefrontRateLimit(rt._db.db, access.tenantId);
      } catch (err: unknown) {
        if (err instanceof RateLimitExceededError) {
          return NextResponse.json(
            { allowed: false, error: err.message },
            { status: 429, headers: { "Retry-After": String(err.retryAfter) } },
          );
        }
        throw err;
      }
    }

    const marketPrefixesForTenant = access.tenantId ? await marketPrefixes(access.tenantId) : [];
    return NextResponse.json({ ...access, marketPrefixes: marketPrefixesForTenant });
  } catch (error) {
    const { fallbackMode } = recordLookupFailure(host, error);

    // Fail closed if store was previously in password mode to prevent unauthenticated access
    if (fallbackMode === "password") {
      return NextResponse.json({
        allowed: false,
        reason: "password_required",
        status: "password_required",
        httpStatus: 200,
        mode: "password",
        noindex: true,
        error: error instanceof Error ? error.message : "Internal error",
      });
    }

    // Fail closed if store was previously in maintenance mode
    if (fallbackMode === "maintenance") {
      return NextResponse.json({
        allowed: false,
        reason: "maintenance",
        status: "maintenance",
        httpStatus: 503,
        mode: "maintenance",
        retryAfterSeconds: 60,
        noindex: true,
        error: error instanceof Error ? error.message : "Internal error",
      });
    }

    // Default fail-open for live stores during brief DB timeouts so live stores stay up
    return NextResponse.json({
      allowed: true,
      httpStatus: 200,
      mode: "live",
      error: error instanceof Error ? error.message : "Internal error",
    });
  }
}

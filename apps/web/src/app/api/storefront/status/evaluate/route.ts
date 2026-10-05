import { NextResponse, type NextRequest } from "next/server";
import { evaluateStorefrontAccess, recordLookupFailure } from "@bs/domain";
import { server } from "@/server/runtime.ts";

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

    return NextResponse.json(access);
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

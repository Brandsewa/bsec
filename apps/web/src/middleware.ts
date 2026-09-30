import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Skip static assets, Next.js internal routes, health check, and internal status check
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/health") ||
    pathname.startsWith("/api/storefront/status/evaluate") ||
    pathname.includes(".") // static assets like .ico, .css, .png, etc.
  ) {
    return NextResponse.next();
  }

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "localhost";
  const hostname = host.split(":")[0]?.toLowerCase() ?? "localhost";
  const platformDomain = (process.env.PLATFORM_DOMAIN || "gobs.cloud").toLowerCase();
  const marketingHost = (process.env.MARKETING_HOST || platformDomain).toLowerCase();

  // Marketing platform host (e.g. gobs.cloud, www.gobs.cloud, or MARKETING_HOST) serves public SaaS pages
  const isMarketingHost =
    hostname === marketingHost ||
    hostname === platformDomain ||
    hostname === `www.${platformDomain}` ||
    (hostname === "localhost" && (
      pathname === "/" ||
      pathname.startsWith("/signup") ||
      pathname.startsWith("/api/saas/") ||
      request.nextUrl.searchParams.get("marketing") === "true"
    ));

  // S6: Only platform marketing host serves /signup and /api/saas/*; other hosts return 404
  if (pathname.startsWith("/signup") || pathname.startsWith("/api/saas/")) {
    if (!isMarketingHost) {
      return new NextResponse("Not Found", { status: 404 });
    }
    return NextResponse.next();
  }

  // The storefront gate (store status, unknown host) must not apply to calls that are not about a storefront
  // host: the admin API, staff sign-in and provider webhooks resolve their tenant from the session or the
  // signed payload, and must keep working while a store is in maintenance, suspended, or on an unregistered
  // host such as the platform root or a staging address. CORS preflights are answered by the API itself.
  if (
    request.method === "OPTIONS" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/webhooks/") ||
    pathname.startsWith("/api/admin/") ||
    pathname.startsWith("/api/rpc/admin/")
  ) {
    return NextResponse.next();
  }

  if (isMarketingHost && pathname === "/") {
    return NextResponse.next();
  }

  let access: {
    allowed: boolean;
    httpStatus: 200 | 404 | 503;
    reason?: string | undefined;
    mode?: string | undefined;
    tenantId?: string | undefined;
    retryAfterSeconds?: number | undefined;
    noindex?: boolean | undefined;
    isBypass?: boolean | undefined;
    message?: string | undefined;
    headline?: string | null | undefined;
  };

  try {
    const evalUrl = new URL("/api/storefront/status/evaluate", request.url);
    evalUrl.searchParams.set("host", host);
    // Forward all search parameters (e.g. preview_token, previewToken) to the Node evaluation route
    for (const [key, value] of request.nextUrl.searchParams.entries()) {
      if (key !== "host") {
        evalUrl.searchParams.set(key, value);
      }
    }

    // Fail-open timeout protection:
    // If the evaluation route times out (e.g. 3s under heavy DB load), abort request
    // and fail open to prevent transient infrastructure hiccups from taking down the storefront.
    const res = await fetch(evalUrl.toString(), {
      headers: {
        ...Object.fromEntries(request.headers.entries()),
        host,
      },
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      access = await res.json();
    } else {
      // Fail open on non-200 responses from the internal evaluation endpoint
      access = { allowed: true, httpStatus: 200, mode: "live" };
    }
  } catch {
    // Fail open on fetch network errors or timeout aborts
    access = { allowed: true, httpStatus: 200, mode: "live" };
  }

  // Handle blocked access (maintenance, provisioning, suspended, archived, deleted, not found)
  if (!access.allowed && !access.isBypass) {
    const responseHeaders = new Headers();
    if (access.noindex) {
      responseHeaders.set("X-Robots-Tag", "noindex, nofollow");
    }

    if (access.httpStatus === 503) {
      if (access.retryAfterSeconds !== undefined) {
        responseHeaders.set("Retry-After", String(access.retryAfterSeconds));
      }
      responseHeaders.set("Content-Type", "text/html; charset=utf-8");

      const title = access.reason === "maintenance" ? "Store Maintenance" : "Store Unavailable";
      const message = access.message ?? "We are currently undergoing scheduled maintenance. Please check back shortly.";

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; background-color: #f8fafc; color: #0f172a; }
    .card { max-width: 28rem; padding: 2.5rem; background: #ffffff; border-radius: 1rem; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); text-align: center; }
    h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.75rem; }
    p { font-size: 0.95rem; color: #475569; line-height: 1.5; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;

      return new NextResponse(html, {
        status: 503,
        headers: responseHeaders,
      });
    }

    if (access.httpStatus === 404) {
      responseHeaders.set("Content-Type", "text/plain; charset=utf-8");
      return new NextResponse("Store Not Found", {
        status: 404,
        headers: responseHeaders,
      });
    }

    // Modes like coming_soon or password_required continue with status 200 but set X-Robots-Tag
    const response = NextResponse.next();
    if (access.noindex) {
      response.headers.set("X-Robots-Tag", "noindex, nofollow");
    }
    return response;
  }

  // Allowed request (live, bypass, unlocked password)
  const response = NextResponse.next();
  if (access.noindex) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};

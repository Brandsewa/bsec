import { NextResponse } from "next/server";
import { headers } from "next/headers";
import {
  evaluateStorefrontAccess,
  getSearchSuggestions,
  checkStorefrontRateLimit,
  RateLimitExceededError,
} from "@bs/domain";
import { server } from "@/server/runtime.ts";

export async function GET(req: Request) {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";

    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });

    if (!access.tenantId) {
      return NextResponse.json({ suggestions: [] });
    }

    try {
      await checkStorefrontRateLimit(rt._db.db, access.tenantId);
    } catch (err: unknown) {
      if (err instanceof RateLimitExceededError) {
        return NextResponse.json(
          { error: err.message },
          { status: 429, headers: { "Retry-After": String(err.retryAfter) } },
        );
      }
      throw err;
    }

    const url = new URL(req.url);
    const query = url.searchParams.get("query") ?? url.searchParams.get("q") ?? "";
    const rawLimit = url.searchParams.get("limit");
    const limit = rawLimit ? Math.max(1, Math.min(20, parseInt(rawLimit, 10) || 5)) : 5;

    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 2) {
      return NextResponse.json({ suggestions: [] });
    }

    const tenantCtx = {
      tenantId: access.tenantId,
      storeStatus: access.mode ?? "live",
      actor: { type: "system" as const },
      roles: ["store_admin"],
      permissions: ["products.read"],
      requestId: crypto.randomUUID(),
    };

    const suggestions = await getSearchSuggestions(rt, tenantCtx, trimmed, limit);

    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json({ suggestions: [] });
  }
}

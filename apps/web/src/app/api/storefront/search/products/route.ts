import { NextResponse } from "next/server";
import { getMarketContext } from "@/server/market.ts";
import { headers } from "next/headers";
import {
  evaluateStorefrontAccess,
  searchStorefrontProducts,
  checkStorefrontRateLimit,
  RateLimitExceededError,
} from "@bs/domain";
import { server } from "@/server/runtime.ts";

/**
 * Results for the storefront's search popup: enough to show and add each product (picture, price, what is needed to
 * add it to the cart). These as-you-type lookups are not logged as searches; the full /search page does that.
 */
export async function GET(req: Request) {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });
    if (!access.tenantId) return NextResponse.json({ items: [] });

    try {
      await checkStorefrontRateLimit(rt._db.db, access.tenantId);
    } catch (err: unknown) {
      if (err instanceof RateLimitExceededError) {
        return NextResponse.json({ error: err.message }, { status: 429, headers: { "Retry-After": String(err.retryAfter) } });
      }
      throw err;
    }

    const url = new URL(req.url);
    const query = (url.searchParams.get("query") ?? url.searchParams.get("q") ?? "").trim();
    if (query.length < 2) return NextResponse.json({ items: [] });

    const tenantCtx = {
      tenantId: access.tenantId,
      storeStatus: access.mode ?? "live",
      actor: { type: "system" as const },
      roles: ["store_admin"],
      permissions: ["products.read"],
      requestId: crypto.randomUUID(),
      marketId: (await getMarketContext(access.tenantId)).marketId,
    };

    const result = await searchStorefrontProducts(rt, tenantCtx, query, { limit: 8, log: false });
    return NextResponse.json({
      total: result.total,
      items: result.items.map((p) => ({
        id: p.id,
        title: p.title,
        slug: p.slug,
        imageUrl: p.primaryImage?.url,
        shortDescription: p.shortDescription,
        priceMin: p.priceMin,
        priceMax: p.priceMax,
        priceOnRequest: p.priceOnRequest ?? false,
        quickAdd: p.quickAdd,
      })),
    });
  } catch {
    return NextResponse.json({ items: [] });
  }
}

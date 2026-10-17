import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateStorefrontAccess, quoteCartShipping, checkStorefrontRateLimit, RateLimitExceededError } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { CART_COOKIE_NAME, getRequestHeaders, getCookieValue } from "../../cart/route.ts";

const Body = z.object({
  state: z.string().trim().min(1).max(60),
  country: z.string().trim().max(60).optional(),
});

/** Shipping options for the cart going to a state. Read-only and rate limited; checkout re-prices on the server when the order is placed. */
export async function POST(req: Request) {
  try {
    const h = await getRequestHeaders(req);
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";

    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });
    if (!access.tenantId) {
      return NextResponse.json({ error: "Store not found" }, { status: 404 });
    }

    try {
      await checkStorefrontRateLimit(rt._db.db, access.tenantId);
    } catch (err: unknown) {
      if (err instanceof RateLimitExceededError) {
        return NextResponse.json({ error: err.message }, { status: 429, headers: { "Retry-After": String(err.retryAfter) } });
      }
      throw err;
    }

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "A state is required" }, { status: 400 });
    }

    const token = (await getCookieValue(CART_COOKIE_NAME, req)) || "";
    if (!token) {
      return NextResponse.json({ error: "No cart" }, { status: 400 });
    }

    const tenantCtx = {
      tenantId: access.tenantId,
      storeStatus: access.mode ?? "live",
      actor: { type: "system" as const },
      roles: ["store_admin"],
      permissions: ["products.read"],
      requestId: crypto.randomUUID(),
    };

    const rates = await quoteCartShipping(rt, tenantCtx, { token, state: parsed.data.state, country: parsed.data.country });
    return NextResponse.json({ rates });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error getting shipping options";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

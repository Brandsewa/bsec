import { NextResponse } from "next/server";
import { z } from "zod";
import {
  evaluateStorefrontAccess,
  estimateCartShipping,
  checkStorefrontRateLimit,
  RateLimitExceededError,
} from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { CART_COOKIE_NAME, getRequestHeaders, getCookieValue } from "../route.ts";

const EstimateShippingSchema = z.object({
  pincode: z.string().regex(/^[1-9][0-9]{5}$/, "Invalid 6-digit Indian Pincode"),
});

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
        return NextResponse.json(
          { error: err.message },
          { status: 429, headers: { "Retry-After": String(err.retryAfter) } },
        );
      }
      throw err;
    }

    const json = await req.json().catch(() => ({}));
    const parsed = EstimateShippingSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid Indian pincode format (must be 6 digits)", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const token = (await getCookieValue(CART_COOKIE_NAME, req)) || "";

    const tenantCtx = {
      tenantId: access.tenantId,
      storeStatus: access.mode ?? "live",
      actor: { type: "system" as const },
      roles: ["store_admin"],
      permissions: ["products.read"],
      requestId: crypto.randomUUID(),
    };

    const estimate = await estimateCartShipping(rt, tenantCtx, {
      token,
      pincode: parsed.data.pincode,
    });

    return NextResponse.json(estimate);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error estimating shipping";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateStorefrontAccess, cancelOrderByToken, checkStorefrontRateLimit, RateLimitExceededError } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { getRequestHeaders } from "../../../cart/route.ts";

const Body = z.object({
  reason: z.string().trim().max(300).optional(),
});

/** A shopper cancels their order before fulfillment/shipment via their secure order-view link. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const h = await getRequestHeaders(req);
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });
    if (!access.tenantId) return NextResponse.json({ error: "Store not found" }, { status: 404 });

    try {
      await checkStorefrontRateLimit(rt._db.db, access.tenantId);
    } catch (err: unknown) {
      if (err instanceof RateLimitExceededError) {
        return NextResponse.json({ error: err.message }, { status: 429, headers: { "Retry-After": String(err.retryAfter) } });
      }
      throw err;
    }

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });

    const result = await cancelOrderByToken(
      rt,
      access.tenantId,
      token,
      parsed.data,
    );

    return NextResponse.json(result);
  } catch (err: unknown) {
    const raw = err instanceof Error ? err.message : "Could not cancel order";
    const message = raw.replace(/^(Bad Request|Not Found|Conflict|Precondition):\s*/, "");
    const known = /^(Bad Request|Not Found|Conflict|Precondition):/.test(raw);
    return NextResponse.json({ error: known ? message : "Could not cancel order" }, { status: known ? 400 : 500 });
  }
}

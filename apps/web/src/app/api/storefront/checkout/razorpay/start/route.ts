import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateStorefrontAccess, startRazorpayPaymentByToken, checkStorefrontRateLimit, RateLimitExceededError } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { getRequestHeaders } from "../../../cart/route.ts";

const Schema = z.object({ orderToken: z.string().min(10).max(200) });

/** Gives the browser what the Razorpay modal needs for an order that is still unpaid ("Pay now" on the order page). */
export async function POST(req: Request) {
  try {
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

    const parsed = Schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    const razorpay = await startRazorpayPaymentByToken(rt, access.tenantId, parsed.data.orderToken);
    return NextResponse.json({ razorpay });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message.replace(/^(Bad Request|Not Found):\s*/, "") : "Could not start the payment";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

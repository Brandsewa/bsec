import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateStorefrontAccess, startPaymentByToken, getStoreSettings, checkStorefrontRateLimit, RateLimitExceededError } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { getRequestHeaders } from "../../cart/route.ts";

const Schema = z.object({ orderToken: z.string().min(10).max(200) });

/**
 * "Pay now" for an unpaid online order, with whichever gateway the order was placed with (Razorpay modal, or the hosted
 * Stripe / PayPal page). The gateway is read from the order's own payment intent, never from the request.
 */
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

    const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
    const tenantCtx = { tenantId: access.tenantId, storeStatus: access.mode ?? "live", actor: { type: "system" as const }, roles: [], permissions: ["settings.read"], requestId: crypto.randomUUID() };
    const storeName = (await getStoreSettings(rt, tenantCtx).catch(() => null))?.storeName;
    const started = await startPaymentByToken(rt, access.tenantId, parsed.data.orderToken, { baseUrl: `${proto}://${host}`, storeName });
    return NextResponse.json(started);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message.replace(/^(Bad Request|Not Found):\s*/, "") : "Could not start the payment";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

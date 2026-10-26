import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateStorefrontAccess, confirmRazorpayPayment, checkStorefrontRateLimit, RateLimitExceededError } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { getRequestHeaders } from "../../../cart/route.ts";

const Schema = z.object({
  orderToken: z.string().min(10).max(200),
  razorpayOrderId: z.string().min(5).max(100),
  razorpayPaymentId: z.string().min(5).max(100),
  razorpaySignature: z.string().min(10).max(200),
});

/** Called by the browser when the Razorpay modal reports success; the signature is checked on the server. */
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

    const result = await confirmRazorpayPayment(rt, access.tenantId, parsed.data);
    return NextResponse.json({ result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message.replace(/^(Bad Request|Not Found):\s*/, "") : "Could not verify the payment";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

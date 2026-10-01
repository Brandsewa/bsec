import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateStorefrontAccess, requestCustomerPasswordReset, getClientIp } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { getRequestHeaders, sameOrigin } from "@/server/customer-session.ts";

const ForgotPasswordSchema = z.object({
  email: z.string().email("A valid email address is required"),
});

export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const h = await getRequestHeaders(req);
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";

    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });

    if (!access.tenantId) {
      return NextResponse.json({ error: "Store not found" }, { status: 404 });
    }

    const json = await req.json().catch(() => ({}));
    const parsed = ForgotPasswordSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "A valid email address is required", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const clientIp = getClientIp(req.headers);

    const result = await requestCustomerPasswordReset(
      rt._db.db,
      access.tenantId,
      parsed.data.email,
      { ip: clientIp },
    );

    return NextResponse.json(
      { success: true, message: result.message },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err: unknown) {
    const { RateLimitExceededError } = await import("@bs/domain");
    if (err instanceof RateLimitExceededError) {
      return NextResponse.json(
        { error: err.message },
        { status: 429, headers: { "Retry-After": String(err.retryAfter), "Cache-Control": "no-store" } },
      );
    }
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json({ error: message }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}

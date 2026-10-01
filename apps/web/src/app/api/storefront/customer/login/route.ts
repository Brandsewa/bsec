import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateStorefrontAccess, loginCustomer, getClientIp } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { customerCookie, getRequestHeaders, sameOrigin } from "@/server/customer-session.ts";

const LoginSchema = z.object({
  email: z.string().email("A valid email address is required"),
  password: z.string().min(1, "Password is required"),
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
    const parsed = LoginSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid email or password", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const clientIp = getClientIp(req.headers);

    const result = await loginCustomer(
      rt._db.db,
      access.tenantId,
      {
        email: parsed.data.email,
        password: parsed.data.password,
      },
      { ip: clientIp, userAgent: h.get("user-agent") ?? undefined },
    );

    const response = NextResponse.json(
      {
        success: true,
        customer: result.customer,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );

    response.cookies.set(customerCookie(result.token));

    return response;
  } catch (err: unknown) {
    const { RateLimitExceededError } = await import("@bs/domain");
    if (err instanceof RateLimitExceededError) {
      return NextResponse.json(
        { error: err.message },
        { status: 429, headers: { "Retry-After": String(err.retryAfter), "Cache-Control": "no-store" } },
      );
    }
    const message = err instanceof Error ? err.message : "Sign in failed";
    return NextResponse.json({ error: message }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}

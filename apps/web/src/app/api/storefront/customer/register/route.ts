import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateStorefrontAccess, registerCustomer, getClientIp } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { getRequestHeaders, sameOrigin } from "@/server/customer-session.ts";

const RegisterSchema = z.object({
  name: z.string().max(120).optional(),
  email: z.string().email("A valid email address is required").max(254),
  phone: z.string().regex(/^[6-9][0-9]{9}$/, "Valid 10-digit Indian phone number").optional().or(z.literal("")),
  password: z.string().min(10, "Password must be at least 10 characters").max(128).optional(),
  acceptsMarketing: z.boolean().optional(),
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
    const parsed = RegisterSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid registration data", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const clientIp = getClientIp(req.headers);

    await registerCustomer(
      rt._db.db,
      access.tenantId,
      {
        name: parsed.data.name,
        email: parsed.data.email,
        phone: parsed.data.phone || undefined,
        acceptsMarketing: parsed.data.acceptsMarketing,
      },
      { ip: clientIp, userAgent: h.get("user-agent") ?? undefined },
    );

    return NextResponse.json(
      {
        success: true,
        message: "An account setup link has been sent to your email.",
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (err: unknown) {
    const { RateLimitExceededError } = await import("@bs/domain");
    if (err instanceof RateLimitExceededError) {
      return NextResponse.json(
        { error: err.message },
        { status: 429, headers: { "Retry-After": String(err.retryAfter), "Cache-Control": "no-store" } },
      );
    }
    const message = err instanceof Error ? err.message : "Registration failed";
    return NextResponse.json({ error: message }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}

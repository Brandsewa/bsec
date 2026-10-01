import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateStorefrontAccess, requestCustomerOtp, getClientIp } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { sameOrigin } from "@/server/customer-session.ts";
import { getRequestHeaders } from "../../../cart/route.ts";

const RequestOtpSchema = z.object({
  phone: z.string().regex(/^[6-9][0-9]{9}$/, "Valid 10-digit Indian phone number required"),
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
    const parsed = RequestOtpSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid phone number", details: parsed.error.issues }, { status: 400 });
    }

    const clientIp = getClientIp(req.headers);

    try {
      const { checkCustomerOtpRequestLimit } = await import("@bs/domain");
      await checkCustomerOtpRequestLimit(rt._db.db, {
        tenantId: access.tenantId,
        ip: clientIp,
        phone: parsed.data.phone,
      });
    } catch (err: unknown) {
      const { RateLimitExceededError } = await import("@bs/domain");
      if (err instanceof RateLimitExceededError) {
        return NextResponse.json(
          { error: err.message },
          {
            status: 429,
            headers: {
              "Retry-After": String(err.retryAfter),
            },
          },
        );
      }
      throw err;
    }

    const result = await requestCustomerOtp(rt._db.db, access.tenantId, parsed.data.phone);

    // The code is never part of the response. Until SMS delivery is wired, local development reads it from the server log.
    if (process.env.NODE_ENV === "development") {
      server().log.info({ phone: parsed.data.phone, otp: result.devOtp }, "customer OTP (development only)");
    }

    return NextResponse.json({
      success: true,
      expiresAt: result.expiresAt,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error requesting OTP";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

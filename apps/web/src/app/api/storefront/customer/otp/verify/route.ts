import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateStorefrontAccess, verifyCustomerOtp, getClientIp } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { getRequestHeaders } from "../../../cart/route.ts";

const VerifyOtpSchema = z.object({
  phone: z.string().regex(/^[6-9][0-9]{9}$/, "Valid 10-digit Indian phone number required"),
  otp: z.string().length(6, "6-digit OTP required"),
});

export const CUSTOMER_COOKIE_NAME = "bs_customer_token";

export async function POST(req: Request) {
  try {
    const h = await getRequestHeaders(req);
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";

    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });

    if (!access.tenantId) {
      return NextResponse.json({ error: "Store not found" }, { status: 404 });
    }

    const json = await req.json().catch(() => ({}));
    const parsed = VerifyOtpSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid OTP data", details: parsed.error.issues }, { status: 400 });
    }

    const clientIp = getClientIp(req.headers);

    try {
      const { checkCustomerOtpVerifyLimit } = await import("@bs/domain");
      await checkCustomerOtpVerifyLimit(rt._db.db, {
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

    const result = await verifyCustomerOtp(
      rt._db.db,
      access.tenantId,
      parsed.data.phone,
      parsed.data.otp,
    );

    const response = NextResponse.json({
      success: true,
      customer: result.customer,
    });

    response.cookies.set({
      name: CUSTOMER_COOKIE_NAME,
      value: result.token,
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 86400, // 30 days
    });

    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error verifying OTP";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateStorefrontAccess, resetCustomerPassword } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { customerCookie, getRequestHeaders, sameOrigin } from "@/server/customer-session.ts";

const ResetPasswordSchema = z.object({
  token: z.string().min(1, "Token is required"),
  password: z.string().min(10, "Password must be at least 10 characters").max(128),
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
    const parsed = ResetPasswordSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid reset request", details: parsed.error.issues },
        { status: 400 },
      );
    }

    await resetCustomerPassword(rt._db.db, access.tenantId, {
      token: parsed.data.token,
      password: parsed.data.password,
    });

    const response = NextResponse.json(
      { success: true, message: "Your password has been reset. Please sign in." },
      { headers: { "Cache-Control": "no-store" } },
    );

    // Clear session cookie if one existed
    response.cookies.set(customerCookie("", 0));

    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Password reset failed";
    return NextResponse.json({ error: message }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateStorefrontAccess, verifyCustomerEmail } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { getRequestHeaders, sameOrigin } from "@/server/customer-session.ts";

const VerifyEmailSchema = z.object({
  token: z.string().min(1, "Verification token is required"),
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
    const parsed = VerifyEmailSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid verification link", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const result = await verifyCustomerEmail(rt._db.db, access.tenantId, parsed.data.token);

    return NextResponse.json(
      { success: true, customerId: result.customerId, message: "Your email has been verified." },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Email verification failed";
    return NextResponse.json({ error: message }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}

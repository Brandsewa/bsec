import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { revokeCustomerSession, revokeOtherCustomerSessions } from "@bs/domain";
import { CUSTOMER_COOKIE_NAME, customerApi, errorResponse } from "@/server/customer-session.ts";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("revoke"), id: z.string().min(1).max(100) }),
  z.object({ action: z.literal("revokeOthers") }),
]);

/** The signed-in shopper signs one other device, or all other devices, out. Their own session is never ended here. */
export async function POST(req: Request) {
  try {
    const ctx = await customerApi(req);
    if (ctx instanceof NextResponse) return ctx;
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    const current = (await cookies()).get(CUSTOMER_COOKIE_NAME)?.value;
    if (!current) return NextResponse.json({ error: "Please sign in again" }, { status: 401 });
    const info = { ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null, userAgent: req.headers.get("user-agent") };
    const db = ctx.store.rt._db.db;
    const result =
      parsed.data.action === "revoke"
        ? await revokeCustomerSession(db, ctx.store.tenantId, ctx.customer.id, parsed.data.id, current, info)
        : await revokeOtherCustomerSessions(db, ctx.store.tenantId, ctx.customer.id, current, info);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, "Could not sign that device out");
  }
}

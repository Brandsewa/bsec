import { NextResponse } from "next/server";
import { z } from "zod";
import { updateCustomerProfile } from "@bs/domain";
import { customerApi, errorResponse } from "@/server/customer-session.ts";

const Body = z.object({
  name: z.string().trim().max(120),
  email: z.string().trim().email("Enter a valid email address").max(254),
  acceptsMarketing: z.boolean(),
});

/** The signed-in shopper edits their name, email and marketing choice. */
export async function PUT(req: Request) {
  try {
    const ctx = await customerApi(req);
    if (ctx instanceof NextResponse) return ctx;
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    const profile = await updateCustomerProfile(ctx.store.rt._db.db, ctx.store.tenantId, ctx.customer.id, parsed.data);
    if (!profile) return NextResponse.json({ error: "Please sign in again" }, { status: 401 });
    return NextResponse.json({ profile });
  } catch (err) {
    return errorResponse(err, "Could not save your details");
  }
}

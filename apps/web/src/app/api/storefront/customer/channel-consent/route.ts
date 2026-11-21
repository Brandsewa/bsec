import { NextResponse } from "next/server";
import { z } from "zod";
import { setChannelConsent } from "@bs/domain";
import { customerApi, errorResponse } from "@/server/customer-session.ts";

const Body = z.object({ sms: z.boolean(), whatsapp: z.boolean() });

/** The signed-in shopper opts in or out of texting and WhatsApp offers (email is on the profile form). */
export async function PUT(req: Request) {
  try {
    const ctx = await customerApi(req);
    if (ctx instanceof NextResponse) return ctx;
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    const consent = await setChannelConsent(ctx.store.rt._db.db, ctx.store.tenantId, ctx.customer.id, parsed.data);
    if (!consent) return NextResponse.json({ error: "Please sign in again" }, { status: 401 });
    return NextResponse.json({ consent }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, "Could not save your choice");
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { getCustomerGooglePicture, updateCustomerProfile } from "@bs/domain";
import { currentCustomer, customerApi, errorResponse, resolveStore } from "@/server/customer-session.ts";

const Body = z.object({
  name: z.string().trim().max(120),
  email: z.string().trim().email("Enter a valid email address").max(254),
  acceptsMarketing: z.boolean(),
});

/** Whether a shopper is signed in on this store, and their name (never an error for a visitor). The review form uses it. */
export async function GET() {
  const none = NextResponse.json({ signedIn: false }, { headers: { "Cache-Control": "private, no-store" } });
  try {
    const store = await resolveStore();
    if (!store) return none;
    const customer = await currentCustomer(store);
    if (!customer) return none;
    const image = await getCustomerGooglePicture(store.rt._db.db, store.tenantId, customer.id).catch(() => null);
    return NextResponse.json({ signedIn: true, name: customer.name, image }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return none;
  }
}

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

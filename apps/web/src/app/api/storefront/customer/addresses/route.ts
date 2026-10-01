import { NextResponse } from "next/server";
import { createCustomerAddress } from "@bs/domain";
import { customerApi, errorResponse } from "@/server/customer-session.ts";
import { AddressBody } from "@/server/address-schema.ts";

/** Adds a saved address for the signed-in shopper. */
export async function POST(req: Request) {
  try {
    const ctx = await customerApi(req);
    if (ctx instanceof NextResponse) return ctx;
    const parsed = AddressBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    const address = await createCustomerAddress(ctx.store.rt._db.db, ctx.store.tenantId, ctx.customer.id, parsed.data);
    return NextResponse.json({ address });
  } catch (err) {
    return errorResponse(err, "Could not save the address");
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteCustomerAddress, updateCustomerAddress } from "@bs/domain";
import { customerApi, errorResponse } from "@/server/customer-session.ts";
import { AddressBody } from "@/server/address-schema.ts";

const IdParam = z.string().uuid();

/** Edits one of the signed-in shopper's saved addresses. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await customerApi(req);
    if (ctx instanceof NextResponse) return ctx;
    const id = IdParam.safeParse((await params).id);
    if (!id.success) return NextResponse.json({ error: "Address not found" }, { status: 404 });
    const parsed = AddressBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    const address = await updateCustomerAddress(ctx.store.rt._db.db, ctx.store.tenantId, ctx.customer.id, id.data, parsed.data);
    if (!address) return NextResponse.json({ error: "Address not found" }, { status: 404 });
    return NextResponse.json({ address });
  } catch (err) {
    return errorResponse(err, "Could not save the address");
  }
}

/** Removes one of the signed-in shopper's saved addresses. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await customerApi(req);
    if (ctx instanceof NextResponse) return ctx;
    const id = IdParam.safeParse((await params).id);
    if (!id.success) return NextResponse.json({ error: "Address not found" }, { status: 404 });
    const removed = await deleteCustomerAddress(ctx.store.rt._db.db, ctx.store.tenantId, ctx.customer.id, id.data);
    if (!removed) return NextResponse.json({ error: "Address not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err, "Could not remove the address");
  }
}

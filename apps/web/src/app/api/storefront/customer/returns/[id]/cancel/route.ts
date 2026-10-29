import { NextResponse } from "next/server";
import { cancelReturn, getCustomerReturnDetail } from "@bs/domain";
import { customerApi, errorResponse } from "@/server/customer-session.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The signed-in shopper withdraws a return they asked for, while the store has not yet looked at it. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await customerApi(req);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: "Return not found" }, { status: 404 });
    // ownership first: the domain's cancel only checks the return id
    const mine = await getCustomerReturnDetail(ctx.store.rt._db.db, ctx.store.tenantId, ctx.customer.id, id);
    if (!mine) return NextResponse.json({ error: "Return not found" }, { status: 404 });
    await cancelReturn(
      ctx.store.rt,
      { tenantId: ctx.store.tenantId, storeStatus: "live", actor: { type: "system" as const }, roles: [], permissions: [], requestId: crypto.randomUUID() },
      { returnId: id, reason: "Cancelled by customer" },
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err, "Could not cancel the return");
  }
}

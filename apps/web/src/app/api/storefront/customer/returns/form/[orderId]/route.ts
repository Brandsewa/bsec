import { NextResponse } from "next/server";
import { getOrderReturnsByToken, mintOrderViewTokenForCustomer } from "@bs/domain";
import { customerApi, errorResponse } from "@/server/customer-session.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What the return pop-up needs for one of the signed-in shopper's orders: the items, reasons and policy, and a short-lived
 * order link the existing return form uses for its calls. Anyone else's order answers 404.
 */
export async function GET(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const ctx = await customerApi(req);
    if (ctx instanceof NextResponse) return ctx;
    const { orderId } = await params;
    if (!UUID.test(orderId)) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    const token = await mintOrderViewTokenForCustomer(ctx.store.rt._db.db, ctx.store.tenantId, ctx.customer.id, orderId, 2 * 3_600_000);
    if (!token) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    const view = await getOrderReturnsByToken(ctx.store.rt, ctx.store.tenantId, token);
    if (!view || !view.canRequest) return NextResponse.json({ error: "This order can't be returned" }, { status: 409 });
    return NextResponse.json({ token, view }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return errorResponse(err, "Could not open the return form");
  }
}

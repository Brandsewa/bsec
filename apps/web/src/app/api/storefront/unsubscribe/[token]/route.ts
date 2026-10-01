import { NextResponse } from "next/server";
import { checkStorefrontRateLimit, unsubscribeByToken } from "@bs/domain";
import { errorResponse, resolveStore, sameOrigin } from "@/server/customer-session.ts";

/**
 * Turns marketing off for the customer behind the link. A plain POST (no body, no cookie) so it also serves mail
 * clients that do an RFC 8058 one-click unsubscribe. Safe to repeat.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { token } = await params;
    const store = await resolveStore(req);
    if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 });
    await checkStorefrontRateLimit(store.rt._db.db, store.tenantId);

    const ok = await unsubscribeByToken(store.rt._db.db, store.tenantId, token);
    if (!ok) return NextResponse.json({ error: "This unsubscribe link is not valid any more" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err, "Could not unsubscribe you right now");
  }
}

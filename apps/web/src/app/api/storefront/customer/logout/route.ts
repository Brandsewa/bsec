import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { destroyCustomerSession } from "@bs/domain";
import { CUSTOMER_COOKIE_NAME, customerCookie, resolveStore, sameOrigin } from "@/server/customer-session.ts";

/** Signs the shopper out: forgets the session on the server and clears the cookie. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const store = await resolveStore(req);
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 });
  const jar = await cookies();
  const raw = jar.get(CUSTOMER_COOKIE_NAME)?.value;
  if (raw) await destroyCustomerSession(store.rt._db.db, store.tenantId, raw);
  const res = NextResponse.json({ success: true });
  res.cookies.set({ ...customerCookie("", 0), maxAge: 0 });
  return res;
}

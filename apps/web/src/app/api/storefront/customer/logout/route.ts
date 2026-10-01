import { NextResponse } from "next/server";
import { evaluateStorefrontAccess, destroyCustomerSession } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { CUSTOMER_COOKIE_NAME, customerCookie, getRequestHeaders, sameOrigin } from "@/server/customer-session.ts";
import { cookies } from "next/headers";

export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const h = await getRequestHeaders(req);
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";

    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });

    if (access.tenantId) {
      const jar = await cookies();
      const token = jar.get(CUSTOMER_COOKIE_NAME)?.value;
      if (token) {
        await destroyCustomerSession(rt._db.db, access.tenantId, token);
      }
    }

    const response = NextResponse.json(
      { success: true },
      { headers: { "Cache-Control": "no-store" } },
    );

    // Delete customer session cookie
    response.cookies.set(customerCookie("", 0));

    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Sign out failed";
    return NextResponse.json({ error: message }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}

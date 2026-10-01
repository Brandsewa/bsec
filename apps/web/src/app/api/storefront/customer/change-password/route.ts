import { NextResponse } from "next/server";
import { z } from "zod";
import { changeCustomerPassword } from "@bs/domain";
import { CUSTOMER_COOKIE_NAME, currentCustomer, resolveStore, sameOrigin } from "@/server/customer-session.ts";
import { cookies } from "next/headers";

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  nextPassword: z.string().min(10, "New password must be at least 10 characters").max(128),
  revokeOtherSessions: z.boolean().optional().default(true),
});

export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const store = await resolveStore(req);
    if (!store) {
      return NextResponse.json({ error: "Store not found" }, { status: 404 });
    }

    const customer = await currentCustomer(store);
    if (!customer) {
      return NextResponse.json({ error: "Unauthorized: please sign in" }, { status: 401 });
    }

    const json = await req.json().catch(() => ({}));
    const parsed = ChangePasswordSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid password data", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const jar = await cookies();
    const currentToken = jar.get(CUSTOMER_COOKIE_NAME)?.value;

    await changeCustomerPassword(store.rt._db.db, store.tenantId, {
      customerId: customer.id,
      currentPassword: parsed.data.currentPassword,
      nextPassword: parsed.data.nextPassword,
      currentSessionToken: currentToken,
      revokeOtherSessions: parsed.data.revokeOtherSessions,
    });

    return NextResponse.json(
      { success: true, message: "Your password has been changed successfully." },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Password change failed";
    return NextResponse.json({ error: message }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}

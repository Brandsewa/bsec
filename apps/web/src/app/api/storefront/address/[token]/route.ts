import { NextResponse } from "next/server";
import { z } from "zod";
import { checkStorefrontRateLimit, updateOrderAddressByToken } from "@bs/domain";
import { errorResponse, resolveStore, sameOrigin } from "@/server/customer-session.ts";

const Body = z.object({
  fullName: z.string().trim().min(1, "Enter your name").max(120),
  addressLine1: z.string().trim().min(1, "Enter your address").max(200),
  addressLine2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1, "Enter the city").max(80),
  state: z.string().trim().min(1, "Enter the state").max(80),
  pincode: z.string().regex(/^[1-9][0-9]{5}$/, "Enter a valid 6-digit pincode"),
});

/** A shopper corrects the delivery address of an order that has not shipped; the link in the URL is their proof. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { token } = await params;
    const store = await resolveStore(req);
    if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 });
    await checkStorefrontRateLimit(store.rt._db.db, store.tenantId);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });

    const address = await updateOrderAddressByToken(store.rt._db.db, store.tenantId, token, parsed.data);
    return NextResponse.json({ address });
  } catch (err) {
    return errorResponse(err, "Could not update the address");
  }
}

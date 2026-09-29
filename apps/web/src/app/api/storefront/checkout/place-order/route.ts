import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { evaluateStorefrontAccess, clearCart } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { CART_COOKIE_NAME, getRequestHeaders, getCookieValue } from "../../cart/route.ts";

const PlaceOrderSchema = z.object({
  email: z.string().email("Valid email is required"),
  phone: z.string().regex(/^[6-9][0-9]{9}$/, "Valid 10-digit Indian phone number required"),
  fullName: z.string().min(1, "Full name is required"),
  addressLine1: z.string().min(1, "Address line 1 is required"),
  addressLine2: z.string().optional(),
  city: z.string().min(1, "City is required"),
  state: z.string().min(1, "State is required"),
  pincode: z.string().regex(/^[1-9][0-9]{5}$/, "Valid 6-digit Indian pincode required"),
  shippingMethod: z.enum(["standard", "express"]).default("standard"),
  paymentMethod: z.enum(["cod", "online"]).default("cod"),
  notes: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const h = await getRequestHeaders(req);
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";

    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });

    if (!access.tenantId) {
      return NextResponse.json({ error: "Store not found" }, { status: 404 });
    }

    const json = await req.json().catch(() => ({}));
    const parsed = PlaceOrderSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid checkout information", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const token = await getCookieValue(CART_COOKIE_NAME, req);

    const tenantCtx = {
      tenantId: access.tenantId,
      storeStatus: access.mode ?? "live",
      actor: { type: "system" as const },
      roles: ["store_admin"],
      permissions: ["products.read"],
      requestId: crypto.randomUUID(),
    };

    if (token) {
      try {
        await clearCart(rt, tenantCtx, token);
      } catch {
        // Non-fatal if clearing cart rows fails or already empty
      }
    }

    const orderToken = `ord_${randomUUID()}`;
    const redirectUrl = `/orders/${orderToken}/thank-you`;

    const response = NextResponse.json({
      success: true,
      orderToken,
      redirectUrl,
    });

    // Clear cart token cookie
    response.cookies.set({
      name: CART_COOKIE_NAME,
      value: "",
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 0,
    });

    response.cookies.set({
      name: "bs_cart_count",
      value: "0",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 0,
    });

    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error placing order";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

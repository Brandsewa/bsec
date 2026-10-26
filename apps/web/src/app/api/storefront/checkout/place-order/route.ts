import { NextResponse } from "next/server";
import { z } from "zod";
import {
  evaluateStorefrontAccess,
  placeOrder,
  startRazorpayPayment,
  FeatureDisabledError,
  checkStorefrontRateLimit,
  RateLimitExceededError,
  registerCustomer,
  getClientIp,
} from "@bs/domain";
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
  // The method id of one of the store's own shipping rates (as listed on the checkout page).
  shippingMethod: z.string().min(1).max(64).optional(),
  paymentMethod: z.enum(["cod", "razorpay", "online"]).default("cod"),
  notes: z.string().optional(),
  termsConsent: z.boolean().optional(),
  marketingConsent: z.boolean().optional(),
  // A business buyer: company name, and the GSTIN when they want it on the invoice.
  // A guest ticked "Create an account": after the order is placed we send them the usual set-your-password email.
  createAccount: z.boolean().optional(),
  businessOrder: z
    .object({
      companyName: z.string().trim().min(1, "Company name is required").max(120),
      taxId: z.string().trim().max(15).optional(),
    })
    .optional(),
  // Deliver somewhere other than the billing address, to its own contact.
  shipTo: z
    .object({
      fullName: z.string().trim().min(1, "Shipping name is required").max(120),
      email: z.string().trim().email().max(255).optional().or(z.literal("")),
      phone: z.string().regex(/^[6-9][0-9]{9}$/, "Valid 10-digit shipping contact number required"),
      addressLine1: z.string().trim().min(1, "Shipping address is required").max(200),
      city: z.string().trim().min(1).max(80),
      state: z.string().trim().min(1).max(80),
      pincode: z.string().regex(/^[1-9][0-9]{5}$/, "Valid 6-digit shipping pincode required"),
    })
    .optional(),
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

    try {
      await checkStorefrontRateLimit(rt._db.db, access.tenantId);
    } catch (err: unknown) {
      if (err instanceof RateLimitExceededError) {
        return NextResponse.json(
          { error: err.message },
          { status: 429, headers: { "Retry-After": String(err.retryAfter) } },
        );
      }
      throw err;
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
    if (!token) {
      return NextResponse.json({ error: "No active shopping cart" }, { status: 400 });
    }

    const tenantCtx = {
      tenantId: access.tenantId,
      storeStatus: access.mode ?? "live",
      actor: { type: "system" as const },
      roles: ["store_admin"],
      permissions: ["products.read"],
      requestId: crypto.randomUUID(),
    };

    const bodyObj = typeof json === "object" && json !== null ? (json as Record<string, unknown>) : {};
    const idempotencyKey =
      h.get("idempotency-key") ??
      (typeof bodyObj.idempotencyKey === "string" ? bodyObj.idempotencyKey : undefined);
    const paymentMethod = parsed.data.paymentMethod === "online" ? "razorpay" : parsed.data.paymentMethod;
    const orderResult = await placeOrder(rt, tenantCtx, {
      cartToken: token,
      idempotencyKey,
      email: parsed.data.email,
      phone: parsed.data.phone,
      fullName: parsed.data.fullName,
      addressLine1: parsed.data.addressLine1,
      addressLine2: parsed.data.addressLine2,
      city: parsed.data.city,
      state: parsed.data.state,
      pincode: parsed.data.pincode,
      shippingMethod: parsed.data.shippingMethod,
      paymentMethod,
      notes: parsed.data.notes,
      termsConsent: parsed.data.termsConsent,
      marketingConsent: parsed.data.marketingConsent,
      businessOrder: parsed.data.businessOrder,
      shipTo: parsed.data.shipTo ? { ...parsed.data.shipTo, email: parsed.data.shipTo.email || undefined } : undefined,
    });

    if (parsed.data.createAccount) {
      // The order is already placed: a failure here (existing account, sign-up disabled) must not fail it.
      await registerCustomer(
        rt._db.db,
        tenantCtx.tenantId,
        { name: parsed.data.fullName, email: parsed.data.email, phone: parsed.data.phone, acceptsMarketing: parsed.data.marketingConsent },
        { ip: getClientIp(req.headers), userAgent: req.headers.get("user-agent") ?? undefined },
      ).catch(() => undefined);
    }

    // Online payment: the order is saved first, then the Razorpay order is created for it. If Razorpay cannot be reached
    // the order still exists and its page offers "Pay now", so nothing is lost and the shopper is never double-charged.
    let razorpay: Awaited<ReturnType<typeof startRazorpayPayment>> | undefined;
    if (paymentMethod !== "cod") {
      razorpay = await startRazorpayPayment(rt, tenantCtx.tenantId, orderResult.orderId).catch(() => undefined);
    }

    const response = NextResponse.json({ ...orderResult, razorpay }, { status: 200 });

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
    const isFeatureDisabled =
      err instanceof FeatureDisabledError ||
      (typeof err === "object" && err !== null && (err as { statusCode?: number }).statusCode === 503) ||
      (err instanceof Error && /disabled/i.test(err.message));
    return NextResponse.json({ error: message }, { status: isFeatureDisabled ? 503 : 400 });
  }
}

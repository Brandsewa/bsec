import { NextResponse } from "next/server";
import { abandonUnpaidOnlineOrder, evaluateStorefrontAccess } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { CART_COOKIE_NAME, getRequestHeaders, getCookieValue } from "../../cart/route.ts";

/** Holds the cart token while an online payment is open, so an abandoned payment can put the items back (httpOnly, 2 hours). */
const PENDING_CART_COOKIE = "bs_pending_cart";

async function abandon(req: Request, orderToken: string | null) {
  const h = await getRequestHeaders(req);
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const { rt } = server();
  const access = await evaluateStorefrontAccess(rt, host, { headers: h });
  if (!access.tenantId) return { ok: false as const, cartToken: null };
  const cartToken = await getCookieValue(PENDING_CART_COOKIE, req);
  if (orderToken && cartToken) {
    const result = await abandonUnpaidOnlineOrder(rt, access.tenantId, orderToken, cartToken).catch(() => ({ restored: false }));
    return { ok: result.restored, cartToken: result.restored ? cartToken : null };
  }
  return { ok: false as const, cartToken: null };
}

function applyCookies(res: NextResponse, cartToken: string | null) {
  const secure = process.env.NODE_ENV === "production";
  if (cartToken) {
    res.cookies.set({ name: CART_COOKIE_NAME, value: cartToken, path: "/", httpOnly: true, secure, sameSite: "lax", maxAge: 60 * 60 * 24 * 30 });
    res.cookies.set({ name: "bs_cart_count", value: "1", path: "/", secure, sameSite: "lax", maxAge: 60 * 60 * 24 * 30 });
  }
  res.cookies.set({ name: PENDING_CART_COOKIE, value: "", path: "/", httpOnly: true, secure, sameSite: "lax", maxAge: 0 });
  return res;
}

/** The shopper closed or failed the gateway payment (Razorpay): the held order is cancelled and the cart restored. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { orderToken?: unknown; reason?: unknown };
  const { cartToken } = await abandon(req, typeof body.orderToken === "string" ? body.orderToken : null);
  const state = body.reason === "failed" ? "failed" : "cancelled";
  return applyCookies(NextResponse.json({ redirectUrl: `/checkout?payment=${state}` }), cartToken);
}

/** The shopper pressed Cancel on a Stripe or PayPal page (their cancel URL lands here). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const { cartToken } = await abandon(req, url.searchParams.get("ot"));
  return applyCookies(NextResponse.redirect(new URL("/checkout?payment=cancelled", url)), cartToken);
}

import { NextResponse } from "next/server";
import { evaluateStorefrontAccess, confirmHostedReturn } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { getRequestHeaders } from "../../cart/route.ts";
import { publicUrl } from "@/lib/request-origin.ts";

/**
 * The shopper returns from Stripe's or PayPal's hosted page. The order is settled from what the provider itself reports (a
 * Stripe Checkout Session read with the store's key, or a PayPal capture), never from anything in this URL; then the shopper
 * goes to the order page, which shows the result. The signed webhook is the backstop if they never come back.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const provider = url.searchParams.get("provider");
  const orderToken = url.searchParams.get("ot") ?? "";
  const paypalOrderId = url.searchParams.get("token") ?? undefined; // PayPal adds its own order id as ?token=
  const thankYou = `/orders/${encodeURIComponent(orderToken)}/thank-you`;
  // Redirect on the shopper's own origin, never req.url (that is the server's bind address behind the proxy).
  const h = await getRequestHeaders(req);
  const go = (path: string) => NextResponse.redirect(publicUrl(h, path), 303);
  try {
    if ((provider !== "stripe" && provider !== "paypal") || orderToken.length < 10) return go("/");
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });
    if (!access.tenantId) return go("/");
    const result = await confirmHostedReturn(rt, access.tenantId, provider, { orderToken, paypalOrderId });
    return go(result === "ignored" ? `${thankYou}?payment=failed` : thankYou);
  } catch {
    return go(`${thankYou}?payment=failed`);
  }
}

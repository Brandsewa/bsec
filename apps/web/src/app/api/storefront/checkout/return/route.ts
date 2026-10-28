import { NextResponse } from "next/server";
import { evaluateStorefrontAccess, confirmHostedReturn } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { getRequestHeaders } from "../../cart/route.ts";

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
  try {
    if ((provider !== "stripe" && provider !== "paypal") || orderToken.length < 10) return NextResponse.redirect(new URL("/", req.url), 303);
    const h = await getRequestHeaders(req);
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });
    if (!access.tenantId) return NextResponse.redirect(new URL("/", req.url), 303);
    const result = await confirmHostedReturn(rt, access.tenantId, provider, { orderToken, paypalOrderId });
    return NextResponse.redirect(new URL(result === "ignored" ? `${thankYou}?payment=failed` : thankYou, req.url), 303);
  } catch {
    return NextResponse.redirect(new URL(`${thankYou}?payment=failed`, req.url), 303);
  }
}

import React from "react";
import type { Metadata } from "next";
import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { buildBeginCheckoutEvent, getClientIp, recordServerEvent, getCustomerAddresses, getCustomerProfile, evaluateStorefrontAccess, getOrCreateCart, getTenantShippingRates, getStorefrontCheckoutOptions, getStorefrontCheckoutConsent, getCheckoutTurnstileSiteKey } from "@bs/domain";
import { accountContext } from "@/server/customer-session.ts";
import { server } from "@/server/runtime.ts";
import { getCachedDefaultPages } from "@/server/cached-storefront.ts";
import { CheckoutContainer } from "@/components/checkout/CheckoutContainer.tsx";
import { CART_COOKIE_NAME } from "@/app/api/storefront/cart/route.ts";
import { getMarketContext } from "@/server/market.ts";
import { ShopEvent } from "@/components/analytics/ShopEvent.tsx";
import { checkoutChallengeMode } from "@/lib/turnstile-bridge.ts";

export const metadata: Metadata = {
  title: "Checkout",
  description: "Secure Checkout",
  robots: { index: false, follow: false },
};

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ payment?: string; country?: string }> }) {
  const { payment, country: wantedCountry } = await searchParams;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";

  const { rt } = server();
  const access = await evaluateStorefrontAccess(rt, host, { headers: h });

  if (!access.tenantId) {
    redirect("/cart");
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(CART_COOKIE_NAME)?.value;

  if (!token) {
    redirect("/cart");
  }

  const tenantCtx = {
    tenantId: access.tenantId,
    storeStatus: access.mode ?? "live",
    actor: { type: "system" as const },
    roles: ["store_admin"],
    permissions: ["products.read"],
    requestId: crypto.randomUUID(),
  };

  const marketCtx = await getMarketContext(access.tenantId);
  const cart = await getOrCreateCart(rt, { ...tenantCtx, priceRegion: marketCtx.region }, token, undefined, marketCtx.marketId);

  if (!cart.items || cart.items.length === 0) {
    redirect("/cart");
  }

  // The store's own shipping options, priced by the same function the order uses, so the total shown is the total charged.
  const options = await getStorefrontCheckoutOptions(rt, access.tenantId, cart.marketId);
  const cartMarket = marketCtx.markets.find((m) => m.id === cart.marketId);
  const rates = await getTenantShippingRates(rt._db.db, access.tenantId, cart.subtotal, cartMarket ? { market: { id: cartMarket.id, isBase: cartMarket.isBase }, destination: { country: options.defaultCountry } } : {});
  const shippingRates = rates.map((r) => ({
    method: r.method,
    title: r.title,
    description: r.description,
    estimatedDays: r.estimatedDays,
    amount: r.amount,
  }));

  const consent = await getStorefrontCheckoutConsent(rt, access.tenantId);
  const paymentOptions = { codEnabled: options.cod.enabled, codFeePaise: options.cod.feePaise, onlineAvailable: options.online.available, methods: options.methods, stripeElements: options.stripeElements };
  // A shopper who picked a country in another market arrives here with ?country=; it is honoured when this market sells to it.
  const requested = (wantedCountry ?? "").toUpperCase();
  const region = { countries: options.countries, defaultCountry: options.countries.includes(requested) ? requested : options.defaultCountry };

  // With more than one market, the shopper chooses the country first; each country belongs to one market (its prices, shipping and payment methods).
  const currentHandle = cartMarket?.handle ?? marketCtx.market?.handle ?? "";
  const countryPicker =
    marketCtx.markets.length > 1
      ? {
          currentMarketHandle: currentHandle,
          options: marketCtx.markets.flatMap((m) => m.countries.map((code) => ({ code, marketHandle: m.handle }))).sort((a, b) => a.code.localeCompare(b.code)),
        }
      : undefined;

  // A signed-in shopper starts with their saved address chosen (default first).
  const account = await accountContext();
  const addresses = account ? await getCustomerAddresses(rt._db.db, access.tenantId, account.customer.id) : [];
  const profile = account ? await getCustomerProfile(rt._db.db, access.tenantId, account.customer.id) : null;
  const savedAddresses = [...addresses].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  const customerEmail = profile && !profile.emailIsPlaceholder ? profile.email : "";

  const copy = (await getCachedDefaultPages(access.tenantId)).checkout;

  // Cloudflare lists only a few hostnames per Turnstile widget, so a store on its own domain gets the challenge from a frame on the platform host.
  const turnstileSiteKey = getCheckoutTurnstileSiteKey();
  const challenge = checkoutChallengeMode(host);

  // Meta Conversions API InitiateCheckout (ADR-047, slice 5c). One per cart (a refresh is the same event); the id also goes to the
  // browser pixel so Meta counts it once. Recorded only for visitors who accepted marketing cookies, on stores that saved a token.
  const checkoutEvent = buildBeginCheckoutEvent(cart);
  const checkoutEventId = checkoutEvent
    ? await recordServerEvent(rt, access.tenantId, {
        name: "InitiateCheckout",
        eventId: `ic_${cart.id}`,
        currency: checkoutEvent.currency,
        value: checkoutEvent.value,
        items: checkoutEvent.items.map((i) => ({ id: i.id, quantity: i.quantity, price: i.price })),
        req: { cookieHeader: h.get("cookie"), ip: getClientIp(h), userAgent: h.get("user-agent"), sourceUrl: h.get("referer") },
      })
    : null;

  return (
    // The heading is centred and the spacing kept tight; each step sits in a grey panel (.bs-panel).
    <div className="bs-skin">
      <ShopEvent tenantId={access.tenantId} build={() => (checkoutEvent ? { ...checkoutEvent, eventId: checkoutEventId ?? undefined } : null)} />
      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-8 lg:px-8">
      <h1 className="mb-4 text-center text-xl font-extrabold tracking-tight text-foreground sm:mb-6 sm:text-3xl">
        {copy.heading}
      </h1>

      {payment === "cancelled" || payment === "failed" ? (
        <p role="alert" className="mb-4 rounded-lg border border-border bg-muted px-4 py-3 text-center text-sm text-foreground">
          {payment === "failed"
            ? "Your payment did not go through, and no order was placed. Your cart is saved: please try again or choose another way to pay."
            : "Payment cancelled, and no order was placed. Your cart is saved: complete the payment when you are ready."}
        </p>
      ) : null}

      <CheckoutContainer cart={cart} shippingRates={shippingRates} paymentOptions={paymentOptions} consent={consent} savedAddresses={savedAddresses} customerEmail={customerEmail} signedIn={Boolean(account)} region={region} display={options.display} countryPicker={countryPicker} turnstileSiteKey={turnstileSiteKey} turnstileBridgeOrigin={turnstileSiteKey && challenge.mode === "bridge" ? challenge.origin : null} />

      {copy.showTrustBadges ? (
        <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <li>Secure checkout</li>
          <li>Review your order before you pay</li>
        </ul>
      ) : null}
      {copy.note ? <p className="mt-4 text-sm text-muted-foreground">{copy.note}</p> : null}
      </div>
    </div>
  );
}

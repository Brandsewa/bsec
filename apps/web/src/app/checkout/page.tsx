import React from "react";
import type { Metadata } from "next";
import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCustomerAddresses, getCustomerProfile, evaluateStorefrontAccess, getOrCreateCart, getTenantShippingRates, getStorefrontCheckoutOptions, getStorefrontCheckoutConsent } from "@bs/domain";
import { accountContext } from "@/server/customer-session.ts";
import { server } from "@/server/runtime.ts";
import { getCachedDefaultPages } from "@/server/cached-storefront.ts";
import { CheckoutContainer } from "@/components/checkout/CheckoutContainer.tsx";
import { CART_COOKIE_NAME } from "@/app/api/storefront/cart/route.ts";
import { getMarketContext } from "@/server/market.ts";

export const metadata: Metadata = {
  title: "Checkout",
  description: "Secure Checkout",
  robots: { index: false, follow: false },
};

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ payment?: string }> }) {
  const { payment } = await searchParams;
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
  const cart = await getOrCreateCart(rt, tenantCtx, token, undefined, marketCtx.marketId);

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
  const paymentOptions = { codEnabled: options.cod.enabled, codFeePaise: options.cod.feePaise, onlineAvailable: options.online.available, methods: options.methods };
  const region = { countries: options.countries, defaultCountry: options.defaultCountry };

  // A signed-in shopper starts with their saved address chosen (default first).
  const account = await accountContext();
  const addresses = account ? await getCustomerAddresses(rt._db.db, access.tenantId, account.customer.id) : [];
  const profile = account ? await getCustomerProfile(rt._db.db, access.tenantId, account.customer.id) : null;
  const savedAddresses = [...addresses].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  const customerEmail = profile && !profile.emailIsPlaceholder ? profile.email : "";

  const copy = (await getCachedDefaultPages(access.tenantId)).checkout;

  return (
    // The heading is centred and the spacing kept tight; each step sits in a grey panel (.bs-panel).
    <div className="bs-skin">
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

      <CheckoutContainer cart={cart} shippingRates={shippingRates} paymentOptions={paymentOptions} consent={consent} savedAddresses={savedAddresses} customerEmail={customerEmail} signedIn={Boolean(account)} region={region} />

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

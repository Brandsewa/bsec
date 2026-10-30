"use client";

import React, { useCallback, useId, useState } from "react";
import { useRouter } from "next/navigation";
import type { StorefrontCart, StorefrontCheckoutConsent } from "@bs/domain";
import { priceOrder } from "@bs/domain/pricing";
import { CheckoutForm, type CheckoutRegion, type CheckoutShippingRate, type CheckoutPaymentOptions, type SavedCheckoutAddress } from "./CheckoutForm.tsx";
import { useMoney } from "@/components/market/MarketProvider.tsx";
import { OrderSummary } from "./OrderSummary.tsx";

export interface CheckoutContainerProps {
  cart: StorefrontCart;
  /** The store's own shipping options for this cart, priced on the server. */
  shippingRates: CheckoutShippingRate[];
  /** Which payment methods this store offers. */
  paymentOptions: CheckoutPaymentOptions;
  /** Which consent boxes the store shows above the Place Order button. */
  consent: StorefrontCheckoutConsent;
  /** The signed-in shopper's address book and email; empty for a guest. */
  savedAddresses?: SavedCheckoutAddress[];
  customerEmail?: string;
  signedIn?: boolean;
  /** The countries this market ships to (ADR-040); omitted for India-only stores. */
  region?: CheckoutRegion | undefined;
}

export function CheckoutContainer({ cart, shippingRates: initialRates, paymentOptions, consent, savedAddresses, customerEmail, signedIn, region }: CheckoutContainerProps) {
  const router = useRouter();
  const money = useMoney();
  const summaryId = useId();
  // The store's shipping options can depend on where the order ships (zones by state), so they refresh when the shopper
  // picks a state. The server prices the order again when it is placed, so this only keeps what is shown accurate.
  const [shippingRates, setShippingRates] = useState<CheckoutShippingRate[]>(initialRates);
  const [shippingMethod, setShippingMethod] = useState<string>(initialRates[0]?.method ?? "");
  const refreshRates = useCallback(async (state: string, country: string) => {
    try {
      const res = await fetch("/api/storefront/checkout/shipping-rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, country }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { rates?: Array<{ id: string; title: string; description: string; amount: number; estimatedDays: string }> };
      if (!data.rates || data.rates.length === 0) return;
      const next: CheckoutShippingRate[] = data.rates.map((r) => ({ method: r.id, title: r.title, description: r.description, estimatedDays: r.estimatedDays, amount: r.amount }));
      setShippingRates(next);
      setShippingMethod((current) => (next.some((r) => r.method === current) ? current : (next[0]?.method ?? "")));
    } catch {
      // Keep the options already shown; placing the order re-checks them on the server.
    }
  }, []);
  const [summaryOpen, setSummaryOpen] = useState(false);

  const firstMethod = paymentOptions.methods ? (paymentOptions.methods[0] === "razorpay" ? "online" : paymentOptions.methods[0]) : paymentOptions.codEnabled ? "cod" : "online";
  const [paymentMethod, setPaymentMethod] = useState<"cod" | "online" | "stripe" | "paypal">(firstMethod ?? "cod");
  const codOffered = paymentOptions.methods ? paymentOptions.methods.includes("cod") : paymentOptions.codEnabled;
  const codFeePaise = paymentMethod === "cod" && codOffered ? paymentOptions.codFeePaise : 0;

  const shippingPaise = shippingRates.find((r) => r.method === shippingMethod)?.amount ?? shippingRates[0]?.amount ?? 0;
  const total = priceOrder({
    subtotal: cart.subtotal,
    shipping: shippingPaise,
    codFee: codFeePaise,
    discount: cart.discount ? { type: cart.discount.type, discountAmount: cart.discount.amount } : null,
  }).grandTotal;
  const totalLabel = money(total);

  return (
    <div className="grid grid-cols-1 items-start gap-4 sm:gap-6 lg:grid-cols-12 lg:gap-10">
      {/* Order review: first and collapsed on phones, the grey panel beside the form on desktop. One instance, so its fields exist once. */}
      <div className="lg:order-2 lg:col-span-5 lg:sticky lg:top-24">
        <button
          type="button"
          onClick={() => setSummaryOpen((o) => !o)}
          aria-expanded={summaryOpen}
          aria-controls={summaryId}
          className="flex w-full items-center justify-between bs-panel px-4 py-3.5 text-left lg:hidden"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-foreground">
            <svg aria-hidden className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <circle cx="8" cy="21" r="1" />
              <circle cx="19" cy="21" r="1" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
            </svg>
            {summaryOpen ? "Hide order summary" : "Show order summary"}
            <svg aria-hidden className={`h-4 w-4 transition-transform ${summaryOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
            </svg>
          </span>
          <span className="text-base font-bold text-foreground">{totalLabel}</span>
        </button>
        <div id={summaryId} className={`${summaryOpen ? "mt-3 block" : "hidden"} lg:mt-0 lg:block`}>
          <OrderSummary cart={cart} shippingPaise={shippingPaise} codFeePaise={codFeePaise} onCartChange={() => router.refresh()} />
        </div>
      </div>

      {/* Checkout input forms (Customer info, address, shipping, payment) */}
      <div className="lg:order-1 lg:col-span-7">
        <CheckoutForm
          cart={cart}
          shippingRates={shippingRates}
          paymentOptions={paymentOptions}
          consent={consent}
          savedAddresses={savedAddresses ?? []}
          customerEmail={customerEmail ?? ""}
          signedIn={signedIn ?? false}
          region={region}
          paymentMethod={paymentMethod}
          onPaymentMethodChange={setPaymentMethod}
          shippingMethod={shippingMethod}
          onShippingMethodChange={setShippingMethod}
          onShippingStateChange={refreshRates}
        />
      </div>
    </div>
  );
}

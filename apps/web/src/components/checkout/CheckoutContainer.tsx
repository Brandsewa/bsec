"use client";

import React, { useState } from "react";
import type { StorefrontCart } from "@bs/domain";
import { CheckoutForm, type CheckoutShippingRate, type CheckoutPaymentOptions } from "./CheckoutForm.tsx";
import { OrderSummary } from "./OrderSummary.tsx";

export interface CheckoutContainerProps {
  cart: StorefrontCart;
  /** The store's own shipping options for this cart, priced on the server. */
  shippingRates: CheckoutShippingRate[];
  /** Which payment methods this store offers. */
  paymentOptions: CheckoutPaymentOptions;
}

export function CheckoutContainer({ cart, shippingRates, paymentOptions }: CheckoutContainerProps) {
  const [shippingMethod, setShippingMethod] = useState<string>(shippingRates[0]?.method ?? "");

  const [paymentMethod, setPaymentMethod] = useState<"cod" | "online">(paymentOptions.codEnabled ? "cod" : "online");
  const codFeePaise = paymentMethod === "cod" && paymentOptions.codEnabled ? paymentOptions.codFeePaise : 0;

  const shippingPaise = shippingRates.find((r) => r.method === shippingMethod)?.amount ?? shippingRates[0]?.amount ?? 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
      {/* Checkout input forms (Customer info, address, shipping, payment) */}
      <div className="lg:col-span-7">
        <CheckoutForm
          cart={cart}
          shippingRates={shippingRates}
          paymentOptions={paymentOptions}
          paymentMethod={paymentMethod}
          onPaymentMethodChange={setPaymentMethod}
          shippingMethod={shippingMethod}
          onShippingMethodChange={setShippingMethod}
        />
      </div>

      {/* Order review & totals */}
      <div className="lg:col-span-5">
        <OrderSummary cart={cart} shippingPaise={shippingPaise} codFeePaise={codFeePaise} />
      </div>
    </div>
  );
}

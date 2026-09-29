"use client";

import React, { useState } from "react";
import type { StorefrontCart } from "@bs/domain";
import { CheckoutForm } from "./CheckoutForm.tsx";
import { OrderSummary } from "./OrderSummary.tsx";

export interface CheckoutContainerProps {
  cart: StorefrontCart;
}

export function CheckoutContainer({ cart }: CheckoutContainerProps) {
  const [shippingMethod, setShippingMethod] = useState<"standard" | "express">("standard");

  const shippingPaise =
    shippingMethod === "standard"
      ? cart.subtotal >= 99900
        ? 0
        : 5000
      : 12000;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
      {/* Checkout input forms (Customer info, address, shipping, payment) */}
      <div className="lg:col-span-7">
        <CheckoutForm
          cart={cart}
          shippingMethod={shippingMethod}
          onShippingMethodChange={setShippingMethod}
        />
      </div>

      {/* Order review & totals */}
      <div className="lg:col-span-5">
        <OrderSummary cart={cart} shippingPaise={shippingPaise} />
      </div>
    </div>
  );
}

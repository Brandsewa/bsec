"use client";

import React, { useState } from "react";
import Link from "next/link";
import type { StorefrontCart } from "@bs/domain";
import { CartItemRow } from "./CartItemRow.tsx";
import { ShippingEstimator } from "./ShippingEstimator.tsx";
import { DiscountCodeBox } from "./DiscountCodeBox.tsx";
import { priceOrder } from "@bs/domain/pricing";
import type { CartContentsOptions } from "@bs/blocks";

export const DEFAULT_CART_CONTENTS_OPTIONS: CartContentsOptions = {
  summaryPosition: "right",
  stickySummary: true,
  showDiscountCode: true,
  showShippingEstimator: true,
  heading: "Shopping Cart",
  checkoutLabel: "Proceed to Checkout",
  showFreeShippingBar: false,
  showTrustPoints: false,
  stickyMobileCheckout: false,
  showContinueShopping: true,
};

export interface CartViewProps {
  cart: StorefrontCart;
  /** Layout choices from the theme's cart template; the defaults reproduce the built-in layout. */
  options?: CartContentsOptions | undefined;
  /** The store's own free-shipping threshold in paise (from its shipping settings), when it has one. */
  freeShippingThresholdPaise?: number | null | undefined;
}

export function CartView({ cart: initialCart, options = DEFAULT_CART_CONTENTS_OPTIONS, freeShippingThresholdPaise }: CartViewProps) {
  const [cart, setCart] = useState<StorefrontCart>(initialCart);
  const [loading, setLoading] = useState(false);

  const handleUpdateQuantity = async (itemId: string, quantity: number) => {
    setLoading(true);
    try {
      const res = await fetch("/api/storefront/cart/items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, quantity }),
      });
      if (res.ok) {
        const data = await res.json();
        setCart(data.cart ?? data);
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("cart-updated"));
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveItem = async (itemId: string) => {
    setLoading(true);
    try {
      const res = await fetch("/api/storefront/cart/items", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
      if (res.ok) {
        const data = await res.json();
        setCart(data.cart ?? data);
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("cart-updated"));
        }
      }
    } finally {
      setLoading(false);
    }
  };

  if (!cart.items || cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-muted mb-6">
          <svg
            className="h-10 w-10 text-muted-foreground"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
              d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
            />
          </svg>
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Your cart is empty</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Looks like you haven&apos;t added any items to your shopping cart yet.
        </p>
        <div className="mt-8">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90 transition-opacity"
          >
            Continue Shopping
          </Link>
        </div>
      </div>
    );
  }

  const inr = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN")}`;
  const formattedSubtotal = inr(cart.subtotal);
  // shipping is only known at checkout, so the estimate here is goods minus any goods discount
  const estimate = priceOrder({
    subtotal: cart.subtotal,
    shipping: 0,
    codFee: 0,
    discount: cart.discount ? { type: cart.discount.type, discountAmount: cart.discount.amount } : null,
  });

  return (
    <div className={`mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 ${options.stickyMobileCheckout ? "pb-28 lg:pb-8" : ""}`}>
      <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground mb-6">
        {options.heading ?? "Shopping Cart"} ({cart.itemCount} {cart.itemCount === 1 ? "item" : "items"})
      </h1>

      {options.showFreeShippingBar && freeShippingThresholdPaise ? (
        <FreeShippingBar subtotal={cart.subtotal} thresholdPaise={freeShippingThresholdPaise} inr={inr} />
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
        {/* Cart items list */}
        <div className={`lg:col-span-8 flex flex-col ${options.summaryPosition === "left" ? "lg:order-2" : ""} ${loading ? "opacity-60 pointer-events-none" : ""}`}>
          <div className="divide-y divide-border">
            {cart.items.map((item) => (
              <CartItemRow
                key={item.id}
                item={item}
                onUpdateQuantity={handleUpdateQuantity}
                onRemove={handleRemoveItem}
              />
            ))}
          </div>
        </div>

        {/* Order summary sidebar */}
        <div className={`lg:col-span-4 flex flex-col gap-6 ${options.summaryPosition === "left" ? "lg:order-1" : ""} ${options.stickySummary ? "lg:sticky lg:top-24" : ""}`}>
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <h2 className="text-lg font-bold text-foreground mb-4">Order Summary</h2>

            <div className="flex justify-between items-center text-sm py-2">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-semibold text-foreground">{formattedSubtotal}</span>
            </div>

            {estimate.discountTotal > 0 && cart.discount && (
              <div className="flex justify-between items-center text-sm py-2" data-testid="discount-line">
                <span className="text-muted-foreground">Discount ({cart.discount.code})</span>
                <span className="font-semibold text-emerald-700">−{inr(estimate.discountTotal)}</span>
              </div>
            )}

            <div className="flex justify-between items-center text-sm py-2 border-b border-border/60">
              <span className="text-muted-foreground">Shipping</span>
              <span className="text-xs text-muted-foreground">
                {cart.discount?.freeShipping ? "Free with your code" : "Calculated at checkout"}
              </span>
            </div>

            <div className="flex justify-between items-center text-base font-bold py-4">
              <span>Estimated Total</span>
              <span className="text-xl text-foreground">{inr(estimate.grandTotal)}</span>
            </div>

            {options.showDiscountCode ? (
              <div className="mb-4">
                <DiscountCodeBox cart={cart} onChange={setCart} />
              </div>
            ) : null}

            <p className="text-xs text-muted-foreground mb-6">
              GST included. Delivery options are calculated at checkout.
            </p>

            <Link
              href="/checkout"
              className="w-full flex items-center justify-center rounded-xl bg-primary py-3.5 px-6 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90 transition-opacity"
            >
              {options.checkoutLabel ?? "Proceed to Checkout"}
            </Link>

            {options.showTrustPoints && options.trustPoints && options.trustPoints.length > 0 ? (
              <ul className="mt-4 flex flex-col gap-1.5 text-xs text-muted-foreground">
                {options.trustPoints.map((point) => (
                  <li key={point} className="inline-flex items-center gap-1.5">
                    <svg className="h-3.5 w-3.5 text-emerald-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 011.4-1.4l3.8 3.8 6.8-6.8a1 1 0 011.4 0z" clipRule="evenodd" />
                    </svg>
                    {point}
                  </li>
                ))}
              </ul>
            ) : null}

            {options.showContinueShopping !== false ? (
              <div className="mt-4 text-center">
                <Link href="/" className="text-xs text-primary hover:underline">
                  or Continue Shopping
                </Link>
              </div>
            ) : null}
          </div>

          {/* Shipping estimator box */}
          {options.showShippingEstimator ? <ShippingEstimator /> : null}
        </div>
      </div>

      {options.stickyMobileCheckout ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-xl items-center gap-3">
            <div className="flex-1">
              <p className="text-xs text-muted-foreground">Estimated total</p>
              <p className="text-base font-bold text-foreground">{inr(estimate.grandTotal)}</p>
            </div>
            <Link href="/checkout" className="rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-sm">
              {options.checkoutLabel ?? "Proceed to Checkout"}
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Progress towards the store's free-shipping threshold; the real shipping price is still decided at checkout. */
function FreeShippingBar({ subtotal, thresholdPaise, inr }: { subtotal: number; thresholdPaise: number; inr: (paise: number) => string }) {
  const reached = subtotal >= thresholdPaise;
  const percent = Math.min(100, Math.round((subtotal / thresholdPaise) * 100));
  return (
    <div className="mb-8 rounded-xl border border-border bg-surface/60 p-4" data-testid="free-shipping-bar">
      <p className="text-sm font-medium text-foreground">
        {reached ? "You have unlocked free shipping" : `Add ${inr(thresholdPaise - subtotal)} more for free shipping`}
      </p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

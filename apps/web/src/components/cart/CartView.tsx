"use client";

import React, { useState } from "react";
import Link from "next/link";
import type { StorefrontCart } from "@bs/domain";
import { CartItemRow } from "./CartItemRow.tsx";
import { ShippingEstimator } from "./ShippingEstimator.tsx";

export interface CartViewProps {
  cart: StorefrontCart;
}

export function CartView({ cart: initialCart }: CartViewProps) {
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

  const formattedSubtotal = `₹${(cart.subtotal / 100).toLocaleString("en-IN")}`;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground mb-8">
        Shopping Cart ({cart.itemCount} {cart.itemCount === 1 ? "item" : "items"})
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
        {/* Cart items list */}
        <div className={`lg:col-span-8 flex flex-col ${loading ? "opacity-60 pointer-events-none" : ""}`}>
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
        <div className="lg:col-span-4 flex flex-col gap-6">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <h2 className="text-lg font-bold text-foreground mb-4">Order Summary</h2>

            <div className="flex justify-between items-center text-sm py-2">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-semibold text-foreground">{formattedSubtotal}</span>
            </div>

            <div className="flex justify-between items-center text-sm py-2 border-b border-border/60">
              <span className="text-muted-foreground">Shipping</span>
              <span className="text-xs text-muted-foreground">Calculated at checkout</span>
            </div>

            <div className="flex justify-between items-center text-base font-bold py-4">
              <span>Estimated Total</span>
              <span className="text-xl text-foreground">{formattedSubtotal}</span>
            </div>

            <p className="text-xs text-muted-foreground mb-6">
              GST included. Delivery options and discounts calculated at checkout.
            </p>

            <Link
              href="/checkout"
              className="w-full flex items-center justify-center rounded-xl bg-primary py-3.5 px-6 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90 transition-opacity"
            >
              Proceed to Checkout
            </Link>

            <div className="mt-4 text-center">
              <Link href="/" className="text-xs text-primary hover:underline">
                or Continue Shopping
              </Link>
            </div>
          </div>

          {/* Shipping estimator box */}
          <ShippingEstimator />
        </div>
      </div>
    </div>
  );
}

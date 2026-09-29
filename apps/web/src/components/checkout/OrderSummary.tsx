import React from "react";
import Image from "next/image";
import type { StorefrontCart } from "@bs/domain";

export interface OrderSummaryProps {
  cart: StorefrontCart;
  shippingPaise?: number;
}

export function OrderSummary({ cart, shippingPaise = 0 }: OrderSummaryProps) {
  const formattedSubtotal = `₹${(cart.subtotal / 100).toLocaleString("en-IN")}`;
  const totalPaise = cart.subtotal + shippingPaise;
  const formattedTotal = `₹${(totalPaise / 100).toLocaleString("en-IN")}`;
  const formattedShipping =
    shippingPaise === 0 ? "Free" : `₹${(shippingPaise / 100).toLocaleString("en-IN")}`;

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <h2 className="text-lg font-bold text-foreground mb-4">Order Summary</h2>

      <div className="divide-y divide-border/60 max-h-72 overflow-y-auto mb-4">
        {cart.items.map((item) => (
          <div key={item.id} className="flex items-center gap-3 py-3">
            <div className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg bg-muted border border-border/40">
              {item.primaryImage?.mediaId ? (
                <Image
                  src={`https://imagedelivery.net/account/${item.primaryImage.mediaId}/public`}
                  alt={item.primaryImage.alt ?? item.product.title}
                  fill
                  sizes="56px"
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
                  No image
                </div>
              )}
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-foreground text-[10px] font-bold text-background">
                {item.quantity}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-foreground truncate">{item.product.title}</p>
              {item.variant.title && (
                <p className="text-[11px] text-muted-foreground truncate">{item.variant.title}</p>
              )}
            </div>
            <span className="text-xs font-medium text-foreground">
              ₹{(item.lineTotal / 100).toLocaleString("en-IN")}
            </span>
          </div>
        ))}
      </div>

      <div className="space-y-2 border-t border-border/60 pt-4 text-sm">
        <div className="flex justify-between text-muted-foreground">
          <span>Subtotal</span>
          <span className="font-semibold text-foreground">{formattedSubtotal}</span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>Shipping</span>
          <span className="font-semibold text-foreground">{formattedShipping}</span>
        </div>
        <div className="flex justify-between text-base font-bold text-foreground border-t border-border/60 pt-3">
          <span>Total</span>
          <span className="text-xl">{formattedTotal}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">Inclusive of all taxes (GST)</p>
      </div>
    </div>
  );
}

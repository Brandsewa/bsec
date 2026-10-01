import React from "react";
import type { StorefrontCart } from "@bs/domain";
import { priceOrder } from "@bs/domain/pricing";
import { DiscountCodeBox } from "@/components/cart/DiscountCodeBox.tsx";

export interface OrderSummaryProps {
  cart: StorefrontCart;
  shippingPaise?: number;
  /** Cash-on-delivery handling fee, when the shopper chose COD and the store charges one. */
  codFeePaise?: number;
  /** When given, the summary shows the discount code box and calls this after a code is applied or removed. */
  onCartChange?: ((cart: StorefrontCart) => void) | undefined;
}

export function OrderSummary({ cart, shippingPaise = 0, codFeePaise = 0, onCartChange }: OrderSummaryProps) {
  const formattedSubtotal = `₹${(cart.subtotal / 100).toLocaleString("en-IN")}`;
  const pricing = priceOrder({
    subtotal: cart.subtotal,
    shipping: shippingPaise,
    codFee: codFeePaise,
    discount: cart.discount ? { type: cart.discount.type, discountAmount: cart.discount.amount } : null,
  });
  const totalPaise = pricing.grandTotal;
  const formattedTotal = `₹${(totalPaise / 100).toLocaleString("en-IN")}`;
  const formattedShipping =
    pricing.shippingTotal === 0 ? "Free" : `₹${(pricing.shippingTotal / 100).toLocaleString("en-IN")}`;

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <h2 className="text-lg font-bold text-foreground mb-4">Order Summary</h2>

      <div className="divide-y divide-border/60 max-h-72 overflow-y-auto mb-4">
        {cart.items.map((item) => (
          <div key={item.id} className="flex items-center gap-3 py-3">
            <div className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg bg-muted border border-border/40">
              {item.primaryImage?.url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={item.primaryImage.url}
                  alt={item.primaryImage.alt ?? item.product.title}
                  loading="lazy"
                  className="h-full w-full object-cover"
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
        {pricing.discountTotal > 0 && cart.discount && (
          <div className="flex justify-between text-muted-foreground" data-testid="discount-line">
            <span>Discount ({cart.discount.code})</span>
            <span className="font-semibold text-emerald-700">−{`₹${(pricing.discountTotal / 100).toLocaleString("en-IN")}`}</span>
          </div>
        )}
        {codFeePaise > 0 && (
          <div className="flex justify-between text-muted-foreground">
            <span>Cash on delivery fee</span>
            <span className="font-semibold text-foreground">{`₹${(codFeePaise / 100).toLocaleString("en-IN")}`}</span>
          </div>
        )}
        <div className="flex justify-between text-base font-bold text-foreground border-t border-border/60 pt-3">
          <span>Total</span>
          <span className="text-xl">{formattedTotal}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">Inclusive of all taxes (GST)</p>
      </div>
      {onCartChange && (
        <div className="mt-4">
          <DiscountCodeBox cart={cart} onChange={onCartChange} />
        </div>
      )}
    </div>
  );
}

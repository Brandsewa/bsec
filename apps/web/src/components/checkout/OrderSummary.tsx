import { PLACEHOLDER_IMAGE_URL } from "@/lib/placeholder.ts";
import React from "react";
import type { StorefrontCart } from "@bs/domain";
import { priceOrder } from "@bs/domain/pricing";
import { DiscountCodeBox } from "@/components/cart/DiscountCodeBox.tsx";
import { useMoney, useMarket } from "@/components/market/MarketProvider.tsx";

export interface OrderSummaryProps {
  cart: StorefrontCart;
  shippingPaise?: number;
  /** Cash-on-delivery handling fee, when the shopper chose COD and the store charges one. */
  codFeePaise?: number;
  /** When given, the summary shows the discount code box and calls this after a code is applied or removed. */
  onCartChange?: ((cart: StorefrontCart) => void) | undefined;
}

export function OrderSummary({ cart, shippingPaise = 0, codFeePaise = 0, onCartChange }: OrderSummaryProps) {
  const money = useMoney();
  const { locale } = useMarket();
  const formattedSubtotal = money(cart.subtotal);
  const pricing = priceOrder({
    subtotal: cart.subtotal,
    shipping: shippingPaise,
    codFee: codFeePaise,
    discount: cart.discount ? { type: cart.discount.type, discountAmount: cart.discount.amount } : null,
  });
  const totalPaise = pricing.grandTotal;
  const formattedTotal = money(totalPaise);
  const formattedShipping =
    pricing.shippingTotal === 0 ? "Free" : money(pricing.shippingTotal);

  const preorderItems = cart.items.filter((it) => it.variant.preorderEnabled);
  const latestShipDate = preorderItems.reduce<string | null>((latest, it) => {
    const d = it.variant.preorderShipsOn;
    if (!d) return latest;
    return !latest || d > latest ? d : latest;
  }, null);

  return (
    <div className="bs-panel p-4 sm:p-6">
      <h2 className="mb-2 hidden text-lg font-semibold tracking-tight text-foreground lg:block">Order Summary</h2>

      <div className="divide-y divide-border/40 max-h-64 overflow-y-auto mb-3 pt-1.5">
        {cart.items.map((item) => (
          <div key={item.id} className="flex items-center gap-2.5 py-2">
            <div className="relative h-11 w-11 flex-shrink-0 rounded-lg bg-background">
              {item.primaryImage?.url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={item.primaryImage.url}
                  alt={item.primaryImage.alt ?? item.product.title}
                  loading="lazy"
                  className="h-full w-full rounded-lg object-cover"
                />
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={PLACEHOLDER_IMAGE_URL} alt="" className="h-full w-full rounded-lg object-cover" />
              )}
              <span className="absolute -top-1.5 -right-1.5 z-10 flex h-5 min-w-5 px-1 items-center justify-center rounded-full bg-foreground text-[10px] font-bold text-background">
                {item.quantity}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-foreground truncate">{item.product.title}</p>
              {item.variant.title && (
                <p className="text-[11px] text-muted-foreground truncate">{item.variant.title}</p>
              )}
              {item.variant.preorderEnabled && (
                <span className="inline-flex items-center rounded bg-amber-500/10 px-1 py-0.25 text-[9px] font-medium text-amber-700 dark:text-amber-400">
                  Pre-order
                </span>
              )}
            </div>
            <span className="text-xs font-medium text-foreground">
              {money(item.lineTotal)}
            </span>
          </div>
        ))}
      </div>

      <div className="space-y-1.5 border-t border-border/40 pt-3 text-sm">
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
            <span className="font-semibold text-emerald-700">−{money(pricing.discountTotal)}</span>
          </div>
        )}
        {codFeePaise > 0 && (
          <div className="flex justify-between text-muted-foreground">
            <span>Cash on delivery fee</span>
            <span className="font-semibold text-foreground">{money(codFeePaise)}</span>
          </div>
        )}
        <div className="flex justify-between text-base font-bold text-foreground border-t border-border/40 pt-2.5">
          <span>Total</span>
          <span className="text-lg">{formattedTotal}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">Inclusive of all taxes (GST)</p>
      </div>

      {latestShipDate && (
        <div className="mt-4 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-950 dark:text-amber-200">
          <p className="font-semibold">Pre-order dispatch notice</p>
          <p className="mt-0.5 text-amber-900/90 dark:text-amber-300">
            {latestShipDate >= new Date().toISOString().slice(0, 10) ? (
              <>
                Your order ships on or after{" "}
                <span className="font-semibold text-amber-950 dark:text-amber-100">
                  {new Date(`${latestShipDate}T00:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })}
                </span>{" "}
                because it includes a pre-order item.
              </>
            ) : (
              "Your order ships soon because it includes a pre-order item."
            )}
          </p>
        </div>
      )}

      {onCartChange && (
        <div className="mt-3">
          <DiscountCodeBox cart={cart} onChange={onCartChange} />
        </div>
      )}
    </div>
  );
}

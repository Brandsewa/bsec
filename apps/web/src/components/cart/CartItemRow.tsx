"use client";

import { PLACEHOLDER_IMAGE_URL } from "@/lib/placeholder.ts";
import React, { useState } from "react";
import Link from "next/link";
import type { StorefrontCartItem } from "@bs/domain";
import { useMoney, useMarket } from "@/components/market/MarketProvider.tsx";
import { weightLabel } from "./cart-rows.ts";

export interface CartItemRowProps {
  item: StorefrontCartItem;
  /** How many the shopper chose (the line's quantity less the free units the store added). Defaults to the whole line. */
  qty?: number | undefined;
  /** What an offer on chosen products (a product discount, a bundle) takes off this line. */
  offerAmount?: number | undefined;
  /** Quantity changes are sent as the line's total (free units included); the server works the free units out again. */
  onUpdateQuantity?: (itemId: string, quantity: number) => Promise<void> | void;
  onRemove?: (itemId: string) => Promise<void> | void;
}

/** One line of the cart: picture, name, weight, "price × quantity", the stepper and the line's price. Compact on a phone. */
export function CartItemRow({ item, qty, offerAmount = 0, onUpdateQuantity, onRemove }: CartItemRowProps) {
  const [updating, setUpdating] = useState(false);
  const money = useMoney();
  const { locale } = useMarket();
  const shown = qty ?? item.quantity;
  const weight = weightLabel(item);
  const lineTotal = item.unitPriceSnapshot * shown;

  const run = async (fn: (() => Promise<void> | void) | undefined) => {
    if (updating || !fn) return;
    setUpdating(true);
    try {
      await fn();
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="flex items-start gap-3 border-b border-border/60 py-3 sm:gap-4 sm:py-4">
      <Link href={`/products/${item.product.slug}`} className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-muted sm:h-20 sm:w-20" tabIndex={-1} aria-label={item.product.title}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.primaryImage?.url ?? PLACEHOLDER_IMAGE_URL} alt={item.primaryImage?.url ? (item.primaryImage.alt ?? item.product.title) : ""} loading="lazy" className="h-full w-full object-cover" />
      </Link>

      <div className="min-w-0 flex-1">
        <Link href={`/products/${item.product.slug}`} className="line-clamp-2 text-sm font-semibold leading-snug text-foreground transition-colors hover:text-primary sm:text-base">
          {item.product.title}
        </Link>
        {weight ? <p className="text-xs text-muted-foreground">{weight}</p> : null}
        <p className="text-xs text-muted-foreground">
          {money(item.unitPriceSnapshot)} × {shown}
        </p>
        {item.variant.preorderEnabled && (
          <p className="mt-0.5 text-[11px] text-amber-800 dark:text-amber-300">
            Pre-order ·{" "}
            {item.variant.preorderShipsOn && item.variant.preorderShipsOn >= new Date().toISOString().slice(0, 10)
              ? `Ships on ${new Date(`${item.variant.preorderShipsOn}T00:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short" })}`
              : "Ships soon"}
          </p>
        )}
        <div className="mt-2 flex items-center gap-3">
          <div className="flex items-center overflow-hidden rounded-lg border border-border bg-background">
            <button
              type="button"
              disabled={updating || shown <= 1}
              onClick={() => void run(() => onUpdateQuantity?.(item.id, item.quantity - 1))}
              aria-label="Decrease quantity"
              className="h-8 w-8 text-sm text-foreground/80 transition-colors hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
            >
              -
            </button>
            <span className="w-8 text-center text-sm font-medium">{shown}</span>
            <button
              type="button"
              disabled={updating}
              onClick={() => void run(() => onUpdateQuantity?.(item.id, item.quantity + 1))}
              aria-label="Increase quantity"
              className="h-8 w-8 text-sm text-foreground/80 transition-colors hover:bg-muted disabled:opacity-40"
            >
              +
            </button>
          </div>
          <button type="button" disabled={updating} onClick={() => void run(() => onRemove?.(item.id))} className="text-xs text-destructive transition-opacity hover:opacity-70">
            Remove
          </button>
        </div>
      </div>

      <div className="shrink-0 text-right">
        <p className="text-sm font-bold text-foreground sm:text-base">{money(lineTotal)}</p>
        {offerAmount > 0 ? (
          <p className="text-xs font-medium text-emerald-700" data-testid="line-offer">
            Offer applied: −{money(offerAmount)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

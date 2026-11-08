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

/**
 * One line of the cart in three columns: the picture with a small x to remove it; the name over "weight × price × quantity";
 * the quantity buttons over the line's price. The same shape on a phone and on a desktop.
 */
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
    <div className="flex items-start gap-3 border-b border-border/60 py-3">
      <div className="relative shrink-0">
        <Link href={`/products/${item.product.slug}`} className="block h-16 w-16 overflow-hidden rounded-lg bg-muted" tabIndex={-1} aria-label={item.product.title}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.primaryImage?.url ?? PLACEHOLDER_IMAGE_URL} alt={item.primaryImage?.url ? (item.primaryImage.alt ?? item.product.title) : ""} loading="lazy" className="h-full w-full object-cover" />
        </Link>
        <button
          type="button"
          disabled={updating}
          onClick={() => void run(() => onRemove?.(item.id))}
          aria-label={`Remove ${item.product.title}`}
          className="absolute -left-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition-colors hover:text-foreground disabled:opacity-50"
        >
          <svg aria-hidden className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="min-w-0 flex-1">
        <Link href={`/products/${item.product.slug}`} className="line-clamp-2 text-sm font-semibold leading-snug text-foreground transition-colors hover:text-primary">
          {item.product.title}
        </Link>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {weight ? `${weight} × ` : ""}
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
        {offerAmount > 0 ? (
          <p className="mt-0.5 text-xs font-medium text-emerald-700" data-testid="line-offer">
            Offer applied: −{money(offerAmount)}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <div className="flex items-center overflow-hidden rounded-lg border border-border bg-background">
          <button
            type="button"
            disabled={updating || shown <= 1}
            onClick={() => void run(() => onUpdateQuantity?.(item.id, item.quantity - 1))}
            aria-label="Decrease quantity"
            className="h-7 w-7 text-sm text-foreground/80 transition-colors hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
          >
            -
          </button>
          <span className="w-6 text-center text-sm font-medium">{shown}</span>
          <button
            type="button"
            disabled={updating}
            onClick={() => void run(() => onUpdateQuantity?.(item.id, item.quantity + 1))}
            aria-label="Increase quantity"
            className="h-7 w-7 text-sm text-foreground/80 transition-colors hover:bg-muted disabled:opacity-40"
          >
            +
          </button>
        </div>
        <p className="text-sm font-bold text-foreground">{money(lineTotal)}</p>
      </div>
    </div>
  );
}

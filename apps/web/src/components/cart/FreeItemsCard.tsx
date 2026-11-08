"use client";

import React from "react";
import type { StorefrontCart, StorefrontCartItem } from "@bs/domain";
import { PLACEHOLDER_IMAGE_URL } from "@/lib/placeholder.ts";
import { useMoney } from "@/components/market/MarketProvider.tsx";

/** The free items the store added to a cart for a buy-x-get-y offer, with what each saves. Empty when there are none. */
export function freeItemsOf(cart: StorefrontCart): Array<{ item: StorefrontCartItem; free: number; saved: number; offer: string | null }> {
  return cart.items
    .filter((item) => (item.autoFreeQty ?? 0) > 0)
    .map((item) => {
      const free = item.autoFreeQty ?? 0;
      const applied = (cart.discounts ?? []).filter((d) => d.discountClass === "product" && (d.lineAmounts?.[item.id] ?? 0) > 0);
      const saved = applied.reduce((sum, d) => sum + (d.lineAmounts?.[item.id] ?? 0), 0);
      return { item, free, saved, offer: applied[0]?.title ?? null };
    });
}

/**
 * "Offer unlocked": shows the shopper where the extra item in their cart came from (an offer, not a mistake) with its
 * picture, its normal price crossed out, FREE, and what they save. Used in the cart page, the mini cart and checkout.
 */
export function FreeItemsCard({ cart, className = "" }: { cart: StorefrontCart; className?: string }) {
  const money = useMoney();
  const rows = freeItemsOf(cart);
  if (rows.length === 0) return null;
  const offer = rows.find((r) => r.offer)?.offer;
  return (
    <section className={`rounded-xl border border-dashed border-emerald-600/40 bg-emerald-500/5 px-4 py-3 ${className}`} aria-label="Offer unlocked" data-testid="free-items-card">
      <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Offer unlocked{offer ? `: ${offer}` : ""}</p>
      <ul className="mt-2 grid gap-2">
        {rows.map(({ item, free, saved }) => {
          const full = item.unitPriceSnapshot * free;
          const label = item.variant.title && item.variant.title !== "Default" ? item.variant.title : null;
          return (
            <li key={item.id} className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.primaryImage?.url ?? PLACEHOLDER_IMAGE_URL} alt="" className="h-11 w-11 shrink-0 rounded-lg bg-muted object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {free > 1 ? `${free} × ` : ""}
                  {item.product.title}
                </p>
                <p className="truncate text-xs text-muted-foreground">{label ? `${label} · ` : ""}added free with your offer</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">FREE</p>
                <p className="text-xs text-muted-foreground">
                  <span className="line-through">{money(full)}</span> · save {money(saved || full)}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

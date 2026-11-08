"use client";

import React from "react";
import { PLACEHOLDER_IMAGE_URL } from "@/lib/placeholder.ts";
import { useMoney } from "@/components/market/MarketProvider.tsx";
import { weightLabel, type CartRow } from "./cart-rows.ts";

/** The free units of an offer, as a compact line right under the item the shopper chose: same product, price 0, no controls. */
export function FreeItemRow({ row }: { row: CartRow }) {
  const money = useMoney();
  const { item, qty, saved, offer } = row;
  const weight = weightLabel(item);
  return (
    <div className="flex items-center gap-3 border-b border-border/60 bg-emerald-500/5 py-3 pl-4 pr-3 sm:pl-6" data-testid="free-item-row">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={item.primaryImage?.url ?? PLACEHOLDER_IMAGE_URL} alt="" className="h-12 w-12 shrink-0 rounded-lg bg-muted object-cover" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{item.product.title}</p>
        <p className="text-xs text-muted-foreground">
          {weight ? `${weight} · ` : ""}
          {money(0)} × {qty}
        </p>
        <p className="mt-1 inline-flex max-w-full items-center gap-1 rounded-full bg-emerald-600/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
          <span className="truncate">Offer unlocked{offer ? `: ${offer}` : ""}</span>
          <span className="shrink-0">· save {money(saved)}</span>
        </p>
      </div>
      <p className="shrink-0 text-sm font-bold text-emerald-700 dark:text-emerald-400">FREE</p>
    </div>
  );
}

import React from "react";
import type { StorefrontProductOffer } from "@bs/domain";
import { OfferSlot } from "./OfferSlot.tsx";

/**
 * The promotion bar under Add to cart ("Buy 2 Get 1 Free"). Drawn on the server, so it costs the product page no JavaScript;
 * only a tiny slot after it comes alive when something is in the cart, to show the unlocked free item (OfferSlot).
 */
export function ProductOfferBar({ offers }: { offers: StorefrontProductOffer[] }) {
  if (offers.length === 0) return null;
  return (
    <div className="grid gap-2" data-testid="product-offers">
      {offers.map((o) => (
        <div key={o.id} className="flex items-center gap-2 rounded-xl border border-dashed border-primary/40 bg-primary/5 px-4 py-2.5 text-sm font-semibold text-foreground" data-testid="product-offer">
          <span aria-hidden className="text-primary">
            %
          </span>
          <span>{o.headline}</span>
          {o.autoAdd ? <span className="ml-auto text-xs font-normal text-muted-foreground">added to your cart automatically</span> : null}
        </div>
      ))}
      <OfferSlot />
    </div>
  );
}

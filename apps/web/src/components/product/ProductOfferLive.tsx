"use client";

import React, { useEffect, useState } from "react";
import type { StorefrontCart } from "@bs/domain";
import { FreeItemsCard } from "@/components/cart/FreeItemsCard.tsx";

/** The unlocked free item(s) of the shopper's cart, with picture, price and saving, shown under the offer bar. Loaded lazily. */
export function ProductOfferLive() {
  const [cart, setCart] = useState<StorefrontCart | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void fetch("/api/storefront/cart")
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { cart?: StorefrontCart } | null) => alive && setCart(d?.cart ?? null))
        .catch(() => undefined);
    load();
    window.addEventListener("cart-updated", load);
    return () => {
      alive = false;
      window.removeEventListener("cart-updated", load);
    };
  }, []);
  return cart ? <FreeItemsCard cart={cart} /> : null;
}

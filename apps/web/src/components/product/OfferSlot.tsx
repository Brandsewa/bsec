"use client";

import React, { useEffect, useState } from "react";

/**
 * Loads the live "Unlocked" card only when a cart exists (the non-secret cart count cookie) or after something is added, so
 * a first visit to a product page downloads none of it.
 */
export function OfferSlot() {
  const [Live, setLive] = useState<React.ComponentType | null>(null);
  useEffect(() => {
    const load = () => void import("./ProductOfferLive.tsx").then((m) => setLive(() => m.ProductOfferLive));
    if (/bs_cart_count=[1-9]/.test(document.cookie)) load();
    window.addEventListener("cart-updated", load, { once: true });
    return () => window.removeEventListener("cart-updated", load);
  }, []);
  return Live ? <Live /> : null;
}

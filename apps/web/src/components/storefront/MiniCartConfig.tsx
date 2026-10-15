"use client";

import React, { createContext, useContext } from "react";
import type { DefaultPages } from "@bs/blocks";

export type MiniCartCopy = DefaultPages["miniCart"];

/**
 * Built-in wording, used where no theme sets any. Kept equal to `DEFAULT_PAGES.miniCart` in @bs/blocks (a test checks it);
 * it is repeated here because that module pulls zod into the browser bundle.
 */
export const FALLBACK_MINI_CART: MiniCartCopy = {
  heading: "Your Cart",
  checkoutLabel: "Proceed to Checkout",
  continueLabel: "Continue Shopping",
  totalNote: "Taxes and shipping calculated at checkout.",
  showFreeShippingBar: true,
  showTrustRow: true,
  trustItems: [
    { icon: "shield", text: "100% Secure Payments" },
    { icon: "returns", text: "Easy Returns" },
    { icon: "leaf", text: "Quality Assured" },
  ],
};

const MiniCartConfigContext = createContext<MiniCartCopy>(FALLBACK_MINI_CART);

/** The theme's mini cart wording and switches (set in Super Admin, "Default pages"), available to the cart link and the drawer anywhere in the header. */
export function MiniCartConfigProvider({ copy, children }: { copy: MiniCartCopy | undefined; children: React.ReactNode }) {
  return <MiniCartConfigContext.Provider value={copy ?? FALLBACK_MINI_CART}>{children}</MiniCartConfigContext.Provider>;
}

export function useMiniCartConfig(): MiniCartCopy {
  return useContext(MiniCartConfigContext);
}

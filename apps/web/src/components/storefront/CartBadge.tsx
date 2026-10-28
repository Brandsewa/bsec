"use client";

import React, { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { StorefrontCart } from "@bs/domain";
import { MiniCartDrawer } from "./MiniCartDrawer.tsx";
import Link from "next/link";

export interface CartBadgeProps {
  count?: number | undefined;
  className?: string | undefined;
  /** Desktop: the cart sits docked on the right edge of the screen instead of in the header (the header copy is hidden from 1024px). */
  dock?: boolean | undefined;
}

const subscribeNever = () => () => {};

/** The count the server left in a cookie. Read through useSyncExternalStore so the server render and first client render agree (0), then it updates. */
function readCountCookie(): number {
  try {
    const match = document.cookie.match(/(?:^|;\s*)bs_cart_count=([^;]+)/);
    const parsed = match?.[1] ? parseInt(decodeURIComponent(match[1]), 10) : 0;
    return Number.isNaN(parsed) ? 0 : parsed;
  } catch {
    return 0;
  }
}

const NO_DRAWER_PATHS = ["/cart", "/checkout"];

export function CartBadge({ count: initialCount, className = "", dock = false }: CartBadgeProps) {
  const cookieCount = useSyncExternalStore(subscribeNever, readCountCookie, () => 0);
  const [liveCount, setLiveCount] = useState<number | null>(null);
  const [cart, setCart] = useState<StorefrontCart | null>(null);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const closeDrawer = useCallback(() => setOpen(false), []);

  const loadCart = useCallback(() => {
    return fetch("/api/storefront/cart")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { cart?: StorefrontCart; itemCount?: number; freeShippingThresholdPaise?: number | null } | null) => {
        if (data && typeof data.itemCount === "number") {
          setLiveCount(data.itemCount);
          if (data.cart) setCart(data.cart);
          setThreshold(typeof data.freeShippingThresholdPaise === "number" ? data.freeShippingThresholdPaise : null);
        }
      })
      .catch(() => {
        // Ignore network errors in the background cart fetch
      });
  }, []);

  useEffect(() => {
    // The header stays mounted while the shopper adds items and checks out, so it must refresh itself.
    const onUpdated = (e: Event) => {
      void loadCart();
      const wantsOpen = (e as CustomEvent<{ open?: boolean }>).detail?.open === true;
      // The header copy and the docked copy both listen; only the one on screen (the dock from 1024px) opens the drawer.
      if (wantsOpen && dock === window.innerWidth >= 1024 && !NO_DRAWER_PATHS.includes(window.location.pathname)) setOpen(true);
    };
    if (initialCount === undefined) void loadCart();
    window.addEventListener("cart-updated", onUpdated);
    return () => window.removeEventListener("cart-updated", onUpdated);
  }, [initialCount, loadCart, dock]);

  const displayCount = initialCount !== undefined ? (liveCount ?? initialCount) : (liveCount ?? cookieCount);

  const onLinkClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Let new-tab and modified clicks, and the cart/checkout pages themselves, behave as a normal link.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0 || NO_DRAWER_PATHS.includes(window.location.pathname)) return;
    e.preventDefault();
    void loadCart();
    setOpen(true);
  };

  return (
    <>
    <Link
      href="/cart"
      onClick={onLinkClick}
      className={dock ? "bs-cart-dock" : `bs-cart-pill ${className}`}
      style={{ backgroundColor: "var(--color-surface, #f8fafc)", color: "var(--color-text, #0f172a)", borderRadius: "var(--radius, 9999px)" }}
      aria-label={`Cart, ${displayCount} items`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
        aria-hidden="true"
      >
        <circle cx="8" cy="21" r="1" />
        <circle cx="19" cy="21" r="1" />
        <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
      </svg>
      <span>Cart</span>
      <span
        className="bs-cart-count"
        style={{ backgroundColor: "var(--color-primary, #0f172a)" }}
      >
        {displayCount}
      </span>
    </Link>
    <MiniCartDrawer open={open} onClose={closeDrawer} freeShippingThresholdPaise={threshold} cart={cart} onCartChange={(c) => { setCart(c); setLiveCount(c.itemCount); }} />
    </>
  );
}

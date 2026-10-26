"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { SEARCH_OPEN_EVENT } from "./SearchModal.tsx";

/** Matches MOBILE_MENU_EVENT in @bs/blocks (the header's phone menu listens for it); a literal here keeps the block bundle out of this file. */
const MENU_EVENT = "bs:toggle-menu";
const HIDDEN_ON = ["/checkout"];

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const ICONS = {
  home: (
    <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" aria-hidden {...stroke}>
      <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
    </svg>
  ),
  explore: (
    <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" aria-hidden {...stroke}>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5z" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" aria-hidden {...stroke}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  ),
  cart: (
    <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" aria-hidden {...stroke}>
      <path d="M5 8h14l-1 12H6z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </svg>
  ),
};

const ITEM = "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium transition-colors";

/**
 * Phone-only bar at the bottom of the screen: Home, Explore (the menu), Search and Cart (Account is in the header). The pages around it keep
 * clear of it through the --bottom-nav-h variable, which also lifts the product page's sticky add-to-cart bar above it.
 */
export function MobileBottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    fetch("/api/storefront/cart")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { itemCount?: number } | null) => {
        if (d && typeof d.itemCount === "number") setCount(d.itemCount);
      })
      .catch(() => {
        // The badge simply keeps its last number.
      });
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener("cart-updated", refresh);
    return () => window.removeEventListener("cart-updated", refresh);
  }, [refresh]);

  if (HIDDEN_ON.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;

  const active = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));
  const tone = (on: boolean) => (on ? "text-foreground" : "text-muted-foreground hover:text-foreground");

  return (
    <>
      <style>{`@media (max-width: 767px) { :root { --bottom-nav-h: calc(3.75rem + env(safe-area-inset-bottom, 0px)); } }`}</style>
      <div aria-hidden className="md:hidden" style={{ height: "var(--bottom-nav-h, 0px)" }} />
      <nav aria-label="Quick navigation" className="bs-skin fixed inset-x-0 bottom-0 z-[60] flex border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur md:hidden" style={{ height: "var(--bottom-nav-h)" }}>
        <Link href="/" className={`${ITEM} ${tone(active("/"))}`} aria-current={active("/") ? "page" : undefined}>
          {ICONS.home}
          Home
        </Link>
        <button
          type="button"
          className={`${ITEM} ${tone(false)}`}
          onClick={() => {
            // Opens the header's menu drawer; a store whose header has no menu goes to its collections instead.
            if (document.querySelector(".bsb-mobile-menu")) window.dispatchEvent(new Event(MENU_EVENT));
            else router.push("/collections");
          }}
        >
          {ICONS.explore}
          Explore
        </button>
        <button type="button" className={`${ITEM} ${tone(false)}`} onClick={() => window.dispatchEvent(new Event(SEARCH_OPEN_EVENT))}>
          {ICONS.search}
          Search
        </button>
        <Link
          href="/cart"
          className={`${ITEM} ${tone(active("/cart"))}`}
          aria-label={`Cart, ${count} items`}
          onClick={(e) => {
            // The header's cart link owns the slide-in cart; when it is on the page, ask it to open.
            if (active("/cart") || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            if (document.querySelector('a[href="/cart"][aria-label^="Cart"]')) {
              e.preventDefault();
              window.dispatchEvent(new CustomEvent("cart-updated", { detail: { open: true } }));
            }
          }}
        >
          {ICONS.cart}
          {count > 0 ? (
            <span className="absolute right-[calc(50%-1.25rem)] top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">{count}</span>
          ) : null}
          Cart
        </Link>
      </nav>
    </>
  );
}

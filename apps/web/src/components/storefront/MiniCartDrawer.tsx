"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { PLACEHOLDER_IMAGE_URL } from "@/lib/placeholder.ts";
import type { StorefrontCart } from "@bs/domain";
import { priceOrder, toPricingDiscounts } from "@bs/domain/pricing";
import { cartRows, weightLabel } from "../cart/cart-rows.ts";
import { useMiniCartConfig } from "./MiniCartConfig.tsx";
import { useMoney } from "@/components/market/MarketProvider.tsx";

const HEADING_FONT = { fontFamily: "var(--bs-font-heading, inherit)" } as const;

/**
 * Slide-in cart opened from the header cart link. The link itself still goes to /cart (so it works without JavaScript
 * and with a modified click); with JavaScript a plain click opens this panel instead. It opens by itself after an add to
 * cart ("cart-updated" with detail.open) except on the cart and checkout pages, where it would only repeat the page.
 * Wording, the free-shipping bar and the reassurance row at the bottom come from the theme (Super Admin, "Default pages").
 */
export function MiniCartDrawer({
  open,
  onClose,
  cart,
  onCartChange,
  freeShippingThresholdPaise,
}: {
  open: boolean;
  onClose: () => void;
  cart: StorefrontCart | null;
  onCartChange: (cart: StorefrontCart) => void;
  freeShippingThresholdPaise: number | null;
}) {
  const copy = useMiniCartConfig();
  const panelRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const money = useMoney();

  // Escape closes; Tab stays inside the panel; the page behind does not scroll; focus moves in, and back to the opener on close.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusables = () => Array.from(panel?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])') ?? []);
    focusables()[0]?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      const first = list[0];
      const last = list[list.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, [open, onClose]);

  const change = useCallback(
    async (method: "PATCH" | "DELETE", body: Record<string, unknown>) => {
      setBusy(true);
      try {
        const res = await fetch("/api/storefront/cart/items", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (res.ok) {
          const data = await res.json();
          onCartChange((data.cart ?? data) as StorefrontCart);
          window.dispatchEvent(new CustomEvent("cart-updated", { detail: { fromDrawer: true } }));
        }
      } finally {
        setBusy(false);
      }
    },
    [onCartChange],
  );

  if (!open) return null;
  const items = cart?.items ?? [];
  const subtotal = cart?.subtotal ?? 0;
  // What they pay for the goods: the subtotal less the offers (a free item is in the subtotal at its normal price).
  const total = priceOrder({ subtotal, shipping: 0, codFee: 0, discounts: toPricingDiscounts(cart?.discounts) }).grandTotal;
  const rows = cart ? cartRows(cart) : [];
  const freeRows = rows.filter((r) => r.free);
  const threshold = freeShippingThresholdPaise && freeShippingThresholdPaise > 0 ? freeShippingThresholdPaise : null;
  const reached = threshold !== null && subtotal >= threshold;
  const percent = threshold ? Math.min(100, Math.round((subtotal / threshold) * 100)) : 0;

  // Drawn on <body>: inside the header it would share the header's stacking layer and could never rise above the bottom bar.
  const tree = (
    <div className="fixed inset-0 z-[100]" data-testid="mini-cart">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Shopping cart" className="bs-skin absolute right-0 top-0 flex h-full w-[90%] max-w-md flex-col bg-background text-foreground shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight" style={HEADING_FONT}>
            {copy.heading}
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-foreground px-1.5 text-xs font-semibold leading-none text-background" aria-label={`${cart?.itemCount ?? 0} items`} data-testid="mini-cart-count">
              {cart?.itemCount ?? 0}
            </span>
          </h2>
          <button type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors hover:text-foreground" aria-label="Close cart">
            <svg aria-hidden className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <p className="text-sm text-muted-foreground">Your cart is empty.</p>
            <Link href="/categories" onClick={onClose} className="inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground">
              Browse categories
            </Link>
          </div>
        ) : (
          <>
            <ul className="flex-1 divide-y divide-border overflow-y-auto" aria-busy={busy}>
              {rows.map((row) => {
                const { item, qty } = row;
                const weight = weightLabel(item);
                return (
                  <li key={row.key} className={`flex gap-3 px-4 py-2.5 ${row.free ? "bg-emerald-500/5 pl-6" : ""}`}>
                    <Link href={`/products/${item.product.slug}`} onClick={onClose} className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-muted" aria-label={item.product.title} tabIndex={-1}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.primaryImage?.url ?? PLACEHOLDER_IMAGE_URL} alt={item.primaryImage?.url ? (item.primaryImage.alt ?? "") : ""} className="h-full w-full object-cover" />
                    </Link>
                    <div className="min-w-0 flex-1">
                      <Link href={`/products/${item.product.slug}`} onClick={onClose} className="line-clamp-1 text-sm font-semibold leading-snug transition-opacity hover:opacity-70" style={HEADING_FONT}>
                        {item.product.title}
                      </Link>
                      {weight ? <p className="text-xs leading-snug text-muted-foreground">{weight}</p> : null}
                      <p className="text-xs text-muted-foreground">
                        {money(row.free ? 0 : item.unitPriceSnapshot)} × {qty}
                        {row.free ? <span className="ml-1.5 rounded-full bg-emerald-600/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">FREE</span> : null}
                      </p>
                      {row.free ? null : (
                        <div className="mt-1.5 inline-flex items-center rounded-md border border-border">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => (qty <= 1 ? void change("DELETE", { itemId: item.id }) : void change("PATCH", { itemId: item.id, quantity: item.quantity - 1 }))}
                            className="h-6 w-6 text-base leading-none text-muted-foreground hover:text-foreground disabled:opacity-50"
                            aria-label={`Decrease quantity of ${item.product.title}`}
                          >
                            −
                          </button>
                          <span className="w-6 text-center text-xs font-medium" aria-live="polite">
                            {qty}
                          </span>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void change("PATCH", { itemId: item.id, quantity: item.quantity + 1 })}
                            className="h-6 w-6 text-base leading-none text-muted-foreground hover:text-foreground disabled:opacity-50"
                            aria-label={`Increase quantity of ${item.product.title}`}
                          >
                            +
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end justify-between">
                      {row.free ? (
                        <span className="h-5" />
                      ) : (
                        <button type="button" disabled={busy} onClick={() => void change("DELETE", { itemId: item.id })} className="-mr-1 h-5 w-5 rounded-full text-muted-foreground hover:text-foreground disabled:opacity-50" aria-label={`Remove ${item.product.title}`}>
                          <svg aria-hidden className="mx-auto h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                      <p className="text-sm font-bold">{money(row.free ? 0 : item.unitPriceSnapshot * qty)}</p>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="border-t border-border bg-background px-6 pb-4 pt-5">
              {freeRows.length > 0 ? (
                <p className="mb-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-700" data-testid="mini-cart-offer">
                  Offer unlocked{freeRows[0]?.offer ? `: ${freeRows[0].offer}` : ""}. You got {freeRows.map((r) => r.item.product.title).join(", ")} free.
                </p>
              ) : null}
              {copy.showFreeShippingBar && threshold ? (
                <div className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-3" data-testid="mini-cart-shipping-bar">
                  <p className="text-sm font-medium">{reached ? "You have unlocked free shipping" : `Add ${money(threshold - subtotal)} more for free shipping`}</p>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Progress to free shipping">
                    <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${percent}%` }} />
                  </div>
                </div>
              ) : null}

              <div className={`flex items-baseline justify-between ${copy.showFreeShippingBar && threshold ? "mt-5" : ""}`}>
                <span className="text-xl font-bold" style={HEADING_FONT}>
                  Total
                </span>
                <span className="text-3xl font-extrabold tracking-tight">{money(total)}</span>
              </div>
              {copy.totalNote ? <p className="mt-1 text-sm text-muted-foreground">{copy.totalNote}</p> : null}

              <div className="mt-4 grid gap-2">
                <Link href="/checkout" onClick={onClose} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90">
                  {copy.checkoutLabel}
                  <svg aria-hidden className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.25">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </Link>
                <button type="button" onClick={onClose} className="inline-flex h-10 items-center justify-center rounded-lg border border-border px-5 text-sm font-medium transition-colors hover:bg-muted">
                  {copy.continueLabel}
                </button>
              </div>

            </div>
          </>
        )}
      </div>
    </div>
  );
  // No document while rendering to static markup (tests, server): the panel is then drawn in place.
  return typeof document === "undefined" ? tree : createPortal(tree, document.body);
}

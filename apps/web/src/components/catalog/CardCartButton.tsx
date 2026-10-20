"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { addVariantToCart } from "@/components/product/AddToCartButton.tsx";
import { PLACEHOLDER_IMAGE_URL } from "@/lib/placeholder.ts";

export interface CardCartProduct {
  title: string;
  slug: string;
  imageUrl?: string | undefined;
  shortDescription?: string | null | undefined;
  quickAdd: {
    singleVariantId?: string | undefined;
    inStock: boolean;
    options?: Array<{ name: string; values: string[] }> | undefined;
    variants?: Array<{ id: string; title: string; optionValues: Record<string, string>; price: number; compareAtPrice?: number | undefined; inStock: boolean }> | undefined;
  };
}

function inr(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: rupees % 1 === 0 ? 0 : 2 }).format(rupees);
}

const CART_ICON = (
  <svg aria-hidden className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="21" r="1" />
    <circle cx="19" cy="21" r="1" />
    <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
  </svg>
);
const CHECK_ICON = (
  <svg aria-hidden className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 13l4 4L19 7" />
  </svg>
);

const BUTTON_CLASS =
  "absolute bottom-2.5 right-2.5 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-background text-foreground shadow-md ring-1 ring-black/5 transition hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The small cart icon on a listing card's image. One purchasable variant: adds it straight away. Several variants: opens
 * the quick-buy popup (when the theme has it on) or goes to the product page. Nothing in stock: disabled.
 */
export function CardCartButton({ product, showQuickAdd, showViewProduct }: { product: CardCartProduct; showQuickAdd: boolean; showViewProduct: boolean }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [open, setOpen] = useState(false);
  const qa = product.quickAdd;

  if (!qa.inStock) {
    return (
      <button type="button" disabled className={BUTTON_CLASS} aria-label={`${product.title} is out of stock`} title="Out of stock">
        {CART_ICON}
      </button>
    );
  }

  if (qa.singleVariantId) {
    const variantId = qa.singleVariantId;
    return (
      <button
        type="button"
        className={BUTTON_CLASS}
        disabled={state === "busy"}
        aria-label={`Add ${product.title} to cart`}
        title="Add to cart"
        onClick={async () => {
          setState("busy");
          try {
            await addVariantToCart(variantId, 1);
            window.dispatchEvent(new CustomEvent("cart-updated", { detail: { open: true } }));
            setState("done");
            setTimeout(() => setState("idle"), 1800);
          } catch {
            setState("idle");
          }
        }}
      >
        {state === "done" ? CHECK_ICON : CART_ICON}
      </button>
    );
  }

  if (!showQuickAdd) {
    return (
      <Link href={`/products/${product.slug}`} className={BUTTON_CLASS} aria-label={`Choose options for ${product.title}`} title="Choose options">
        {CART_ICON}
      </Link>
    );
  }

  return (
    <>
      <button type="button" className={BUTTON_CLASS} aria-label={`Quick buy ${product.title}`} title="Quick buy" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {CART_ICON}
      </button>
      {open ? <QuickBuyDialog product={product} showViewProduct={showViewProduct} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export function QuickBuyDialog({ product, showViewProduct, onClose }: { product: CardCartProduct; showViewProduct: boolean; onClose: () => void }) {
  const options = product.quickAdd.options ?? [];
  const variants = product.quickAdd.variants ?? [];
  const firstBuyable = variants.find((v) => v.inStock) ?? variants[0];
  const [picked, setPicked] = useState<Record<string, string>>(firstBuyable?.optionValues ?? {});
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState<"cart" | "buy" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const selected = variants.find((v) => Object.entries(picked).every(([k, val]) => v.optionValues[k] === val)) ?? (options.length === 0 ? variants[0] : undefined);
  const canBuy = Boolean(selected?.inStock);

  // Which values of an option can still lead to something in stock, given the other choices already made.
  const valueAvailable = useCallback(
    (optionName: string, value: string) => variants.some((v) => v.inStock && v.optionValues[optionName] === value && Object.entries(picked).every(([k, val]) => k === optionName || v.optionValues[k] === val)),
    [variants, picked],
  );

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusables = () => Array.from(panel?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])') ?? []);
    focusables()[0]?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
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
      document.body.style.overflow = previous;
      opener?.focus?.();
    };
  }, [onClose]);

  const submit = async (mode: "cart" | "buy") => {
    if (!selected || !canBuy) return;
    setBusy(mode);
    setError(null);
    try {
      await addVariantToCart(selected.id, qty);
      if (mode === "buy") {
        window.location.assign("/checkout");
        return;
      }
      window.dispatchEvent(new CustomEvent("cart-updated", { detail: { open: true } }));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add to cart");
      setBusy(null);
    }
  };

  const hasSale = selected?.compareAtPrice !== undefined && selected.compareAtPrice > selected.price;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4" data-testid="quick-buy">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Quick buy: ${product.title}`}
        className="bs-skin relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl bg-background text-foreground shadow-xl sm:rounded-2xl"
      >
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-2 top-2 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-muted">
          <svg aria-hidden className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <div className="grid min-h-0 flex-1 overflow-y-auto sm:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] sm:overflow-hidden">
          <div className="aspect-[4/3] bg-muted sm:aspect-auto sm:h-full sm:min-h-[26rem]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={product.imageUrl ?? PLACEHOLDER_IMAGE_URL} alt={product.imageUrl ? product.title : ""} className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0 p-5 sm:overflow-y-auto sm:p-8">
            <h2 className="pr-10 text-xl font-semibold leading-snug">{product.title}</h2>
            <p className="mt-2 flex items-baseline gap-2">
              <span className="text-xl font-bold">{selected ? inr(selected.price) : "Choose options"}</span>
              {hasSale && selected?.compareAtPrice ? <span className="text-sm text-muted-foreground line-through">{inr(selected.compareAtPrice)}</span> : null}
            </p>
            {product.shortDescription ? <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-muted-foreground">{product.shortDescription}</p> : null}

            {options.map((o) => (
              <fieldset key={o.name} className="mt-4">
                <legend className="mb-1.5 text-sm font-medium">
                  {o.name}: <span className="font-normal text-muted-foreground">{picked[o.name]}</span>
                </legend>
                <div className="flex flex-wrap gap-2">
                  {o.values.map((val) => {
                    const on = picked[o.name] === val;
                    const available = valueAvailable(o.name, val);
                    return (
                      <button
                        key={val}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setPicked((p) => ({ ...p, [o.name]: val }))}
                        className={`min-h-8 rounded-full border px-3 text-xs font-medium transition ${on ? "border-foreground bg-foreground text-background" : "border-border bg-background hover:border-foreground"} ${available ? "" : "opacity-45 line-through"}`}
                      >
                        {val}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ))}

            <p className="mt-3 text-sm" role="status">
              {!selected ? <span className="text-muted-foreground">This combination is not available.</span> : canBuy ? <span className="text-emerald-600">In stock</span> : <span className="text-destructive">Out of stock</span>}
            </p>

            {error ? (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <div className="mt-5 flex items-stretch gap-3">
              <div className="inline-flex shrink-0 items-center rounded-lg border border-border">
                <button type="button" aria-label="Decrease quantity" disabled={qty <= 1} onClick={() => setQty((q) => Math.max(1, q - 1))} className="h-11 w-10 text-lg disabled:opacity-40">
                  −
                </button>
                <span className="w-8 text-center text-sm" aria-live="polite">
                  {qty}
                </span>
                <button type="button" aria-label="Increase quantity" disabled={qty >= 10} onClick={() => setQty((q) => Math.min(10, q + 1))} className="h-11 w-10 text-lg disabled:opacity-40">
                  +
                </button>
              </div>
              <button type="button" disabled={!canBuy || busy !== null} onClick={() => void submit("cart")} className="inline-flex h-11 flex-1 items-center justify-center rounded-lg border border-foreground px-4 text-sm font-semibold hover:bg-muted disabled:opacity-50">
                {busy === "cart" ? "Adding…" : "Add to cart"}
              </button>
            </div>
            <button type="button" disabled={!canBuy || busy !== null} onClick={() => void submit("buy")} className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
              {busy === "buy" ? "Please wait…" : "Buy now"}
            </button>
            {showViewProduct ? (
              <Link href={`/products/${product.slug}`} className="mt-4 inline-block text-sm font-medium underline underline-offset-4">
                View full product details
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

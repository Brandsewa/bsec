"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addVariantToCart } from "@/components/product/AddToCartButton.tsx";
import dynamic from "next/dynamic";
import type { CardCartProduct } from "@/components/catalog/CardCartButton.tsx";
import { PLACEHOLDER_IMAGE_URL } from "@/lib/placeholder.ts";

// The quick-buy popup is only needed when someone chooses options, so it loads then.
const QuickBuyDialog = dynamic(() => import("@/components/catalog/CardCartButton.tsx").then((m) => m.QuickBuyDialog), { ssr: false });

interface Result extends CardCartProduct {
  id: string;
  priceMin: number;
  priceMax: number;
  priceOnRequest: boolean;
}

function inr(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: rupees % 1 === 0 ? 0 : 2 }).format(rupees);
}

/** The search popup itself: type, see products as you go, open one or add it to the cart without leaving the page. */
export function SearchModalPanel({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<Result | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);

  const close = useCallback(() => {
    setChoosing(null);
    onClose();
  }, [onClose]);

  useEffect(() => {
    inputRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !choosing) close();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [choosing, close]);

  // Debounced as-you-type lookup; an older request never overwrites a newer one.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      abort.current?.abort();
      return;
    }
    const timer = setTimeout(async () => {
      abort.current?.abort();
      const ctl = new AbortController();
      abort.current = ctl;
      setLoading(true);
      try {
        const res = await fetch(`/api/storefront/search/products?query=${encodeURIComponent(q)}`, { signal: ctl.signal });
        if (res.ok) setResults(((await res.json()) as { items?: Result[] }).items ?? []);
      } catch {
        // Aborted or offline: keep what is shown.
      } finally {
        if (!ctl.signal.aborted) setLoading(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [query]);

  async function add(p: Result) {
    const variantId = p.quickAdd.singleVariantId;
    if (!variantId) return setChoosing(p);
    try {
      await addVariantToCart(variantId, 1);
      window.dispatchEvent(new CustomEvent("cart-updated"));
      setAdded(p.id);
      setTimeout(() => setAdded((cur) => (cur === p.id ? null : cur)), 1800);
    } catch {
      router.push(`/products/${p.slug}`);
      close();
    }
  }

  const trimmed = query.trim();
  const showResults = trimmed.length >= 2 ? (results ?? []) : [];

  return (
    <div className="fixed inset-0 z-[65] flex items-start justify-center px-3 pt-[8vh] sm:pt-[12vh]" data-search-modal="">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={close} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label="Search products" className="bs-skin relative flex max-h-[78vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-background text-foreground shadow-2xl">
        <form
          className="flex items-center gap-3 border-b border-border p-3 sm:p-4"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            if (trimmed) {
              router.push(`/search?q=${encodeURIComponent(trimmed)}`);
              close();
            }
          }}
        >
          <div className="relative flex-1">
            <svg aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products"
              aria-label="Search products"
              className="h-11 w-full rounded-xl bg-muted pl-10 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/40 [&::-webkit-search-cancel-button]:hidden"
            />
          </div>
          <button type="button" onClick={close} className="hidden h-8 items-center rounded-md border border-border px-2 text-[11px] font-semibold text-muted-foreground sm:inline-flex" aria-label="Close search">
            ESC
          </button>
          <button type="button" onClick={close} className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-muted sm:hidden" aria-label="Close search">
            <svg aria-hidden className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </form>

        <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={loading}>
          {trimmed.length < 2 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Type at least two letters to search.</p>
          ) : results === null && loading ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Searching…</p>
          ) : showResults.length === 0 && !loading ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No products match “{trimmed}”.</p>
          ) : (
            <ul className="divide-y divide-border">
              {showResults.map((p) => {
                const buyable = p.quickAdd.inStock && !p.priceOnRequest;
                return (
                  <li key={p.id} className="flex items-center gap-3 px-3 py-3 sm:px-4">
                    <Link href={`/products/${p.slug}`} onClick={close} className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted" tabIndex={-1} aria-hidden>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.imageUrl ?? PLACEHOLDER_IMAGE_URL} alt="" className="h-full w-full object-cover" />
                    </Link>
                    <div className="min-w-0 flex-1">
                      <Link href={`/products/${p.slug}`} onClick={close} className="line-clamp-2 text-sm font-semibold leading-snug hover:underline">
                        {p.title}
                      </Link>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {p.priceOnRequest ? "Price on request" : p.priceMax > p.priceMin ? `From ${inr(p.priceMin)}` : inr(p.priceMin)}
                      </p>
                    </div>
                    {buyable ? (
                      <button
                        type="button"
                        onClick={() => void add(p)}
                        className="inline-flex h-9 shrink-0 items-center rounded-lg border border-foreground px-3 text-xs font-semibold transition hover:bg-muted"
                      >
                        {added === p.id ? "Added ✓" : p.quickAdd.singleVariantId ? "Add to cart" : "Choose options"}
                      </button>
                    ) : (
                      <span className="shrink-0 text-xs text-muted-foreground">{p.priceOnRequest ? "" : "Out of stock"}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {trimmed.length >= 2 && showResults.length > 0 ? (
          <div className="border-t border-border p-3 text-center">
            <Link href={`/search?q=${encodeURIComponent(trimmed)}`} onClick={close} className="text-sm font-medium underline underline-offset-4">
              See all results
            </Link>
          </div>
        ) : null}
      </div>
      {choosing ? <QuickBuyDialog product={choosing} showViewProduct onClose={() => setChoosing(null)} /> : null}
    </div>
  );
}

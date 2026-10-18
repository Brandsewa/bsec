"use client";

import React, { createContext, useContext, useState, useSyncExternalStore } from "react";
import type { StorefrontProductDetail, StorefrontVariant } from "@bs/domain";
import { addVariantToCart } from "./AddToCartButton.tsx";
import { RequestQuoteDialog } from "./RequestQuoteDialog.tsx";

/** Formats minor unit paise into standard ₹ Indian Rupee format */
export function formatInr(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: rupees % 1 === 0 ? 0 : 2,
  }).format(rupees);
}

const subscribeNever = () => () => {};

interface BuyState {
  product: StorefrontProductDetail;
  options: NonNullable<StorefrontProductDetail["options"]>;
  selectedVariant: StorefrontVariant | undefined;
  selectedOptions: Record<string, string>;
  pick: (name: string, value: string) => void;
  qty: number;
  setQty: (n: number) => void;
}
const BuyContext = createContext<BuyState | null>(null);

function useBuy(): BuyState {
  const ctx = useContext(BuyContext);
  if (!ctx) throw new Error("Product buy parts must be inside ProductBuyProvider");
  return ctx;
}

/**
 * The option list for the picker. A product normally carries its option definitions; one that has variants with option
 * values but no definitions (imported or edited by hand) would show no picker at all, so the options are worked out from
 * the variants themselves. With a single variant, or when every option has one value, there is nothing to choose.
 */
function optionsFor(product: StorefrontProductDetail): NonNullable<StorefrontProductDetail["options"]> {
  if (product.options && product.options.length > 0) return product.options;
  const variants = product.variants ?? [];
  if (variants.length < 2) return [];
  const byName = new Map<string, string[]>();
  for (const v of variants) {
    for (const [name, value] of Object.entries((v.optionValues as Record<string, string> | null) ?? {})) {
      const values = byName.get(name) ?? [];
      if (!values.includes(value)) values.push(value);
      byName.set(name, values);
    }
  }
  const derived = [...byName.entries()].map(([name, values], position) => ({ id: `derived-${name}`, productId: product.id, name, position, values }));
  return derived.some((o) => o.values.length > 1) ? derived : [];
}

/**
 * Holds which variant the shopper has chosen and how many, so the pieces of the buy box (SKU, options, price, buttons) can sit
 * in any order between server-rendered parts of the page (rating, title, description) and still agree with each other.
 */
export function ProductBuyProvider({ product, children }: { product: StorefrontProductDetail; children: React.ReactNode }) {
  const variants = product.variants ?? [];
  const options = optionsFor(product);

  // Deep link: /products/x?variant=<id> opens on that variant. useSyncExternalStore gives the server render and the first client
  // render the same null, then reads the address, so markup matches on hydration.
  const linkedId = useSyncExternalStore(subscribeNever, () => new URLSearchParams(window.location.search).get("variant"), () => null);
  const linkedVariant = linkedId ? variants.find((v) => v.id === linkedId) : undefined;
  const defaultVariant = variants.find((v) => v.stockStatus === "in_stock") ?? variants[0];

  const [pickedOptions, setPickedOptions] = useState<Record<string, string> | null>(null);
  const [qty, setQtyState] = useState(1);

  const selectedOptions: Record<string, string> = pickedOptions ?? ((linkedVariant ?? defaultVariant)?.optionValues as Record<string, string> | undefined) ?? {};
  const match = (wanted: Record<string, string>) =>
    variants.find((v) => {
      const vOpts = (v.optionValues as Record<string, string>) ?? {};
      return Object.entries(wanted).every(([k, val]) => vOpts[k] === val);
    });
  const selectedVariant: StorefrontVariant | undefined = pickedOptions ? (match(pickedOptions) ?? linkedVariant ?? defaultVariant) : (linkedVariant ?? defaultVariant);

  const pick = (name: string, value: string) => {
    const updated = { ...selectedOptions, [name]: value };
    setPickedOptions(updated);
    const found = match(updated);
    if (found) {
      // Keep the address shareable: the chosen variant is in the URL without adding a history entry.
      const url = new URL(window.location.href);
      url.searchParams.set("variant", found.id);
      window.history.replaceState(window.history.state, "", url);
    }
  };

  return (
    <BuyContext.Provider value={{ product, options, selectedVariant, selectedOptions, pick, qty, setQty: (n) => setQtyState(Math.min(10, Math.max(1, n))) }}>
      {children}
    </BuyContext.Provider>
  );
}

export function SkuLine({ className = "" }: { className?: string }) {
  const { selectedVariant } = useBuy();
  if (!selectedVariant?.sku) return null;
  return <p className={`text-xs font-mono text-muted-foreground ${className}`}>SKU: {selectedVariant.sku}</p>;
}

/** The product's options (size, colour...) as small pills, plain buttons or dropdowns. Combinations with nothing in stock look struck through. */
export function VariantOptions({ style = "pills" }: { style?: "pills" | "buttons" | "dropdown" | undefined }) {
  const { product, options, selectedOptions, pick } = useBuy();
  const variants = product.variants ?? [];
  if (options.length === 0) return null;

  const inStockWith = (name: string, value: string) =>
    variants.some((v) => v.stockStatus !== "out_of_stock" && (v.optionValues as Record<string, string>)?.[name] === value && Object.entries(selectedOptions).every(([k, val]) => k === name || (v.optionValues as Record<string, string>)?.[k] === val));

  return (
    <div className="flex flex-col gap-4">
      {options.map((opt) => (
        <div key={opt.id} className="flex flex-col gap-2">
          <label htmlFor={style === "dropdown" ? `opt-${opt.id}` : undefined} className="text-sm font-semibold text-foreground">
            {opt.name}: <span className="font-normal text-muted-foreground">{selectedOptions[opt.name] ?? "Select"}</span>
          </label>
          {style === "dropdown" ? (
            <select
              id={`opt-${opt.id}`}
              value={selectedOptions[opt.name] ?? ""}
              onChange={(e) => pick(opt.name, e.target.value)}
              className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-hidden focus:ring-1 focus:ring-primary"
            >
              {opt.values.map((val) => (
                <option key={val} value={val}>
                  {val}
                  {inStockWith(opt.name, val) ? "" : " (sold out)"}
                </option>
              ))}
            </select>
          ) : (
            <div className="flex flex-wrap gap-2" role="group" aria-label={opt.name}>
              {opt.values.map((val) => {
                const isSelected = selectedOptions[opt.name] === val;
                const available = inStockWith(opt.name, val);
                return (
                  <button
                    key={val}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => pick(opt.name, val)}
                    className={`${style === "pills" ? "min-h-8 rounded-full px-3 text-xs" : "rounded-lg px-3.5 py-2 text-sm"} border font-medium transition-all ${
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground shadow-xs ring-1 ring-primary"
                        : "border-border/80 bg-surface text-foreground hover:border-foreground/40 hover:bg-surface/80"
                    } ${available ? "" : "opacity-50 line-through"}`}
                  >
                    {val}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** Price (with the compare-at price and saving), a small note under it and a low or no stock message. */
export function PriceBlock({ note }: { note?: string | undefined }) {
  const { product, selectedVariant, qty } = useBuy();
  const variants = product.variants ?? [];
  // The price follows the quantity as it is changed: unit price x quantity (checkout still works the real total out on the server).
  const unitPrice = selectedVariant?.price ?? variants[0]?.price ?? 0;
  const unitCompareAt = selectedVariant?.compareAtPrice ?? variants[0]?.compareAtPrice;
  const currentPrice = unitPrice * qty;
  const currentCompareAt = unitCompareAt !== undefined ? unitCompareAt * qty : undefined;
  const hasSavings = currentCompareAt !== undefined && currentCompareAt > currentPrice;
  const discountPercent = hasSavings ? Math.round(((currentCompareAt - currentPrice) / currentCompareAt) * 100) : 0;
  const stockStatus = selectedVariant?.stockStatus ?? "out_of_stock";
  const preorder = Boolean(selectedVariant?.preorderEnabled);

  return (
    <div className="flex flex-col gap-1.5">
      {product.priceOnRequest ? (
        <span className="w-fit rounded-lg bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary">Price on request</span>
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-3xl font-extrabold tracking-tight text-foreground">{formatInr(currentPrice)}</span>
          {hasSavings ? <span className="text-xl font-medium text-muted-foreground line-through">{formatInr(currentCompareAt)}</span> : null}
          {hasSavings ? <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">Save {discountPercent}%</span> : null}
        </div>
      )}
      {qty > 1 && !product.priceOnRequest ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {formatInr(unitPrice)} each × {qty}
        </p>
      ) : null}
      {note && !product.priceOnRequest ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      {!product.priceOnRequest && !preorder && stockStatus === "low_stock" ? (
        <p className="text-sm font-medium text-amber-600" role="status">
          Only {selectedVariant?.availableQuantity ?? "a few"} left
        </p>
      ) : null}
      {!product.priceOnRequest && !preorder && stockStatus === "out_of_stock" ? (
        <p className="text-sm font-medium text-destructive" role="status">
          Out of stock
        </p>
      ) : null}
    </div>
  );
}

export interface PurchaseActionsProps {
  addToCartLabel?: string | undefined;
  buyNowLabel?: string | undefined;
  showBuyNow?: boolean | undefined;
  addToCartBg?: string | undefined;
  addToCartText?: string | undefined;
  buyNowBg?: string | undefined;
  buyNowText?: string | undefined;
  trustPoints?: string[] | undefined;
}

/** Quantity and Add to cart on one row, Buy it now full width below, pre-order and quote variants, reassurance lines. */
export function PurchaseActions({ addToCartLabel = "Add to cart", buyNowLabel = "Buy it now", showBuyNow = false, addToCartBg, addToCartText, buyNowBg, buyNowText, trustPoints }: PurchaseActionsProps) {
  const { product, selectedVariant, qty, setQty } = useBuy();
  const [busy, setBusy] = useState<"cart" | "buy" | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [quoteOpen, setQuoteOpen] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const preorder = Boolean(selectedVariant?.preorderEnabled);
  const available = selectedVariant?.stockStatus === "in_stock" || selectedVariant?.stockStatus === "low_stock";
  const canBuy = Boolean(selectedVariant) && (available || preorder);
  const shipDateLabel =
    selectedVariant?.preorderShipsOn && selectedVariant.preorderShipsOn >= today
      ? `Ships on ${new Date(`${selectedVariant.preorderShipsOn}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
      : "Ships soon";

  const submit = async (mode: "cart" | "buy") => {
    if (!selectedVariant || !canBuy || busy) return;
    setBusy(mode);
    setMessage(null);
    try {
      await addVariantToCart(selectedVariant.id, qty);
      if (mode === "buy") {
        window.location.assign("/checkout");
        return;
      }
      window.dispatchEvent(new CustomEvent("cart-updated", { detail: { open: true } }));
      setMessage({ kind: "ok", text: "Added to your cart." });
      setTimeout(() => setMessage(null), 3000);
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "Could not add to cart" });
    } finally {
      setBusy(null);
    }
  };

  if (product.priceOnRequest) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setQuoteOpen(true)}
          className="w-full cursor-pointer rounded-xl bg-primary px-6 py-3.5 text-base font-semibold text-primary-foreground shadow-xs transition-all hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
        >
          Request a quote
        </button>
        <p className="mt-2 text-center text-xs text-muted-foreground">Inquire for custom volume, tailored pricing, or specialized specifications.</p>
        <RequestQuoteDialog product={product} selectedVariant={selectedVariant} open={quoteOpen} onClose={() => setQuoteOpen(false)} />
      </div>
    );
  }

  const label = !canBuy ? "Out of stock" : preorder ? "Pre-order" : addToCartLabel;

  return (
    <div className="flex flex-col gap-3">
      {preorder ? (
        <div className="flex flex-col gap-1 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-950">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-800">Pre-order</span>
            <span className="text-sm font-medium">{shipDateLabel}</span>
          </div>
          {selectedVariant?.preorderMessage ? <p className="text-xs text-amber-800/80">{selectedVariant.preorderMessage}</p> : null}
        </div>
      ) : null}

      <div id="buy-box" className="scroll-mt-24 flex items-stretch gap-3">
        <div className="inline-flex shrink-0 items-center rounded-lg border border-border">
          <button type="button" aria-label="Decrease quantity" disabled={qty <= 1} onClick={() => setQty(qty - 1)} className="h-12 w-10 text-lg disabled:opacity-40">
            −
          </button>
          <span className="w-8 text-center text-sm" aria-live="polite" aria-label={`Quantity ${qty}`}>
            {qty}
          </span>
          <button type="button" aria-label="Increase quantity" disabled={qty >= 10} onClick={() => setQty(qty + 1)} className="h-12 w-10 text-lg disabled:opacity-40">
            +
          </button>
        </div>
        <button
          type="button"
          disabled={!canBuy || busy !== null}
          onClick={() => void submit("cart")}
          style={{ backgroundColor: addToCartBg, color: addToCartText }}
          className={`inline-flex h-12 flex-1 items-center justify-center rounded-lg px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${addToCartBg ? "" : "border border-foreground hover:bg-muted"}`}
        >
          {busy === "cart" ? "Adding…" : label}
        </button>
      </div>

      {showBuyNow && canBuy ? (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void submit("buy")}
          style={{ backgroundColor: buyNowBg, color: buyNowText }}
          className={`inline-flex h-12 w-full items-center justify-center rounded-lg px-4 text-sm font-semibold transition hover:opacity-90 disabled:opacity-50 ${buyNowBg ? "" : "bg-primary text-primary-foreground"}`}
        >
          {busy === "buy" ? "Please wait…" : buyNowLabel}
        </button>
      ) : null}

      {message ? (
        <p role={message.kind === "error" ? "alert" : "status"} className={`text-sm ${message.kind === "error" ? "text-destructive" : "text-emerald-600"}`}>
          {message.text}
        </p>
      ) : null}

      {trustPoints && trustPoints.length > 0 ? (
        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
          {trustPoints.map((point) => (
            <li key={point} className="inline-flex items-center gap-1.5">
              <svg className="h-3.5 w-3.5 text-emerald-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 011.4-1.4l3.8 3.8 6.8-6.8a1 1 0 011.4 0z" clipRule="evenodd" />
              </svg>
              {point}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export interface VariantSelectorProps {
  product: StorefrontProductDetail;
  showSku?: boolean | undefined;
  /** Reassurance lines shown under the add-to-cart button (from the theme's product template). */
  trustPoints?: string[] | undefined;
}

/** The whole buy box in one piece (price, SKU, options, buttons): what a product page without the theme's layout settings uses. */
export function VariantSelector({ product, showSku = true, trustPoints }: VariantSelectorProps) {
  return (
    <ProductBuyProvider product={product}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <PriceBlock />
          {showSku ? <SkuLine /> : null}
        </div>
        <VariantOptions style="buttons" />
        <PurchaseActions trustPoints={trustPoints} />
      </div>
    </ProductBuyProvider>
  );
}

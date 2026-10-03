"use client";

import React, { useState } from "react";
import type { StorefrontProductDetail, StorefrontVariant } from "@bs/domain";
import { AddToCartButton } from "./AddToCartButton.tsx";
import { StockEtaHole } from "./StockEtaHole.tsx";
import { RequestQuoteDialog } from "./RequestQuoteDialog.tsx";

export interface VariantSelectorProps {
  product: StorefrontProductDetail;
}

/** Formats minor unit paise into standard ₹ Indian Rupee format */
export function formatInr(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: rupees % 1 === 0 ? 0 : 2,
  }).format(rupees);
}

export function VariantSelector({ product }: VariantSelectorProps) {
  const [quoteOpen, setQuoteOpen] = useState(false);
  const variants = product.variants ?? [];
  const options = product.options ?? [];

  // Default to first variant or one with available stock
  const [selectedVariant, setSelectedVariant] = useState<StorefrontVariant | undefined>(() => {
    return variants.find((v) => v.stockStatus === "in_stock") ?? variants[0];
  });

  // Track selected option values (e.g. { "Switch Type": "Red Linear", "Color": "Midnight Black" })
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>(() => {
    return (selectedVariant?.optionValues as Record<string, string>) ?? {};
  });

  const handleSelectOption = (optionName: string, value: string) => {
    const updated = { ...selectedOptions, [optionName]: value };
    setSelectedOptions(updated);

    // Find the variant that matches all selected option values
    const matchingVariant = variants.find((v) => {
      const vOpts = (v.optionValues as Record<string, string>) ?? {};
      return Object.entries(updated).every(([k, val]) => vOpts[k] === val);
    });

    if (matchingVariant) {
      setSelectedVariant(matchingVariant);
    }
  };

  const currentPrice = selectedVariant?.price ?? variants[0]?.price ?? 0;
  const currentCompareAt = selectedVariant?.compareAtPrice ?? variants[0]?.compareAtPrice;
  const currentSku = selectedVariant?.sku ?? variants[0]?.sku ?? "";
  const stockStatus = selectedVariant?.stockStatus ?? "out_of_stock";
  const availableQuantity = selectedVariant?.availableQuantity ?? 0;
  const isAvailable = stockStatus === "in_stock" || stockStatus === "low_stock";

  // Calculate discount percentage if compareAtPrice is higher than price
  const hasSavings = currentCompareAt !== undefined && currentCompareAt > currentPrice;
  const discountPercent = hasSavings
    ? Math.round(((currentCompareAt - currentPrice) / currentCompareAt) * 100)
    : 0;

  const today = new Date().toISOString().slice(0, 10);
  const isPreorder = Boolean(selectedVariant?.preorderEnabled);
  const isPastShipDate = Boolean(selectedVariant?.preorderShipsOn && selectedVariant.preorderShipsOn < today);
  const shipDateLabel = isPastShipDate
    ? "Ships soon"
    : selectedVariant?.preorderShipsOn
      ? `Ships on ${new Date(`${selectedVariant.preorderShipsOn}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
      : "Ships soon";

  return (
    <div className="flex flex-col gap-6">
      {/* Price or Price On Request */}
      <div className="flex flex-col gap-1.5">
        {product.priceOnRequest ? (
          <div className="flex items-center gap-3">
            <span className="rounded-lg bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary">
              Price on request
            </span>
          </div>
        ) : (
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-extrabold tracking-tight text-foreground">
              {formatInr(currentPrice)}
            </span>
            {hasSavings && (
              <span className="text-xl font-medium text-muted-foreground line-through">
                {formatInr(currentCompareAt)}
              </span>
            )}
            {hasSavings && (
              <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                Save {discountPercent}%
              </span>
            )}
          </div>
        )}
        {currentSku && (
          <p className="text-xs font-mono text-muted-foreground">SKU: {currentSku}</p>
        )}
      </div>

      {/* Option Pickers */}
      {options.map((opt) => (
        <div key={opt.id} className="flex flex-col gap-2.5">
          <label className="text-sm font-semibold text-foreground">
            {opt.name}:{" "}
            <span className="font-normal text-muted-foreground">
              {selectedOptions[opt.name] ?? "Select"}
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            {opt.values.map((val) => {
              const isSelected = selectedOptions[opt.name] === val;
              return (
                <button
                  key={val}
                  type="button"
                  onClick={() => handleSelectOption(opt.name, val)}
                  className={`rounded-lg border px-3.5 py-2 text-sm font-medium transition-all ${
                    isSelected
                      ? "border-primary bg-primary text-primary-foreground shadow-xs ring-1 ring-primary"
                      : "border-border/80 bg-surface text-foreground hover:border-foreground/40 hover:bg-surface/80"
                  }`}
                >
                  {val}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {product.priceOnRequest ? (
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setQuoteOpen(true)}
            className="w-full rounded-xl bg-primary px-6 py-3.5 text-base font-semibold text-primary-foreground shadow-xs hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 transition-all cursor-pointer"
          >
            Request a quote
          </button>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Inquire for custom volume, tailored pricing, or specialized specifications.
          </p>
          <RequestQuoteDialog
            product={product}
            selectedVariant={selectedVariant}
            open={quoteOpen}
            onClose={() => setQuoteOpen(false)}
          />
        </div>
      ) : (
        <>
          {/* Pre-order notification or Stock & Delivery ETA Hole */}
          {isPreorder ? (
            <div className="flex flex-col gap-1 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-950 dark:text-amber-200">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-md bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                  Pre-order
                </span>
                <span className="text-sm font-medium">{shipDateLabel}</span>
              </div>
              {selectedVariant?.preorderMessage ? (
                <p className="text-xs text-amber-800/80 dark:text-amber-300/80">{selectedVariant.preorderMessage}</p>
              ) : null}
            </div>
          ) : (
            <StockEtaHole
              stockStatus={stockStatus}
              availableQuantity={availableQuantity}
            />
          )}

          {/* Add To Cart Button */}
          {selectedVariant && (
            <div className="pt-2">
              <AddToCartButton
                variantId={selectedVariant.id}
                available={isAvailable}
                isPreorder={isPreorder}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

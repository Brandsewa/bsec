"use client";

import React, { useState } from "react";
import type { StorefrontProductDetail, StorefrontVariant } from "@bs/domain";
import { AddToCartButton } from "./AddToCartButton.tsx";
import { StockEtaHole } from "./StockEtaHole.tsx";

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

  return (
    <div className="flex flex-col gap-6">
      {/* Price and Compare At Price */}
      <div className="flex flex-col gap-1.5">
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

      {/* Dynamic Stock & Delivery ETA Hole */}
      <StockEtaHole
        stockStatus={stockStatus}
        availableQuantity={availableQuantity}
      />

      {/* Add To Cart Button */}
      {selectedVariant && (
        <div className="pt-2">
          <AddToCartButton
            variantId={selectedVariant.id}
            available={isAvailable}
          />
        </div>
      )}
    </div>
  );
}

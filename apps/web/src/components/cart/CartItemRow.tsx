"use client";

import React, { useState } from "react";
import Link from "next/link";
import type { StorefrontCartItem } from "@bs/domain";

export interface CartItemRowProps {
  item: StorefrontCartItem;
  onUpdateQuantity?: (itemId: string, quantity: number) => Promise<void> | void;
  onRemove?: (itemId: string) => Promise<void> | void;
}

export function CartItemRow({ item, onUpdateQuantity, onRemove }: CartItemRowProps) {
  const [updating, setUpdating] = useState(false);

  const formattedLineTotal = `₹${(item.lineTotal / 100).toLocaleString("en-IN")}`;
  const formattedUnitPrice = `₹${(item.unitPriceSnapshot / 100).toLocaleString("en-IN")}`;

  const handleQuantityChange = async (newQty: number) => {
    if (newQty < 0 || updating) return;
    setUpdating(true);
    try {
      if (onUpdateQuantity) {
        await onUpdateQuantity(item.id, newQty);
      }
    } finally {
      setUpdating(false);
    }
  };

  const handleRemove = async () => {
    if (updating) return;
    setUpdating(true);
    try {
      if (onRemove) {
        await onRemove(item.id);
      }
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 py-4 border-b border-border/60">
      {/* Product Image & Details */}
      <div className="flex items-start sm:items-center gap-4 flex-1">
        <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-muted border border-border/40">
          {item.primaryImage?.url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={item.primaryImage.url}
              alt={item.primaryImage.alt ?? item.product.title}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
              No image
            </div>
          )}
        </div>

        <div className="flex flex-col">
          <Link
            href={`/products/${item.product.slug}`}
            className="text-base font-semibold text-foreground hover:text-primary transition-colors"
          >
            {item.product.title}
          </Link>
          {item.variant.title && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Variant: {item.variant.title}
            </p>
          )}
          {item.variant.sku && (
            <p className="text-xs font-mono text-muted-foreground/80 mt-0.5">
              SKU: {item.variant.sku}
            </p>
          )}
          {item.variant.preorderEnabled && (
            <div className="mt-1 flex items-center gap-1.5">
              <span className="inline-flex items-center rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                Pre-order
              </span>
              <span className="text-[11px] text-amber-800 dark:text-amber-300">
                {item.variant.preorderShipsOn && item.variant.preorderShipsOn >= new Date().toISOString().slice(0, 10)
                  ? `Ships on ${new Date(`${item.variant.preorderShipsOn}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`
                  : "Ships soon"}
              </span>
            </div>
          )}
          <p className="text-xs text-muted-foreground sm:hidden mt-1">
            Unit Price: {formattedUnitPrice}
          </p>
        </div>
      </div>

      {/* Quantity Stepper & Price */}
      <div className="flex items-center justify-between w-full sm:w-auto sm:gap-8">
        <div className="flex items-center border border-border rounded-lg bg-background overflow-hidden">
          <button
            type="button"
            disabled={updating || item.quantity <= 1}
            onClick={() => handleQuantityChange(item.quantity - 1)}
            aria-label="Decrease quantity"
            className="px-2.5 py-1 text-sm text-foreground/80 hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
          >
            -
          </button>
          <span className="w-10 text-center text-sm font-medium">{item.quantity}</span>
          <button
            type="button"
            disabled={updating}
            onClick={() => handleQuantityChange(item.quantity + 1)}
            aria-label="Increase quantity"
            className="px-2.5 py-1 text-sm text-foreground/80 hover:bg-muted disabled:opacity-40 transition-colors"
          >
            +
          </button>
        </div>

        <div className="text-right">
          <p className="text-base font-bold text-foreground">{formattedLineTotal}</p>
          <button
            type="button"
            disabled={updating}
            onClick={handleRemove}
            className="text-xs text-destructive hover:underline mt-1 transition-colors"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

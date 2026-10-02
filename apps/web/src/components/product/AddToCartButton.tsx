"use client";

import React, { useState } from "react";

export interface AddToCartButtonProps {
  variantId: string;
  available: boolean;
  quantity?: number;
  isPreorder?: boolean;
}

/**
 * Adds a variant to the shopper's cart. The server creates the cart on the first add and remembers it in an HttpOnly
 * cookie, so no cart token is sent: a made-up token matches no cart and is answered "Cart not found".
 */
export async function addVariantToCart(variantId: string, quantity: number, fetchFn: typeof fetch = fetch): Promise<void> {
  const res = await fetchFn("/api/storefront/cart/items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ variantId, quantity }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Failed to add product to cart");
  }
}

export function AddToCartButton({
  variantId,
  available,
  quantity = 1,
  isPreorder = false,
}: AddToCartButtonProps) {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAddToCart = async () => {
    if (!available || loading) return;

    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      await addVariantToCart(variantId, quantity);

      setSuccess(true);
      // Dispatch cart update event for header badge sync
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("cart-updated"));
      }

      setTimeout(() => {
        setSuccess(false);
      }, 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error adding to cart");
      setTimeout(() => {
        setError(null);
      }, 3500);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 w-full">
      <button
        type="button"
        disabled={!available || loading}
        onClick={handleAddToCart}
        className={`w-full flex items-center justify-center gap-2 rounded-xl py-3.5 px-6 font-semibold text-base transition-all duration-200 shadow-sm ${
          !available
            ? "cursor-not-allowed bg-muted text-muted-foreground opacity-60"
            : success
            ? "bg-emerald-600 text-white hover:bg-emerald-700"
            : "bg-primary text-primary-foreground hover:opacity-95 active:scale-[0.99]"
        }`}
      >
        {loading ? (
          <span className="inline-flex items-center gap-2">
            <svg
              className="h-5 w-5 animate-spin"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v8H4z"
              />
            </svg>
            Adding to Cart...
          </span>
        ) : success ? (
          <span className="inline-flex items-center gap-2">
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2.5"
                d="M5 13l4 4L19 7"
              />
            </svg>
            Added to Cart!
          </span>
        ) : !available ? (
          "Out of Stock"
        ) : (
          <span className="inline-flex items-center gap-2">
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
              />
            </svg>
            {isPreorder ? "Pre-order" : "Add to Cart"}
          </span>
        )}
      </button>

      {error && (
        <p className="text-center text-xs text-destructive mt-1">{error}</p>
      )}
    </div>
  );
}

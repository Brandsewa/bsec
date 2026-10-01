"use client";

import React, { useState } from "react";
import type { StorefrontCart } from "@bs/domain";

export interface DiscountCodeBoxProps {
  cart: StorefrontCart;
  /** Called with the updated cart after a code is applied or removed. */
  onChange: (cart: StorefrontCart) => void;
}

/** The "Discount code" field of the cart and checkout order summaries. */
export function DiscountCodeBox({ cart, onChange }: DiscountCodeBoxProps) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(method: "POST" | "DELETE", body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/storefront/cart/discount", {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = (await res.json().catch(() => null)) as { cart?: StorefrontCart; error?: string } | null;
      if (!res.ok || !data?.cart) {
        setError(data?.error ?? "Could not apply the code");
        return;
      }
      setCode("");
      onChange(data.cart);
      window.dispatchEvent(new Event("cart-updated"));
    } catch {
      setError("Could not reach the store. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const applied = cart.discount;

  return (
    <div className="border-t border-border/60 pt-4" data-testid="discount-box">
      {applied ? (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <span>
            <strong>{applied.code}</strong> applied{applied.freeShipping ? " (free shipping)" : ""}
          </span>
          <button type="button" className="text-xs underline disabled:opacity-50" disabled={busy} onClick={() => void send("DELETE")}>
            Remove
          </button>
        </div>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) void send("POST", { code: code.trim() });
          }}
        >
          <label htmlFor="discount-code" className="sr-only">
            Discount code
          </label>
          <input
            id="discount-code"
            value={code}
            maxLength={64}
            autoComplete="off"
            placeholder="Discount code"
            onChange={(e) => setCode(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            type="submit"
            disabled={busy || !code.trim()}
            className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted/40 disabled:opacity-50"
          >
            {busy ? "…" : "Apply"}
          </button>
        </form>
      )}
      {cart.discountNotice && !applied && (
        <p className="mt-2 text-xs text-amber-700" role="alert">
          {cart.discountNotice}{" "}
          <button type="button" className="underline disabled:opacity-50" disabled={busy} onClick={() => void send("DELETE")}>
            Remove code
          </button>
        </p>
      )}
      {error && (
        <p className="mt-2 text-xs text-rose-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

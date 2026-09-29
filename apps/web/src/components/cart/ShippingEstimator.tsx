"use client";

import React, { useState } from "react";
import type { ShippingEstimate } from "@bs/domain";

export interface ShippingEstimatorProps {
  onEstimateChange?: (estimate: ShippingEstimate | null) => void;
}

export function ShippingEstimator({ onEstimateChange }: ShippingEstimatorProps) {
  const [pincode, setPincode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<ShippingEstimate | null>(null);

  const handleEstimate = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPin = pincode.trim();
    if (!/^[1-9][0-9]{5}$/.test(cleanPin)) {
      setError("Please enter a valid 6-digit Indian Pincode");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/storefront/cart/estimate-shipping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pincode: cleanPin }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to estimate shipping");
      }

      const data: ShippingEstimate = await res.json();
      setEstimate(data);
      if (onEstimateChange) {
        onEstimateChange(data);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error estimating shipping");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-border/80 bg-muted/30 p-4">
      <h3 className="text-sm font-semibold text-foreground mb-1">Estimate Shipping</h3>
      <p className="text-xs text-muted-foreground mb-3">
        Enter your 6-digit Indian Pincode to view delivery options and timeline.
      </p>

      <form onSubmit={handleEstimate} className="flex gap-2">
        <label htmlFor="shipping-pincode" className="sr-only">
          Pincode
        </label>
        <input
          id="shipping-pincode"
          aria-label="6-digit Indian Pincode"
          type="text"
          maxLength={6}
          value={pincode}
          onChange={(e) => setPincode(e.target.value.replace(/\D/g, ""))}
          placeholder="6-digit Indian Pincode"
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <button
          type="submit"
          disabled={loading || pincode.length !== 6}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {loading ? "Calculating..." : "Calculate"}
        </button>
      </form>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      {estimate && (
        <div className="mt-3 space-y-1.5 border-t border-border/60 pt-3 text-xs">
          {estimate.rates.map((rate) => (
            <div key={rate.id} className="flex justify-between items-center text-foreground">
              <span>
                <span className="font-medium">{rate.title}</span> ({rate.estimatedDays}):
              </span>
              <span className="font-semibold">
                {rate.amount === 0 ? "Free" : `₹${(rate.amount / 100).toLocaleString("en-IN")}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

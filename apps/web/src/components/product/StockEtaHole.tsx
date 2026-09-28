"use client";

import React, { useState } from "react";

export interface StockEtaHoleProps {
  stockStatus: "in_stock" | "low_stock" | "out_of_stock";
  availableQuantity?: number | undefined;
}

export function StockEtaSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3 rounded-xl border border-border/60 bg-surface/30 p-4">
      <div className="flex items-center gap-2">
        <div aria-hidden className="store-skeleton h-4 w-24 rounded-full" />
      </div>
      <div aria-hidden className="store-skeleton h-3 w-40" />
      <div className="mt-2 flex gap-2">
        <div aria-hidden className="store-skeleton h-9 flex-1 rounded-md" />
        <div aria-hidden className="store-skeleton h-9 w-20 rounded-md" />
      </div>
    </div>
  );
}

export function StockEtaHole({ stockStatus, availableQuantity }: StockEtaHoleProps) {
  const [pincode, setPincode] = useState("");
  const [pincodeStatus, setPincodeStatus] = useState<"idle" | "checking" | "serviceable" | "unserviceable" | "invalid">("idle");
  const [etaMessage, setEtaMessage] = useState<string | null>(null);

  const handleCheckPincode = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPin = pincode.trim();
    const pincodeRegex = /^[1-9][0-9]{5}$/;

    if (!pincodeRegex.test(cleanPin)) {
      setPincodeStatus("invalid");
      setEtaMessage("Please enter a valid 6-digit Indian pincode.");
      return;
    }

    setPincodeStatus("checking");

    // Standard client estimation for Indian postal zones
    setTimeout(() => {
      // Simulate fast delivery serviceability check
      setPincodeStatus("serviceable");
      setEtaMessage(`Delivery by ${new Date(Date.now() + 3 * 86400000).toLocaleDateString("en-IN", {
        weekday: "short",
        month: "short",
        day: "numeric",
      })} | Cash on Delivery available`);
    }, 200);
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-surface/50 p-4 text-sm">
      {/* Stock Status Badge */}
      <div className="flex items-center gap-2">
        {stockStatus === "in_stock" && (
          <span className="inline-flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            In Stock
          </span>
        )}
        {stockStatus === "low_stock" && (
          <span className="inline-flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            Only {availableQuantity ?? "few"} left!
          </span>
        )}
        {stockStatus === "out_of_stock" && (
          <span className="inline-flex items-center gap-1.5 font-medium text-destructive">
            <span className="h-2 w-2 rounded-full bg-destructive" />
            Out of Stock
          </span>
        )}
      </div>

      {/* Indian GST Transparency Note */}
      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Price incl. of all taxes (GST included)
      </p>

      {/* Pincode Serviceability & Delivery ETA */}
      <div className="mt-1 pt-3 border-t border-border/60">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Delivery & Services
        </p>
        <form onSubmit={handleCheckPincode} className="flex gap-2">
          <input
            type="text"
            maxLength={6}
            value={pincode}
            onChange={(e) => setPincode(e.target.value.replace(/\D/g, ""))}
            placeholder="Enter 6-digit Pincode"
            className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            type="submit"
            disabled={pincodeStatus === "checking"}
            className="rounded-lg bg-surface border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            {pincodeStatus === "checking" ? "Checking..." : "Check"}
          </button>
        </form>

        {etaMessage && (
          <div
            className={`mt-2.5 rounded-lg p-2.5 text-xs leading-relaxed ${
              pincodeStatus === "serviceable"
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20"
                : "bg-destructive/10 text-destructive border border-destructive/20"
            }`}
          >
            {etaMessage}
          </div>
        )}
      </div>
    </div>
  );
}

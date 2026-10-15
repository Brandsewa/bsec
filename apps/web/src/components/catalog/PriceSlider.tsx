"use client";

import React, { useState } from "react";

function inr(rupees: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(rupees);
}

/**
 * Two-handle price slider. Values are whole rupees; the page's facet data is in paise, so callers convert. The address is only
 * updated when a handle is released (or a key is pressed), not on every pixel of drag.
 */
export function PriceSlider({
  min,
  max,
  valueMin,
  valueMax,
  disabled,
  onCommit,
}: {
  min: number;
  max: number;
  valueMin: number;
  valueMax: number;
  disabled?: boolean | undefined;
  onCommit: (lo: number, hi: number) => void;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const [lo, setLo] = useState(clamp(valueMin));
  const [hi, setHi] = useState(clamp(valueMax));
  const step = max - min > 5000 ? 10 : 1;

  if (max <= min) {
    return <p className="mt-3 text-sm text-muted-foreground">All products cost {inr(min)}.</p>;
  }

  const pct = (n: number) => ((n - min) / (max - min)) * 100;
  const commit = () => onCommit(Math.min(lo, hi), Math.max(lo, hi));

  return (
    <div className="mt-3">
      <div className="bs-range" style={{ "--lo": `${pct(lo)}%`, "--hi": `${pct(hi)}%` } as React.CSSProperties}>
        <div className="bs-range-track" />
        <input
          type="range"
          aria-label="Minimum price"
          aria-valuetext={inr(lo)}
          min={min}
          max={max}
          step={step}
          value={lo}
          disabled={disabled}
          onChange={(e) => setLo(Math.min(Number(e.target.value), hi))}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
        />
        <input
          type="range"
          aria-label="Maximum price"
          aria-valuetext={inr(hi)}
          min={min}
          max={max}
          step={step}
          value={hi}
          disabled={disabled}
          onChange={(e) => setHi(Math.max(Number(e.target.value), lo))}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-sm" aria-live="polite">
        <span className="font-medium text-foreground">{inr(lo)}</span>
        <span className="text-muted-foreground">to</span>
        <span className="font-medium text-foreground">{inr(hi)}</span>
      </div>
    </div>
  );
}

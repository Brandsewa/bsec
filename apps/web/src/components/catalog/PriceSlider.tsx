"use client";

import React, { useState } from "react";
import { formatMoney, minorUnitExponent } from "@bs/contracts/money";
import { useMarket } from "@/components/market/MarketProvider.tsx";

/**
 * Two-handle price slider. Values are whole currency units; the page's facet data is in minor units, so callers convert. The address is only
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
  const { currency, locale } = useMarket();
  const factor = 10 ** minorUnitExponent(currency);
  const fmt = (major: number) => formatMoney(major * factor, currency, { locale, alwaysShowFraction: false });

  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const [lo, setLo] = useState(clamp(valueMin));
  const [hi, setHi] = useState(clamp(valueMax));
  const step = max - min > 5000 ? 10 : 1;

  if (max <= min) {
    return <p className="mt-3 text-sm text-muted-foreground">All products cost {fmt(min)}.</p>;
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
          aria-valuetext={fmt(lo)}
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
          aria-valuetext={fmt(hi)}
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
        <span className="font-medium text-foreground">{fmt(lo)}</span>
        <span className="text-muted-foreground">to</span>
        <span className="font-medium text-foreground">{fmt(hi)}</span>
      </div>
    </div>
  );
}

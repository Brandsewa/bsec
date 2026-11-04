"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMarket } from "./MarketProvider.tsx";

/** The country list pop-up of the footer selector. Loaded only when the shopper opens it, so it is not in every page's JavaScript. */
export default function MarketSelectorDialog({ onClose }: { onClose: () => void }) {
  const { markets = [], currentHandle, path = "/" } = useMarket();
  const [query, setQuery] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(
    () =>
      markets
        .flatMap((m) => m.countries.map((c) => ({ code: c.code, name: c.name, market: m })))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [markets],
  );
  const q = query.trim().toLowerCase();
  const visible = q ? rows.filter((r) => r.name.toLowerCase().includes(q) || r.market.currency.toLowerCase().includes(q)) : rows;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("input")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-end justify-center sm:items-center sm:p-4" data-testid="market-selector-dialog">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Choose your country" className="bs-skin relative flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-background text-foreground shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">Choose your country</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted">
            ×
          </button>
        </div>
        <div className="px-5 pt-3">
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search countries" aria-label="Search countries" className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" />
          <p className="mt-2 text-xs text-muted-foreground">Prices, shipping and payment methods follow the country you choose.</p>
        </div>
        <ul className="mt-2 flex-1 overflow-y-auto px-2 pb-3">
          {visible.length === 0 ? <li className="px-3 py-6 text-center text-sm text-muted-foreground">No country matches.</li> : null}
          {visible.map((r) => {
            const here = r.market.handle === currentHandle;
            return (
              <li key={r.code}>
                <a
                  href={`/api/storefront/market/select?handle=${encodeURIComponent(r.market.handle)}&next=${encodeURIComponent(path)}`}
                  aria-current={here ? "true" : undefined}
                  className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm hover:bg-muted ${here ? "font-semibold" : ""}`}
                >
                  <span>{r.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {r.market.currency}
                    {here ? " ✓" : ""}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

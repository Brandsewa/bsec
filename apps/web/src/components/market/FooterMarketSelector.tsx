"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { countryName } from "@bs/contracts/countries";
import { useMarket } from "./MarketProvider.tsx";

/**
 * Country and currency selector for the footer (under the store name and description). Shows where the store is currently
 * selling to you ("India · INR") and, on click, a searchable list of every country the store sells to with the currency each
 * one pays in. Picking one moves the shopper to that country's market (prices, shipping and payment follow) and remembers it.
 * Renders nothing for a store with a single market.
 */
export function FooterMarketSelector() {
  const { markets = [], currentHandle, path = "/" } = useMarket();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  const current = markets.find((m) => m.handle === currentHandle);
  const rows = useMemo(
    () =>
      markets
        .flatMap((m) => m.countries.map((code) => ({ code, name: countryName(code), market: m })))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [markets],
  );
  const q = query.trim().toLowerCase();
  const visible = q ? rows.filter((r) => r.name.toLowerCase().includes(q) || r.market.currency.toLowerCase().includes(q)) : rows;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("input")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (markets.length < 2 || !current) return null;
  const label = current.countries.length === 1 ? `${countryName(current.countries[0] ?? "")} · ${current.currency}` : `${current.name} · ${current.currency}`;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setQuery("");
          setOpen(true);
        }}
        aria-haspopup="dialog"
        data-testid="market-selector"
        className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-md border border-current/20 px-3 text-sm opacity-90 hover:opacity-100"
      >
        <svg aria-hidden viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" />
        </svg>
        <span>{label}</span>
        <svg aria-hidden viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[1000] flex items-end justify-center sm:items-center sm:p-4" data-testid="market-selector-dialog">
              <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} aria-hidden />
              <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Choose your country" className="bs-skin relative flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-background text-foreground shadow-xl sm:rounded-2xl">
                <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
                  <h2 className="text-base font-semibold">Choose your country</h2>
                  <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted">
                    ×
                  </button>
                </div>
                <div className="px-5 pt-3">
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search countries"
                    aria-label="Search countries"
                    className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"
                  />
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
                          <span className="text-xs text-muted-foreground">{r.market.currency}{here ? " ✓" : ""}</span>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

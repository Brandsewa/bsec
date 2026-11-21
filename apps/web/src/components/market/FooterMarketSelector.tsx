"use client";

import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useMarket } from "./MarketProvider.tsx";

// The pop-up (list, search, portal) is a separate chunk, not shipped in every page's first load...
const loadDialog = () => import("./MarketSelectorDialog.tsx");
const MarketSelectorDialog = dynamic(loadDialog, { ssr: false });

// ...but it is fetched before the click: once the browser is idle, and again on hover, focus or touch. Fetching it only on
// the click made the pop-up appear after a network round trip.
let warmed = false;
function warmDialog() {
  if (warmed) return;
  warmed = true;
  void loadDialog().catch(() => {
    warmed = false;
  });
}

/**
 * Country and currency selector for the footer (under the store name and description). Shows where the store is currently
 * selling to you ("India · INR"); a click opens a searchable list of every country the store sells to, each with its currency.
 * Renders nothing for a store with a single market.
 */
export function FooterMarketSelector() {
  const { markets = [], currentHandle } = useMarket();
  const [open, setOpen] = useState(false);
  const current = markets.find((m) => m.handle === currentHandle);
  const sells = markets.length >= 2 && !!current;
  useEffect(() => {
    if (!sells) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(warmDialog, { timeout: 4000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = setTimeout(warmDialog, 2000);
    return () => clearTimeout(t);
  }, [sells]);
  if (!sells || !current) return null;
  const label = `${current.countries.length === 1 ? (current.countries[0]?.name ?? current.name) : current.name} · ${current.currency}`;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} onPointerEnter={warmDialog} onFocus={warmDialog} onTouchStart={warmDialog} aria-haspopup="dialog" data-testid="market-selector" className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-md border border-current/20 px-3 text-sm opacity-90 hover:opacity-100">
        <svg aria-hidden viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" />
        </svg>
        <span>{label}</span>
      </button>
      {open ? <MarketSelectorDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

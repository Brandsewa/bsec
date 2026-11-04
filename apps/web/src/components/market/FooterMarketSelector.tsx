"use client";

import React, { useState } from "react";
import dynamic from "next/dynamic";
import { useMarket } from "./MarketProvider.tsx";

// The pop-up (list, search, portal) is fetched on the first click, not shipped with every page.
const MarketSelectorDialog = dynamic(() => import("./MarketSelectorDialog.tsx"), { ssr: false });

/**
 * Country and currency selector for the footer (under the store name and description). Shows where the store is currently
 * selling to you ("India · INR"); a click opens a searchable list of every country the store sells to, each with its currency.
 * Renders nothing for a store with a single market.
 */
export function FooterMarketSelector() {
  const { markets = [], currentHandle } = useMarket();
  const [open, setOpen] = useState(false);
  const current = markets.find((m) => m.handle === currentHandle);
  if (markets.length < 2 || !current) return null;
  const label = `${current.countries.length === 1 ? (current.countries[0]?.name ?? current.name) : current.name} · ${current.currency}`;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" data-testid="market-selector" className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-md border border-current/20 px-3 text-sm opacity-90 hover:opacity-100">
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

"use client";

import React, { createContext, useContext, useState } from "react";

type View = "grid" | "list";
interface Columns {
  cols: number;
  colsTablet: number;
  colsMobile: number;
}
const ViewContext = createContext<{ view: View; setView: (v: View) => void; columns: Columns }>({ view: "grid", setView: () => {}, columns: { cols: 4, colsTablet: 2, colsMobile: 1 } });

/** Holds the grid / list choice for one product listing; cards are drawn once and CSS switches their layout. */
export function ListingViewProvider({ defaultView = "grid", cols = 4, colsTablet = 2, colsMobile = 1, children }: { defaultView?: View | undefined; cols?: number; colsTablet?: number; colsMobile?: number; children: React.ReactNode }) {
  const [view, setView] = useState<View>(defaultView);
  return <ViewContext.Provider value={{ view, setView, columns: { cols, colsTablet, colsMobile } }}>{children}</ViewContext.Provider>;
}

export function ViewToggle() {
  const { view, setView } = useContext(ViewContext);
  const btn = (v: View, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={() => setView(v)}
      aria-pressed={view === v}
      aria-label={label}
      title={label}
      className={`inline-flex h-9 w-9 items-center justify-center transition-colors ${view === v ? "bg-foreground text-background" : "bg-background text-muted-foreground hover:text-foreground"}`}
    >
      {icon}
    </button>
  );
  return (
    <div role="group" aria-label="Product layout" className="inline-flex overflow-hidden rounded-lg border border-border">
      {btn(
        "grid",
        "Grid view",
        <svg aria-hidden className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>,
      )}
      {btn(
        "list",
        "List view",
        <svg aria-hidden className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>,
      )}
    </div>
  );
}

/** The product cards' container: cards per row come from CSS variables (desktop, tablet, phone) and the view from the toggle. */
export function ProductsContainer({ cols, colsTablet, colsMobile, children }: { cols: number; colsTablet: number; colsMobile: number; children: React.ReactNode }) {
  const { view } = useContext(ViewContext);
  return (
    <div
      className="bs-pgrid"
      data-view={view}
      style={{ "--cols": cols, "--cols-t": colsTablet, "--cols-m": colsMobile } as React.CSSProperties}
    >
      {children}
    </div>
  );
}

/** Shown in place of the cards while a filter, price range or sort is being applied. Same grid, so nothing jumps. */
export function ProductsSkeleton({ count = 8 }: { count?: number }) {
  const { view, columns } = useContext(ViewContext);
  return (
    <div
      className="bs-pgrid"
      data-view={view}
      role="status"
      aria-label="Loading products"
      style={{ "--cols": columns.cols, "--cols-t": columns.colsTablet, "--cols-m": columns.colsMobile } as React.CSSProperties}
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="bs-pcard" aria-hidden>
          <div className="bs-pcard-media bs-skel" style={{ aspectRatio: "1 / 1" }} />
          <div className="bs-pcard-body">
            <div className="bs-skel mb-2 h-3 w-1/4" />
            <div className="bs-skel h-4 w-4/5" />
            <div className="bs-skel mt-2 h-3 w-2/5" />
            <div className="bs-skel mt-3 h-4 w-1/4" />
          </div>
        </div>
      ))}
      <span className="sr-only">Loading products…</span>
    </div>
  );
}

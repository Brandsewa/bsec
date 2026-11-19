"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMoney } from "@/components/market/MarketProvider.tsx";
import { mediaImage } from "@bs/blocks/media-image";
import { useBuy } from "./VariantSelector.tsx";

export interface VariantCardStyle {
  /** Show the "Save N%" badge on discounted cards (default true). */
  /** Show the price and compare-at price under the name (default true). */
  showPrice?: boolean | undefined;
  showBadge?: boolean | undefined;
  /** Card background, selected border/ring and badge colours; empty uses the theme's. */
  bg?: string | undefined;
  active?: string | undefined;
  badgeBg?: string | undefined;
  badgeText?: string | undefined;
}

/**
 * One card per value of an option: the variant's own picture when it has one, the value, its price, the compare-at price and a
 * "Save N%" badge. The card shows the first variant that has this value and fits the other chosen options (in stock first).
 * Two cards fit the row on a phone, three on a tablet and on desktop; more become a swipe row, with arrows on
 * desktop that appear on hover or keyboard focus.
 */
export function VariantCards({ optionName, values, card }: { optionName: string; values: string[]; card?: VariantCardStyle | undefined }) {
  const { product, variants, selectedOptions, pick } = useBuy();
  const money = useMoney();
  const rowRef = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ prev: false, next: false });

  const measure = useCallback(() => {
    const el = rowRef.current;
    if (!el) return;
    setEdge({ prev: el.scrollLeft > 4, next: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    measure();
    const el = rowRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, values.length]);

  // Keep the chosen card in view (deep links, keyboard).
  const selected = selectedOptions[optionName];
  useEffect(() => {
    const el = rowRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!el || !rowRef.current) return;
    const row = rowRef.current;
    if (el.offsetLeft < row.scrollLeft || el.offsetLeft + el.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollTo({ left: el.offsetLeft - 4, behavior: "smooth" });
  }, [selected]);

  const slide = (dir: 1 | -1) => rowRef.current?.scrollBy({ left: dir * rowRef.current.clientWidth * 0.9, behavior: "smooth" });
  const arrow = "absolute top-1/2 z-10 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-background text-foreground shadow-md ring-1 ring-black/10 transition-opacity focus-visible:opacity-100 lg:opacity-0 lg:group-hover/cards:opacity-100";

  return (
    <div className="group/cards relative">
      <div
        ref={rowRef}
        onScroll={measure}
        role="group"
        aria-label={optionName}
        className="-mx-0.5 grid auto-cols-[calc(50%-0.25rem)] grid-flow-col gap-2 overflow-x-auto scroll-smooth px-0.5 pb-0.5 pt-2.5 [scrollbar-width:none] snap-x snap-mandatory sm:auto-cols-[calc(33.333%-0.34rem)] [&::-webkit-scrollbar]:hidden"
      >
        {values.map((val) => {
          const fits = variants.filter((v) => (v.optionValues as Record<string, string> | null)?.[optionName] === val && Object.entries(selectedOptions).every(([k, o]) => k === optionName || (v.optionValues as Record<string, string> | null)?.[k] === o));
          const pool = fits.length > 0 ? fits : variants.filter((v) => (v.optionValues as Record<string, string> | null)?.[optionName] === val);
          const v = pool.find((x) => x.stockStatus !== "out_of_stock") ?? pool[0];
          const available = pool.some((x) => x.stockStatus !== "out_of_stock");
          const m = v?.imageMediaId ? product.media.find((x) => x.mediaId === v.imageMediaId && x.kind !== "video") : undefined;
          const img = m?.url ? mediaImage({ url: m.url, width: m.width, height: m.height, focalX: m.focalX, focalY: m.focalY, dominantColor: m.dominantColor, derivatives: m.derivatives }, { sizes: "64px" }) : null;
          const compare = v?.compareAtPrice && v.price && v.compareAtPrice > v.price ? v.compareAtPrice : undefined;
          const save = compare && v ? Math.round(((compare - v.price) / compare) * 100) : 0;
          const isSelected = selectedOptions[optionName] === val;
          return (
            <button
              key={val}
              type="button"
              aria-pressed={isSelected}
              onClick={() => pick(optionName, val)}
              style={{
                ...(card?.bg ? { backgroundColor: card.bg } : null),
                ...(isSelected && card?.active ? { borderColor: card.active, boxShadow: `0 0 0 1px ${card.active}` } : null),
              }}
              className={`relative flex min-w-0 snap-start items-center gap-2 rounded-lg border ${card?.bg ? "" : "bg-surface"} p-1.5 text-left transition ${isSelected ? `${card?.active ? "" : "border-primary ring-1 ring-primary"}` : "border-border/80 hover:border-foreground/40"} ${available ? "" : "opacity-50"}`}
            >
              {save > 0 && card?.showBadge !== false ? (
                <span
                  style={{ ...(card?.badgeBg ? { backgroundColor: card.badgeBg } : null), ...(card?.badgeText ? { color: card.badgeText } : null) }}
                  className={`absolute -top-2 right-2 rounded-full px-1.5 py-px text-[0.6rem] font-semibold ${card?.badgeBg ? "" : "bg-emerald-200"} ${card?.badgeText ? "" : "text-emerald-900"}`}
                >
                  Save {save}%
                </span>
              ) : null}
              {img ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={img.src} srcSet={img.srcSet} sizes="64px" alt="" loading="lazy" className="h-9 w-9 shrink-0 rounded-md object-cover" />
              ) : null}
              <span className="flex min-w-0 flex-col gap-[3px]">
                <span className={`truncate text-[13px] font-semibold leading-tight ${available ? "" : "line-through"}`}>{val}</span>
                {v && !product.priceOnRequest && card?.showPrice !== false ? (
                  <span className="flex flex-wrap items-baseline gap-x-1.5 text-[11px] leading-tight">
                    <span className="font-semibold">{money(v.price)}</span>
                    {compare ? <span className="text-muted-foreground line-through">{money(compare)}</span> : null}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
      {edge.prev ? (
        <button type="button" aria-label="Previous options" onClick={() => slide(-1)} className={`${arrow} -left-3 lg:inline-flex`}>
          <svg aria-hidden className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
      ) : null}
      {edge.next ? (
        <button type="button" aria-label="More options" onClick={() => slide(1)} className={`${arrow} -right-3 lg:inline-flex`}>
          <svg aria-hidden className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
        </button>
      ) : null}
    </div>
  );
}

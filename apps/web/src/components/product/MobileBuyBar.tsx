"use client";

import React, { useEffect, useState } from "react";

/**
 * Phone only: once the main add-to-cart area has scrolled out of view, a bar with the price and a
 * button that scrolls back to it keeps the purchase one tap away. Purely presentational: adding to
 * the cart still happens in the buy box, so prices and stock are never decided here.
 */
export function MobileBuyBar({ title, priceLabel, targetId = "buy-box" }: { title: string; priceLabel: string; targetId?: string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const target = document.getElementById(targetId);
    if (!target || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(Boolean(entry && !entry.isIntersecting && entry.boundingClientRect.top < 0)),
      { threshold: 0 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [targetId]);

  return (
    <div
      aria-hidden={!visible}
      className={`fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur transition-transform duration-200 lg:hidden ${
        visible ? "translate-y-0" : "translate-y-full"
      }`}
    >
      <div className="mx-auto flex max-w-xl items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted-foreground">{title}</p>
          <p className="text-base font-bold text-foreground">{priceLabel}</p>
        </div>
        <button
          type="button"
          tabIndex={visible ? 0 : -1}
          onClick={() => document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "center" })}
          className="rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-sm"
        >
          Add to cart
        </button>
      </div>
    </div>
  );
}

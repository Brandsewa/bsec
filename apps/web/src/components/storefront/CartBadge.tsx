"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";

export interface CartBadgeProps {
  count?: number | undefined;
  className?: string | undefined;
}

export function CartBadge({ count: initialCount, className = "" }: CartBadgeProps) {
  const [itemCount, setItemCount] = useState<number>(() => {
    if (initialCount !== undefined) return initialCount;
    if (typeof document !== "undefined") {
      try {
        const match = document.cookie.match(/(?:^|;\s*)bs_cart_count=([^;]+)/);
        if (match && match[1]) {
          const parsed = parseInt(decodeURIComponent(match[1]), 10);
          if (!Number.isNaN(parsed)) return parsed;
        }
      } catch {
        // ignore
      }
    }
    return 0;
  });

  useEffect(() => {
    if (initialCount !== undefined) {
      return;
    }

    let isMounted = true;
    // Async fetch from /api/storefront/cart
    fetch("/api/storefront/cart")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (isMounted && data && typeof data.itemCount === "number") {
          setItemCount(data.itemCount);
        }
      })
      .catch(() => {
        // Ignore network errors in background cart badge fetch
      });

    return () => {
      isMounted = false;
    };
  }, [initialCount]);

  const displayCount = initialCount !== undefined ? initialCount : itemCount;

  return (
    <Link
      href="/cart"
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors hover:opacity-80 ${className}`}
      style={{
        backgroundColor: "var(--color-surface, #f8fafc)",
        color: "var(--color-text, #0f172a)",
        borderRadius: "var(--radius, 9999px)",
      }}
      aria-label={`Cart, ${displayCount} items`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
        aria-hidden="true"
      >
        <circle cx="8" cy="21" r="1" />
        <circle cx="19" cy="21" r="1" />
        <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
      </svg>
      <span>Cart</span>
      <span
        className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-semibold text-white"
        style={{ backgroundColor: "var(--color-primary, #0f172a)" }}
      >
        {displayCount}
      </span>
    </Link>
  );
}

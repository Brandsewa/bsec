import React from "react";
import Link from "next/link";
import { CartBadge } from "./CartBadge";

export interface StoreHeaderProps {
  storeName?: string | undefined;
  logoUrl?: string | null | undefined;
  logoWidth?: number | undefined;
  cartItemCount?: number | undefined;
}

export function StoreHeader({
  storeName = "Store",
  logoUrl,
  logoWidth = 150,
  cartItemCount,
}: StoreHeaderProps) {
  return (
    <header
      className="sticky top-0 z-40 w-full border-b transition-colors"
      style={{
        backgroundColor: "var(--color-background, #ffffff)",
        borderColor: "var(--color-surface, #e2e8f0)",
        color: "var(--color-text, #0f172a)",
      }}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
        {/* Brand / Logo */}
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="flex items-center gap-2 text-xl font-bold tracking-tight hover:opacity-90"
            style={{ fontFamily: "var(--font-heading, inherit)" }}
          >
            {logoUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={logoUrl}
                alt={storeName}
                width={logoWidth}
                className="max-h-10 object-contain"
              />
            ) : (
              <span>{storeName}</span>
            )}
          </Link>

          {/* Main Navigation */}
          <nav className="hidden items-center gap-6 md:flex text-sm font-medium">
            <Link
              href="/"
              className="transition-colors hover:text-[var(--color-primary,#0f172a)]"
            >
              Home
            </Link>
            <Link
              href="/collections"
              className="transition-colors hover:text-[var(--color-primary,#0f172a)]"
            >
              Collections
            </Link>
            <Link
              href="/about"
              className="transition-colors hover:text-[var(--color-primary,#0f172a)]"
            >
              About
            </Link>
            <Link
              href="/contact"
              className="transition-colors hover:text-[var(--color-primary,#0f172a)]"
            >
              Contact
            </Link>
          </nav>
        </div>

        {/* Action icons / Cart */}
        <div className="flex items-center gap-4">
          <Link
            href="/search"
            aria-label="Search products"
            className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-surface,#f8fafc)]"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </Link>

          <Link
            href="/account"
            aria-label="My account"
            className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-surface,#f8fafc)]"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
            </svg>
          </Link>

          <CartBadge count={cartItemCount} />
        </div>
      </div>
    </header>
  );
}

import React from "react";
import Link from "next/link";

export interface StoreFooterProps {
  storeName?: string | undefined;
}

export function StoreFooter({ storeName = "Store" }: StoreFooterProps) {
  const currentYear = new Date().getFullYear();

  return (
    <footer
      className="mt-auto w-full border-t text-sm transition-colors"
      style={{
        backgroundColor: "var(--color-surface, #f8fafc)",
        borderColor: "rgba(0,0,0,0.08)",
        color: "var(--color-text, #0f172a)",
      }}
    >
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
          {/* Brand info */}
          <div className="space-y-3">
            <h3
              className="text-base font-semibold"
              style={{ fontFamily: "var(--font-heading, inherit)" }}
            >
              {storeName}
            </h3>
            <p className="text-xs text-gray-500">
              Quality products curated for modern living.
            </p>
          </div>

          {/* Quick links */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              Quick Links
            </h4>
            <ul className="mt-3 space-y-2">
              <li>
                <Link href="/about" className="hover:underline">
                  About
                </Link>
              </li>
              <li>
                <Link href="/search" className="hover:underline">
                  Search
                </Link>
              </li>
            </ul>
          </div>

          {/* Policies */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              Policies
            </h4>
            <ul className="mt-3 space-y-2">
              <li>
                <Link href="/policies/privacy" className="hover:underline">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link href="/policies/terms" className="hover:underline">
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link href="/policies/refund" className="hover:underline">
                  Refund Policy
                </Link>
              </li>
              <li>
                <Link href="/policies/shipping" className="hover:underline">
                  Shipping Policy
                </Link>
              </li>
            </ul>
          </div>

          {/* Newsletter Signup */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              Newsletter
            </h4>
            <p className="mt-2 text-xs text-gray-500">
              Subscribe to receive updates, access to exclusive deals, and more.
            </p>
            <form
              action="/api/storefront/newsletter/subscribe"
              method="POST"
              className="mt-3 flex max-w-sm flex-col gap-2 sm:flex-row"
            >
              <input
                type="email"
                name="email"
                required
                aria-label="Email address"
                placeholder="Enter your email"
                className="w-full rounded border px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-[var(--color-primary,#0f172a)]"
                style={{
                  backgroundColor: "var(--color-background, #ffffff)",
                  borderColor: "rgba(0,0,0,0.15)",
                  borderRadius: "var(--radius, 0.375rem)",
                }}
              />
              <button
                type="submit"
                className="shrink-0 rounded px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
                style={{
                  backgroundColor: "var(--color-primary, #0f172a)",
                  borderRadius: "var(--radius, 0.375rem)",
                }}
              >
                Subscribe
              </button>
            </form>
          </div>
        </div>

        <div className="mt-12 border-t pt-6 text-center text-xs text-gray-400">
          <p>
            &copy; {currentYear} {storeName}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}

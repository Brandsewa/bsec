"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Inline stroke icons (24px grid): the storefront does not carry an icon library.
const ICONS = {
  dashboard: "M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z",
  orders: "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0",
  reviews: "m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z",
  address: "M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0zM12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  profile: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  notifications: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0",
} as const;

const links: { href: string; label: string; icon: keyof typeof ICONS }[] = [
  { href: "/account", label: "Dashboard", icon: "dashboard" },
  { href: "/account/orders", label: "Purchase History", icon: "orders" },
  { href: "/account/reviews", label: "My Reviews", icon: "reviews" },
  { href: "/account/addresses", label: "Address", icon: "address" },
  { href: "/account/profile", label: "Profile", icon: "profile" },
  { href: "/account/notifications", label: "Notifications", icon: "notifications" },
];

/** Sidebar on desktop, a scrolling row of pills on phones. */
export function AccountNav() {
  const pathname = usePathname();
  const active = (href: string) => (href === "/account" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <nav aria-label="Account" className="-mx-4 flex min-w-0 gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0 lg:pb-0 [&::-webkit-scrollbar]:hidden">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={active(l.href) ? "page" : undefined}
          className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            active(l.href) ? "bg-[var(--muted)] text-[var(--foreground)] lg:bg-[var(--background)] lg:shadow-sm" : "text-[var(--muted-foreground)] hover:bg-[var(--background)]/60 hover:text-[var(--foreground)]"
          }`}
        >
          <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d={ICONS[l.icon]} />
          </svg>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

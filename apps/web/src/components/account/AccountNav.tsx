"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ACCOUNT_ICONS } from "./account-icons.ts";

// Inline stroke icons (24px grid), shared with the header account menu: the storefront does not carry an icon library.
const ICONS = ACCOUNT_ICONS;

const links: { href: string; label: string; icon: keyof typeof ICONS }[] = [
  { href: "/account", label: "Dashboard", icon: "dashboard" },
  { href: "/account/orders", label: "Orders", icon: "orders" },
  { href: "/account/returns", label: "Returns", icon: "returns" },
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

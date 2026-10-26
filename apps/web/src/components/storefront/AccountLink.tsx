"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** Header account link: the user icon with "Login", or with the shopper's first name once signed in. */
export function AccountLink() {
  const [name, setName] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  // The header stays mounted across sign-in and sign-out, so look again whenever the page changes.
  const pathname = usePathname();

  useEffect(() => {
    let live = true;
    fetch("/api/storefront/customer/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { signedIn?: boolean; name?: string | null } | null) => {
        if (!live) return;
        setSignedIn(d?.signedIn === true);
        if (!d?.signedIn) return setName(null);
        setName(d.name?.trim().split(/\s+/)[0] || null);
      })
      .catch(() => {
        // Stays on "Login".
      });
    return () => {
      live = false;
    };
  }, [pathname]);

  return (
    <Link href="/account" className="bsb-site-account" aria-label={signedIn ? "My account" : "Log in"}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </svg>
      <span>{signedIn ? name ?? "Account" : "Login"}</span>
    </Link>
  );
}

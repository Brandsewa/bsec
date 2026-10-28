"use client";

import React, { useEffect, useState } from "react";
import type { ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type MenuProps = { name: string | null; anchor: HTMLElement | null; onClose: (restoreFocus: boolean) => void };

/**
 * Header account link: the user icon with "Login", or, once signed in, the shopper's photo and first name with a small arrow that opens
 * the account menu (a dropdown on desktop, a slide-in drawer on tablets and phones). The menu's code loads on first open.
 */
/** `icon` is the plain user icon, drawn by the server (ThemeChrome) so it is not part of this client script. */
export function AccountLink({ icon }: { icon?: React.ReactNode }) {
  const [name, setName] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  // The header stays mounted across sign-in and sign-out, so look again whenever the page changes.
  const pathname = usePathname();
  // The menu is open for the page it was opened on, so moving to another page closes it.
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [Menu, setMenu] = useState<ComponentType<MenuProps> | null>(null);
  // The button as state (a callback ref), so the menu can be positioned from it without reading a ref while rendering.
  const [button, setButton] = useState<HTMLButtonElement | null>(null);
  const open = openFor === pathname;

  useEffect(() => {
    let live = true;
    fetch("/api/storefront/customer/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { signedIn?: boolean; name?: string | null; image?: string | null } | null) => {
        if (!live) return;
        setSignedIn(d?.signedIn === true);
        setImage(d?.image ?? null);
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

  const close = (restoreFocus: boolean) => {
    setOpenFor(null);
    if (restoreFocus) button?.focus();
  };

  const face = (
    <>
      {image ? (
        // Google profile photo: a plain img (no optimiser proxy), referrer withheld.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" width={22} height={22} referrerPolicy="no-referrer" className="bs-av" />
      ) : (
        icon
      )}
      <span>{signedIn ? name ?? "Account" : "Login"}</span>
    </>
  );

  if (!signedIn) {
    return (
      <Link href="/account" className="bsb-site-account" aria-label="Log in">
        {face}
      </Link>
    );
  }

  return (
    <>
      <button
        ref={setButton}
        type="button"
        className="bsb-site-account"
        aria-label="My account"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpenFor(open ? null : pathname);
          if (!Menu) void import("./AccountMenu.tsx").then((m) => setMenu(() => m.AccountMenu));
        }}
      >
        {face}
      </button>
      {/* A sibling, not a child: events from the menu (drawn on the page body) must not reach the button's click handler. */}
      {open && Menu ? <Menu name={name} anchor={button} onClose={close} /> : null}
    </>
  );
}

"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ACCOUNT_ICONS, type AccountIcon } from "@/components/account/account-icons.ts";
import "@/lib/google-identity.ts";

const ITEMS: { href: string; label: string; icon: AccountIcon }[] = [
  { href: "/account", label: "Account", icon: "dashboard" },
  { href: "/account/orders", label: "Orders", icon: "orders" },
  { href: "/account/profile", label: "Profile", icon: "profile" },
  { href: "/account/addresses", label: "Address", icon: "address" },
  { href: "/account/reviews", label: "Reviews", icon: "reviews" },
  { href: "/account/notifications", label: "Notifications", icon: "notifications" },
];

const ITEM = "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-[var(--foreground)] outline-none transition-colors hover:bg-[var(--muted)] focus-visible:bg-[var(--muted)] focus-visible:ring-2 focus-visible:ring-[var(--primary)] lg:py-2";

function Icon({ name }: { name: AccountIcon }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0 text-[var(--muted-foreground)]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={ACCOUNT_ICONS[name]} />
    </svg>
  );
}

/**
 * The signed-in shopper's account menu: a small dropdown under the header button on desktop, a slide-in drawer (90% of the screen width)
 * on tablets and phones. Loaded only when first opened, so it is not part of every page's JavaScript. Keyboard: arrows, Home and End move
 * between the links, Escape closes and returns to the button, Tab leaves the menu.
 */
export function AccountMenu({ name, anchor, onClose }: { name: string | null; anchor: HTMLElement | null; onClose: (restoreFocus: boolean) => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const panel = useRef<HTMLDivElement>(null);
  const [signingOut, setSigningOut] = useState(false);
  // The latest onClose (the caller passes a new function each render), so the listeners below are added once.
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  });

  // Desktop: sit under the header button with the right edges aligned. The menu is drawn on the page body (the sticky header would cap its
  // stacking level below the bottom navigation), so the position comes from the button.
  useLayoutEffect(() => {
    const r = anchor?.getBoundingClientRect();
    if (!r || !panel.current) return;
    panel.current.style.setProperty("--ay", `${Math.round(r.bottom + 8)}px`);
    panel.current.style.setProperty("--ax", `${Math.max(8, Math.round(window.innerWidth - r.right))}px`);
  }, [anchor]);

  useEffect(() => {
    const first = panel.current?.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus();
    // Drawer mode (below 1024px): the page behind does not scroll.
    const drawer = window.innerWidth < 1024;
    const overflow = document.body.style.overflow;
    if (drawer) document.body.style.overflow = "hidden";
    const outside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !anchor?.contains(t)) closeRef.current(false);
    };
    document.addEventListener("mousedown", outside);
    // A resize changes where the button is: close rather than leave the dropdown behind.
    const width = window.innerWidth;
    const resize = () => window.innerWidth !== width && closeRef.current(false); // not for a phone's address bar showing or hiding
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("mousedown", outside);
      window.removeEventListener("resize", resize);
      document.body.style.overflow = overflow;
    };
  }, [anchor]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      return onClose(true);
    }
    if (e.key === "Tab") return onClose(false);
    const items = [...(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const move = (i: number) => {
      e.preventDefault();
      items[(i + items.length) % items.length]?.focus();
    };
    if (e.key === "ArrowDown") move(at + 1);
    else if (e.key === "ArrowUp") move(at - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(items.length - 1);
  }

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch("/api/storefront/customer/logout", { method: "POST" });
      // Stops One Tap from silently signing the shopper straight back in.
      window.google?.accounts.id.disableAutoSelect();
    } finally {
      onClose(false);
      router.push("/account");
      router.refresh();
    }
  }

  const active = (href: string) => (href === "/account" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));

  return createPortal(
    <>
      <div aria-hidden className="bs-acct-backdrop fixed inset-0 z-[88] bg-black/50 lg:hidden" onClick={() => onClose(true)} />
      <div
        ref={panel}
        role="menu"
        aria-label="Account menu"
        onKeyDown={onKeyDown}
        className="bs-acct-panel bs-skin fixed inset-y-0 right-0 z-[90] flex w-[90%] flex-col bg-[var(--background)] text-[var(--foreground)] shadow-2xl lg:inset-y-auto lg:right-[var(--ax,1rem)] lg:top-[var(--ay,3.5rem)] lg:w-60 lg:rounded-xl lg:border lg:border-[var(--border)]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3.5 lg:hidden">
          <p className="truncate text-base font-semibold">{name ? `Hi, ${name}` : "My account"}</p>
          <button type="button" onClick={() => onClose(true)} aria-label="Close menu" className="rounded-full p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)]">
            <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d={ACCOUNT_ICONS.close} />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 lg:overflow-visible lg:p-1.5">
          {ITEMS.map((i) => (
            <Link key={i.href} href={i.href} role="menuitem" tabIndex={-1} aria-current={active(i.href) ? "page" : undefined} onClick={() => onClose(false)} className={`${ITEM} ${active(i.href) ? "bg-[var(--muted)]" : ""}`}>
              <Icon name={i.icon} />
              {i.label}
            </Link>
          ))}
          <div role="separator" className="my-1.5 h-px bg-[var(--border)]" />
          <button type="button" role="menuitem" tabIndex={-1} onClick={() => void signOut()} disabled={signingOut} className={`${ITEM} disabled:opacity-60`}>
            <Icon name="logout" />
            {signingOut ? "Signing out..." : "Logout"}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

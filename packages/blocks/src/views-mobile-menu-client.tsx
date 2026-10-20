"use client";
/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

/**
 * Phone navigation: a side drawer that opens under the header (so the logo stays visible) and covers most of the screen,
 * with a dimmed backdrop. It closes on Escape, on a tap outside or on a link. The storefront's bottom bar opens it too,
 * through the "bs:toggle-menu" window event. The links themselves are drawn by the server and passed in as children.
 */

const HamburgerIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
);

const CloseIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export const MOBILE_MENU_EVENT = "bs:toggle-menu";

/**
 * The browser globals this component touches, typed by hand: the blocks source is also type-checked by apps that compile
 * without the DOM library (the platform API), where `window` and `document` do not exist as types.
 */
interface BrowserEnv {
  innerWidth: number;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  document: {
    body: { style: { overflow: string } };
    addEventListener(type: "keydown", listener: (e: { key: string }) => void): void;
    removeEventListener(type: "keydown", listener: (e: { key: string }) => void): void;
  };
}
const browser = (): BrowserEnv => globalThis as unknown as BrowserEnv;

export function MobileMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [top, setTop] = useState(56);
  const anchor = useRef<HTMLSpanElement>(null);

  /** The drawer starts where the header ends, wherever the page is scrolled to. */
  const measure = () => {
    const header = (anchor.current as unknown as { closest?: (selector: string) => { getBoundingClientRect(): { bottom: number } } | null } | null)?.closest?.("header");
    if (header) setTop(Math.max(0, Math.round(header.getBoundingClientRect().bottom)));
  };

  useEffect(() => {
    const toggle = () =>
      setOpen((wasOpen) => {
        if (!wasOpen) measure();
        return !wasOpen;
      });
    browser().addEventListener(MOBILE_MENU_EVENT, toggle);
    return () => browser().removeEventListener(MOBILE_MENU_EVENT, toggle);
  }, []);

  useEffect(() => {
    if (!open) return;
    const env = browser();
    const previous = env.document.body.style.overflow;
    env.document.body.style.overflow = "hidden";
    const onKey = (e: { key: string }) => {
      if (e.key === "Escape") setOpen(false);
    };
    // Rotating the phone or growing past the phone layout leaves nothing to show.
    const onResize = () => (env.innerWidth >= 768 ? setOpen(false) : measure());
    env.document.addEventListener("keydown", onKey);
    env.addEventListener("resize", onResize);
    return () => {
      env.document.body.style.overflow = previous;
      env.document.removeEventListener("keydown", onKey);
      env.removeEventListener("resize", onResize);
    };
  }, [open]);

  const onDrawerClick = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as { closest?: (selector: string) => unknown }).closest?.("a")) setOpen(false);
  };

  return (
    <div className="bsb-mobile-menu">
      <span ref={anchor} hidden />
      <button
        type="button"
        className="bsb-site-icon bsb-mobile-toggle"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => {
          if (!open) measure();
          setOpen(!open);
        }}
      >
        {open ? CloseIcon : HamburgerIcon}
      </button>
      {open ? (
        <>
          <div className="bsb-mobile-scrim" style={{ top }} onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="bsb-mobile-drawer" style={{ top }} onClick={onDrawerClick} role="dialog" aria-label="Menu">
            {children}
          </div>
        </>
      ) : null}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useContext, useEffect, useState } from "react";
import { useTheme } from "@bs/ui";
import { CloseIcon, MenuIcon, MoonIcon, SunIcon } from "./icons.tsx";
import { SiteNavContext } from "./site-nav.tsx";

const LINKS = [
  { label: "Features", href: "/#ready" },
  { label: "AI shopping", href: "/#ai" },
  { label: "Pricing", href: "/#pricing" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
];

/** Both icons are rendered and marketing.css shows the right one, so the toggle cannot mismatch on hydration. */
function ThemeToggle() {
  const { resolved, setPreference } = useTheme();
  return (
    <button type="button" className="iconbtn" aria-label="Switch between light and dark theme" onClick={() => setPreference(resolved === "dark" ? "light" : "dark")}>
      <span className="when-light"><MoonIcon /></span>
      <span className="when-dark"><SunIcon /></span>
    </button>
  );
}

export function HomeNav() {
  const [open, setOpen] = useState(false);
  const nav = useContext(SiteNavContext);
  const links = nav?.links ?? LINKS;
  const h = nav?.header;
  const brand = h?.brand ?? "BCOM";
  const loginHref = h?.loginHref ?? "https://admin.bcom.si";

  // The drawer closes on Escape and holds the page still while it is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
    {nav?.announcement}
    <header className="top">
      <div className={`wrap top-in lay-${h?.layout ?? "left"}`}>
        <button type="button" className="iconbtn menu" aria-label="Open menu" aria-expanded={open} aria-controls="mk-menu" onClick={() => setOpen(true)}>
          <MenuIcon />
        </button>
        <Link className="logo" href="/" aria-label={`${brand} home`}>
          <i>{brand.slice(0, 1)}</i>{brand}
        </Link>
        <nav className="links" aria-label="Main">
          {links.map(({ label, href }) => (
            <Link key={href} href={href}>{label}</Link>
          ))}
        </nav>
        <div className="top-acts">
          {h?.showThemeToggle === false ? null : <ThemeToggle />}
          <a className="btn login" href={loginHref}>{h?.loginLabel ?? "Log in"}</a>
          <Link className="btn pri" href={h?.ctaHref ?? "/signup"}>{h?.ctaLabel ?? "Start free"}</Link>
        </div>
      </div>
    </header>
    <div className="mdrawer-bg" data-open={open} onClick={() => setOpen(false)} aria-hidden="true" />
    <aside id="mk-menu" className="mdrawer" data-open={open} aria-label="Menu">
      <div className="mdrawer-top">
        <Link className="logo" href="/" onClick={() => setOpen(false)}><i>{brand.slice(0, 1)}</i>{brand}</Link>
        <button type="button" className="iconbtn" aria-label="Close menu" onClick={() => setOpen(false)}><CloseIcon /></button>
      </div>
      <nav aria-label="Main">
        {links.map(({ label, href }) => (
          <Link key={href} href={href} onClick={() => setOpen(false)}>{label}</Link>
        ))}
      </nav>
      <a className="mdrawer-login" href={loginHref}>{h?.loginLabel ?? "Log in"}</a>
    </aside>
    </>
  );
}

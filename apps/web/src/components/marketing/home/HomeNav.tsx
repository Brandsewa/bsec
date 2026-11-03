"use client";

import Link from "next/link";
import { useContext, useState } from "react";
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
  return (
    <>
    {nav?.announcement}
    <header className="top">
      <div className="wrap top-in">
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
          <button type="button" className="iconbtn menu" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="mk-menu" onClick={() => setOpen((o) => !o)}>
            {open ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>
      </div>
      {open && (
        <div id="mk-menu" className="mpanel">
          {links.map(({ label, href }) => (
            <Link key={href} href={href} onClick={() => setOpen(false)}>{label}</Link>
          ))}
          <a href={loginHref}>{h?.loginLabel ?? "Log in"}</a>
        </div>
      )}
    </header>
    </>
  );
}

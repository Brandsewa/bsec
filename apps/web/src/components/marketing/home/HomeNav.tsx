"use client";

import Link from "next/link";
import { useState } from "react";
import { useTheme } from "@bs/ui";
import { CloseIcon, MenuIcon, MoonIcon, SunIcon } from "./icons.tsx";

const LINKS: Array<[string, string]> = [
  ["Features", "/#ready"],
  ["AI shopping", "/#ai"],
  ["Pricing", "/#pricing"],
  ["About", "/about"],
  ["Contact", "/contact"],
];

/** Both icons are rendered and home.css shows the right one, so the toggle cannot mismatch on hydration. */
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
  return (
    <header className="top">
      <div className="wrap top-in">
        <Link className="logo" href="/" aria-label="BCOM home">
          <i>B</i>BCOM
        </Link>
        <nav className="links" aria-label="Main">
          {LINKS.map(([label, href]) => (
            <Link key={href} href={href}>{label}</Link>
          ))}
        </nav>
        <div className="top-acts">
          <ThemeToggle />
          <a className="btn login" href="https://admin.bcom.si">Log in</a>
          <Link className="btn pri" href="/signup">Start free</Link>
          <button type="button" className="iconbtn menu" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="mk-menu" onClick={() => setOpen((o) => !o)}>
            {open ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>
      </div>
      {open && (
        <div id="mk-menu" className="mpanel">
          {LINKS.map(([label, href]) => (
            <Link key={href} href={href} onClick={() => setOpen(false)}>{label}</Link>
          ))}
          <a href="https://admin.bcom.si">Log in</a>
        </div>
      )}
    </header>
  );
}

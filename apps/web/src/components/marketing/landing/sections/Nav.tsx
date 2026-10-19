"use client";

import Link from "next/link";
import { useState } from "react";

const LINKS: Array<[string, string]> = [
  ["Ready today", "/#ready"],
  ["AI shopping", "/#ai"],
  ["Pricing", "/pricing"],
  ["About", "/about"],
  ["Contact", "/contact"],
];

export function Nav() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <nav aria-label="Main">
        <Link className="logo" href="/" aria-label="BCom home">
          <i>B</i>BCom
        </Link>
        <div className="links">
          {LINKS.map(([label, href]) => (
            <Link key={href} href={href}>{label}</Link>
          ))}
        </div>
        <a className="btn login" href="https://admin.bcom.si">Log in</a>
        <Link className="btn pri" href="/signup">Start free</Link>
        <button type="button" className="menu-btn" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="lp-menu" onClick={() => setOpen((o) => !o)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 8h16M4 16h16" />}
          </svg>
        </button>
      </nav>
      <div id="lp-menu" className={`mpanel ${open ? "open" : ""}`}>
        {LINKS.map(([label, href]) => (
          <Link key={href} href={href} onClick={() => setOpen(false)}>{label}</Link>
        ))}
        <a href="https://admin.bcom.si">Log in</a>
      </div>
    </>
  );
}

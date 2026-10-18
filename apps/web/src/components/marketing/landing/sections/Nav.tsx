"use client";

import Link from "next/link";
import { useState } from "react";

const LINKS: Array<[string, string]> = [
  ["How it works", "#how"],
  ["What you get", "#kit"],
  ["India", "#india"],
  ["Pricing", "#pricing"],
  ["FAQ", "#faq"],
];

export function Nav() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <nav aria-label="Main">
        <a className="logo" href="#top" aria-label="Bs Commerce home">
          <i>B</i>Bs Commerce
        </a>
        <div className="links">
          {LINKS.map(([label, href]) => (
            <a key={href} href={href}>{label}</a>
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
          <a key={href} href={href} onClick={() => setOpen(false)}>{label}</a>
        ))}
        <a href="https://admin.bcom.si">Log in</a>
      </div>
    </>
  );
}

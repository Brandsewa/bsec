"use client";

import { useContext } from "react";
import { BrandLogoImg } from "@bs/blocks";
import { SiteNavContext } from "./site-nav.tsx";
import type { ReactNode } from "react";
import Link from "next/link";
import { ADDRESS_LINE, SITE } from "../landing/site-info.ts";

/** One link column: open on wide screens, a folded section on tablets and phones (the same markup as the Footer block). */
function FootCol({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="foot-col">
      <nav className="foot-open" aria-label={title}>
        <h4>{title}</h4>
        {children}
      </nav>
      <details className="foot-fold">
        <summary><span>{title}</span><svg className="foot-chev" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg></summary>
        <div className="foot-links">{children}</div>
      </details>
    </div>
  );
}

/** The built-in footer. The signup page is a client component, so it uses this one directly. */
export function BuiltInFooter() {
  const nav = useContext(SiteNavContext);
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="foot-grid">
          <div className="foot-brand">
            <Link className="logo" href="/" aria-label={`${SITE.product} home`}><BrandLogoImg logo={nav?.brandLogo} name={SITE.product} fallback={<><i>B</i>{SITE.product}</>} /></Link>
            <p>{SITE.product} ({SITE.domain}) is a product of <a href={SITE.parentUrl} rel="noopener">{SITE.legalName}</a>.</p>
            <address>
              {ADDRESS_LINE}
              <br />
              <a href={`mailto:${SITE.emails.general}`}>{SITE.emails.general}</a> · <a href={`mailto:${SITE.emails.support}`}>{SITE.emails.support}</a>
            </address>
          </div>
          <FootCol title="Product">
            <Link href="/#ready">Features</Link>
            <Link href="/#ai">AI shopping</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/signup">Start free trial</Link>
            <a href="https://admin.bcom.si">Log in</a>
          </FootCol>
          <FootCol title="Company">
            <Link href="/about">About us</Link>
            <Link href="/contact">Contact us</Link>
            <a href={SITE.parentUrl} rel="noopener">{SITE.parentName}</a>
          </FootCol>
          <FootCol title="Legal">
            <Link href="/terms">Terms of service</Link>
            <Link href="/privacy">Privacy policy</Link>
            <Link href="/refund-policy">Refund and cancellation</Link>
            <Link href="/shipping-policy">Delivery policy</Link>
          </FootCol>
        </div>
        <p className="foot-legal">
          © {new Date().getFullYear()} {SITE.legalName}. CIN {SITE.cin} · GSTIN {SITE.gstin}. Chats, brands, orders and figures in the previews on this site are illustrations.
        </p>
      </div>
    </footer>
  );
}

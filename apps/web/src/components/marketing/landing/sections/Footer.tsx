import Link from "next/link";
import { ADDRESS_LINE, SITE } from "../site-info.ts";

export function SiteFooter() {
  return (
    <footer className="sfoot">
      <div className="wrap">
        <div className="sf-grid">
          <div className="sf-brand">
            <Link className="logo" href="/" aria-label={`${SITE.product} home`}>
              <i>B</i>{SITE.product}
            </Link>
            <p>
              {SITE.product} ({SITE.domain}) is a product of{" "}
              <a href={SITE.parentUrl} rel="noopener">{SITE.legalName}</a>.
            </p>
            <address>
              {ADDRESS_LINE}
              <br />
              <a href={`mailto:${SITE.emails.general}`}>{SITE.emails.general}</a> · <a href={`mailto:${SITE.emails.support}`}>{SITE.emails.support}</a>
            </address>
          </div>
          <nav aria-label="Product">
            <h4>Product</h4>
            <Link href="/#ready">Ready today</Link>
            <Link href="/#ai">AI shopping</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/signup">Start free trial</Link>
            <a href="https://admin.bcom.si">Log in</a>
          </nav>
          <nav aria-label="Company">
            <h4>Company</h4>
            <Link href="/about">About us</Link>
            <Link href="/contact">Contact us</Link>
            <a href={SITE.parentUrl} rel="noopener">{SITE.parentName}</a>
          </nav>
          <nav aria-label="Legal">
            <h4>Legal</h4>
            <Link href="/terms">Terms of service</Link>
            <Link href="/privacy">Privacy policy</Link>
            <Link href="/refund-policy">Refund and cancellation</Link>
            <Link href="/shipping-policy">Delivery policy</Link>
          </nav>
        </div>
        <p className="sf-legal">
          © {new Date().getFullYear()} {SITE.legalName}. CIN {SITE.cin} · GSTIN {SITE.gstin}. Chats, brands and figures in the previews on this site are
          illustrations.
        </p>
      </div>
    </footer>
  );
}

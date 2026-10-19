import Link from "next/link";
import { ADDRESS_LINE, SITE } from "./site-info.ts";

/** "Last updated" line shown at the top of every legal page. */
export function LegalMeta() {
  return <p className="meta">Last updated {SITE.legalUpdated}</p>;
}

/** Plain-English summary box at the top of a legal page. */
export function Summary({ children }: { children: React.ReactNode }) {
  return (
    <div className="box">
      <h3>In short</h3>
      {children}
    </div>
  );
}

/** Who we are: the same details everywhere (footer, contact, legal pages). */
export function CompanyBox() {
  return (
    <div className="box">
      <h3>{SITE.legalName}</h3>
      <p>
        Operator of {SITE.product} ({SITE.domain}).
        <br />
        {ADDRESS_LINE}
        <br />
        CIN {SITE.cin} · GSTIN {SITE.gstin}
      </p>
      <p>
        General: <a href={`mailto:${SITE.emails.general}`}>{SITE.emails.general}</a>
        <br />
        Support: <a href={`mailto:${SITE.emails.support}`}>{SITE.emails.support}</a>
      </p>
    </div>
  );
}

/** Grievance officer block (E-Commerce Rules 2020 style: name, title, email, response times). */
export function GrievanceBox() {
  const g = SITE.grievance;
  return (
    <div className="box">
      <h3>{g.title}</h3>
      <p>
        {g.name}, {SITE.legalName}
        <br />
        <a href={`mailto:${g.email}`}>{g.email}</a>
      </p>
      <p>
        We acknowledge a complaint within {g.acknowledgeHours} hours and aim to resolve it within {g.resolveDays} days of receiving it.
      </p>
    </div>
  );
}

export function RelatedLinks() {
  return (
    <p>
      See also: <Link href="/terms">Terms of service</Link> · <Link href="/privacy">Privacy policy</Link> · <Link href="/refund-policy">Refund and cancellation policy</Link> ·{" "}
      <Link href="/shipping-policy">Delivery policy</Link> · <Link href="/contact">Contact us</Link>
    </p>
  );
}

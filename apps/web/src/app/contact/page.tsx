import type { Metadata } from "next";
import { DocHeader, PageFrame } from "@/components/marketing/landing/PageFrame.tsx";
import { CompanyBox, GrievanceBox } from "@/components/marketing/landing/LegalBits.tsx";
import { organizationJsonLd } from "@/components/marketing/landing/seo.ts";
import { SITE } from "@/components/marketing/landing/site-info.ts";

export const metadata: Metadata = {
  title: "Contact us | BCom",
  description: "Contact BCom (bcom.si): email, registered address and grievance officer details for Brand Sewa Digital Private Limited.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <PageFrame>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd()) }} />
      <DocHeader eyebrow="Contact us" title="We are here to help." intro="Write to us and we will reply on business days." />
      <article className="doc">
        <div className="cards">
          <div className="box">
            <h3>Support</h3>
            <p>Help with your store, billing or account.</p>
            <p><a href={`mailto:${SITE.emails.support}`}>{SITE.emails.support}</a></p>
          </div>
          <div className="box">
            <h3>General enquiries</h3>
            <p>Questions about {SITE.product}, partnerships and press.</p>
            <p><a href={`mailto:${SITE.emails.general}`}>{SITE.emails.general}</a></p>
          </div>
        </div>

        <h2>Registered business</h2>
        <CompanyBox />
        <p>
          {SITE.product} is a product of <a href={SITE.parentUrl} rel="noopener">{SITE.legalName}</a>.
        </p>

        <h2>Grievances</h2>
        <p>If you have a complaint about the service or how your data is handled, write to our grievance officer.</p>
        <GrievanceBox />

        <h2>When you write to us</h2>
        <p>Tell us your store name (yourname.{SITE.domain}) and the email address on your account, so we can find you quickly.</p>
      </article>
    </PageFrame>
  );
}

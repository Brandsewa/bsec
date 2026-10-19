import type { Metadata } from "next";
import { DocHeader, PageFrame } from "@/components/marketing/landing/PageFrame.tsx";
import { LegalMeta, RelatedLinks, Summary } from "@/components/marketing/landing/LegalBits.tsx";
import { SITE } from "@/components/marketing/landing/site-info.ts";

export const metadata: Metadata = {
  title: "Delivery policy | BCom",
  description: "BCom is a software service delivered online. No physical goods are shipped.",
  alternates: { canonical: "/shipping-policy" },
};

export default function ShippingPolicyPage() {
  return (
    <PageFrame>
      <DocHeader eyebrow="Legal" title="Delivery policy" intro={`${SITE.product} is delivered online. Nothing is shipped.`} />
      <article className="doc">
        <LegalMeta />
        <Summary>
          <p>
            {SITE.product} is a software service. We do not ship physical goods. Your store workspace is ready as soon as you finish signing up, and you use it online from any device.
          </p>
        </Summary>

        <h2>What we deliver</h2>
        <p>
          When you sign up, we create your store workspace: your storefront on <strong>yourname.{SITE.domain}</strong> and your admin. You can sign in and start using it as soon as sign-up completes. There is no
          physical delivery, courier or delivery charge.
        </p>

        <h2>If you cannot access your store</h2>
        <p>
          If you do not get access after signing up, email <a href={`mailto:${SITE.emails.support}`}>{SITE.emails.support}</a> with your store name and we will look into it.
        </p>

        <h2>Products sold on stores built with {SITE.product}</h2>
        <p>
          Merchants who use {SITE.product} sell and ship their own products. Shipping times, charges and rules for those orders are set by each store and shown on its own policy pages. We do not ship, store or
          handle those goods.
        </p>

        <RelatedLinks />
      </article>
    </PageFrame>
  );
}

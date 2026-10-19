import type { Metadata } from "next";
import Link from "next/link";
import { DocHeader, PageFrame } from "@/components/marketing/landing/PageFrame.tsx";
import { GrievanceBox, LegalMeta, RelatedLinks, Summary } from "@/components/marketing/landing/LegalBits.tsx";
import { SITE } from "@/components/marketing/landing/site-info.ts";

export const metadata: Metadata = {
  title: "Terms of service | BCOM",
  description: "The terms for using BCOM (bcom.si), the e-commerce platform operated by Brand Sewa Digital Private Limited.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <PageFrame>
      <DocHeader eyebrow="Legal" title="Terms of service" intro={`The rules for using ${SITE.product}, written to be read.`} />
      <article className="doc">
        <LegalMeta />
        <Summary>
          <p>
            {SITE.product} lets you open and run an online store. You own your store and your content and you are responsible for what you sell. Plans are billed in rupees plus GST. You can
            cancel any time, and refunds are covered in the <Link href="/refund-policy">refund policy</Link>. Disputes are governed by Indian law.
          </p>
        </Summary>

        <h2>1. About these terms</h2>
        <p>
          {SITE.product} ({SITE.domain}) is an online platform operated by <strong>{SITE.legalName}</strong> (&ldquo;we&rdquo;, &ldquo;us&rdquo;), a company registered in India. By creating an account or using the service you
          agree to these terms. If you use the service for a business, you confirm you have authority to bind that business.
        </p>

        <h2>2. The service</h2>
        <p>
          {SITE.product} gives you a storefront, an admin, a theme and page builder, product and order management, cash on delivery checkout, GST invoices, returns and exchanges, customer
          management and related tools. Features marked &ldquo;Coming soon&rdquo; or &ldquo;Preview&rdquo;, and the example chats and figures shown on our website, are illustrations and are not part of the service until
          we release them. We may improve, change or retire features, and will tell you in advance of any change that materially reduces what your plan offers.
        </p>

        <h2>3. Eligibility and your account</h2>
        <ul>
          <li>You must be at least 18 and able to enter a contract under Indian law.</li>
          <li>Give accurate information and keep it up to date, including your business and GST details where they apply.</li>
          <li>Keep your sign-in details secure. You are responsible for activity under your account and for the staff accounts you create.</li>
        </ul>

        <h2>4. Free trial and plans</h2>
        <p>
          Every plan starts with a 14-day free trial; you do not need a card to start. At the end of the trial you choose a paid plan to keep selling. If you do not, we may limit or suspend
          your store. Each plan has limits (for example on products, orders, staff accounts and storage) shown on the <Link href="/pricing">pricing page</Link>.
        </p>

        <h2>5. Fees, billing and taxes</h2>
        <ul>
          <li>Fees are in Indian rupees and exclusive of GST, which is added where applicable.</li>
          <li>Plans are billed in advance, monthly or yearly as you choose.</li>
          <li>
            Plans are paid through Razorpay subscriptions. By starting a subscription you authorise recurring charges for your plan through Razorpay&rsquo;s secure checkout, and Razorpay&rsquo;s terms apply to the
            payment itself. For some stores we may set up or manage a plan directly and agree the terms with you in writing.
          </li>
          <li>If a payment fails we will retry and tell you. If it stays unpaid, we may suspend your store after reasonable notice.</li>
          <li>We will give at least 30 days&rsquo; notice before a price change takes effect on your plan.</li>
        </ul>

        <h2>6. Cancelling</h2>
        <p>
          You can cancel at any time. Your plan then ends at the end of the period you have paid for. See the <Link href="/refund-policy">refund and cancellation policy</Link> for how refunds work.
        </p>

        <h2>7. Your store and your content</h2>
        <ul>
          <li>You own the products, text, images and other content you add. You give us the permission needed to host, display, copy and process it to run your store.</li>
          <li>
            You are the seller. You are responsible for what you sell, your descriptions and prices, your GST registration and tax filings, your shipping and returns, and your compliance with consumer
            protection and other laws. We are not a party to sales between you and your customers.
          </li>
          <li>You must have the right to use everything you upload.</li>
        </ul>

        <h2>8. Acceptable use</h2>
        <p>You must not use the service to:</p>
        <ul>
          <li>sell or promote anything illegal, counterfeit, stolen, hazardous or otherwise prohibited by law, including weapons, narcotics and items that infringe others&rsquo; rights;</li>
          <li>deceive or defraud customers, or mislead them about prices, products or delivery;</li>
          <li>send spam, distribute malware, or attack, probe or overload the service or other users;</li>
          <li>collect other people&rsquo;s personal data without a lawful basis, or breach privacy and data protection laws;</li>
          <li>resell or white-label the service without our written permission.</li>
        </ul>
        <p>We may remove content or suspend a store that breaks these rules or the law.</p>

        <h2>9. Payments from your customers</h2>
        <p>
          Your customers can pay with cash on delivery or, through the payment provider you connect, online with UPI, cards and net banking. The provider&rsquo;s terms apply to those payments. We are not a bank or a
          payment aggregator and we do not hold your customers&rsquo; money.
        </p>

        <h2>10. Customer data</h2>
        <p>
          You decide why and how your customers&rsquo; personal data is used. We process it on your behalf to run your store, as described in our <Link href="/privacy">privacy policy</Link>. You are responsible
          for giving your customers any notices and getting any consents the law requires, including under India&rsquo;s Digital Personal Data Protection Act, 2023.
        </p>

        <h2>11. Our intellectual property</h2>
        <p>
          The platform, its software, design and the {SITE.product} name and marks belong to us or our licensors. We give you a limited, non-exclusive, non-transferable right to use the service while your account is
          active. You must not copy, reverse engineer or extract the service except as the law allows.
        </p>

        <h2>12. Availability and support</h2>
        <p>
          We work to keep the service available and secure but cannot promise it will always be uninterrupted or error-free. We may carry out maintenance, and will try to give notice of planned downtime.
          Support is by email at <a href={`mailto:${SITE.emails.support}`}>{SITE.emails.support}</a>.
        </p>

        <h2>13. Suspension and ending</h2>
        <p>
          You can stop using the service at any time. We may suspend or end your access if you break these terms or the law, do not pay, or if we are required to. After your account ends we will make your store
          data available to you for export for a reasonable period, unless the law or a serious breach prevents it, and then delete or anonymise it as set out in the privacy policy.
        </p>

        <h2>14. Disclaimers</h2>
        <p>
          To the extent the law allows, the service is provided &ldquo;as is&rdquo;. We do not promise that it will meet every need, that your store will make sales, or that any feature in preview or marked &ldquo;Coming soon&rdquo;
          will be released on a particular date.
        </p>

        <h2>15. Limit of liability</h2>
        <p>
          To the extent the law allows, we are not liable for indirect or consequential loss, or for loss of profit, revenue, data or goodwill. Our total liability for any claim relating to the service is limited
          to the fees you paid us in the 12 months before the claim arose. Nothing in these terms limits liability that cannot be limited by law.
        </p>

        <h2>16. Indemnity</h2>
        <p>
          You agree to cover losses and costs we suffer from third-party claims caused by your store, your content or your breach of these terms or the law.
        </p>

        <h2>17. Changes to these terms</h2>
        <p>
          We may update these terms. We will tell you about material changes by email or in the admin before they take effect. If you keep using the service after that, you accept the updated terms.
        </p>

        <h2>18. Governing law and disputes</h2>
        <p>
          These terms are governed by the laws of India. Please contact us first so we can try to resolve any dispute. If it is not resolved, the competent courts in {SITE.jurisdiction} have exclusive jurisdiction.
        </p>

        <h2>19. Complaints and contact</h2>
        <p>
          Write to <a href={`mailto:${SITE.emails.support}`}>{SITE.emails.support}</a> for support. For a complaint you can write to our grievance officer:
        </p>
        <GrievanceBox />

        <h2>20. General</h2>
        <p>
          These terms, with the privacy policy and refund policy, are the whole agreement between you and us about the service. If part of them is unenforceable, the rest still applies. Not enforcing a right
          now does not waive it later. You may not transfer your account without our consent. We may send notices to the email address on your account.
        </p>

        <RelatedLinks />
      </article>
    </PageFrame>
  );
}

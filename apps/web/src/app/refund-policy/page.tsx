import type { Metadata } from "next";
import { DocHeader, PageFrame } from "@/components/marketing/landing/PageFrame.tsx";
import { LegalMeta, RelatedLinks, Summary } from "@/components/marketing/landing/LegalBits.tsx";
import { SITE } from "@/components/marketing/landing/site-info.ts";

export const metadata: Metadata = {
  title: "Refund and cancellation policy | Bs Commerce",
  description: "How cancelling a Bs Commerce plan works and when refunds are given.",
  alternates: { canonical: "/refund-policy" },
};

export default function RefundPolicyPage() {
  return (
    <PageFrame>
      <DocHeader eyebrow="Legal" title="Refund and cancellation policy" intro="How to cancel your plan, and when we refund." />
      <article className="doc">
        <LegalMeta />
        <Summary>
          <p>
            The 14-day trial is free. You can cancel a paid plan at any time and keep access until the end of the period you paid for. If you ask within 7 days of a payment we refund that payment. We do not give
            refunds after 7 days. Approved refunds reach you in 5 to 7 business days.
          </p>
        </Summary>

        <h2>Free trial</h2>
        <p>Every plan starts with a 14-day free trial. You are not charged during the trial and you do not need a card to start. You can stop at any time.</p>

        <h2>Subscriptions and renewal</h2>
        <p>
          Paid plans are billed in advance, monthly or yearly as you choose, through Razorpay subscriptions. A plan renews automatically at the end of each period until you cancel. Fees are in Indian
          rupees plus GST.
        </p>

        <h2>How to cancel</h2>
        <ul>
          <li>Sign in to your store admin and use the Plan and billing section in Settings, or</li>
          <li>email <a href={`mailto:${SITE.emails.support}`}>{SITE.emails.support}</a> from the email address on your account.</li>
        </ul>
        <p>Cancelling stops the next renewal. Your plan and store stay active until the end of the period you have already paid for.</p>

        <h2>Refunds</h2>
        <ul>
          <li>
            <strong>Within 7 days of a payment:</strong> email us and we will refund that payment in full.
          </li>
          <li>
            <strong>After 7 days:</strong> we do not give refunds, including for unused time in a period. You keep access until the period ends.
          </li>
          <li>
            <strong>Mistakes:</strong> if you were charged twice, or charged in error, we will refund the extra or wrong amount whenever you tell us.
          </li>
        </ul>

        <h2>How long refunds take</h2>
        <p>
          We process an approved refund within 3 business days. It is returned to the payment method you used, through Razorpay, and usually reaches you within 5 to 7 business days depending on your bank or
          card issuer.
        </p>

        <h2>Orders on a merchant&rsquo;s store</h2>
        <p>
          This policy is about {SITE.product} plans. If you bought a product from a store built on {SITE.product}, the refund and return rules are set by that store, shown on its policy pages. We are not the seller.
        </p>

        <h2>Questions</h2>
        <p>
          Write to <a href={`mailto:${SITE.emails.support}`}>{SITE.emails.support}</a>. Please include your store name and the email on your account.
        </p>

        <RelatedLinks />
      </article>
    </PageFrame>
  );
}

import type { Metadata } from "next";
import { DocHeader, PageFrame } from "@/components/marketing/landing/PageFrame.tsx";
import { GrievanceBox, LegalMeta, RelatedLinks, Summary } from "@/components/marketing/landing/LegalBits.tsx";
import { ADDRESS_LINE, SITE } from "@/components/marketing/landing/site-info.ts";

export const metadata: Metadata = {
  title: "Privacy policy | Bs Commerce",
  description: "How Bs Commerce (bcom.si), operated by Brand Sewa Digital Private Limited, collects, uses and protects personal data under India's DPDP Act.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <PageFrame>
      <DocHeader eyebrow="Legal" title="Privacy policy" intro="What personal data we collect, why, who sees it, and the choices you have." />
      <article className="doc">
        <LegalMeta />
        <Summary>
          <p>
            We collect what we need to run your account and your store, we do not sell personal data, and we use trusted providers to run the service. You can ask to see, correct or delete
            your data at any time. If you are a shopper on a merchant&rsquo;s store, that merchant decides how your data is used and we process it for them.
          </p>
        </Summary>

        <h2>1. Who we are and which data this covers</h2>
        <p>
          {SITE.product} ({SITE.domain}) is operated by <strong>{SITE.legalName}</strong>, {ADDRESS_LINE}. This policy follows India&rsquo;s Digital Personal Data Protection Act, 2023 and the Information
          Technology Act, 2000. It covers two kinds of people:
        </p>
        <ul>
          <li>
            <strong>Visitors and account holders</strong> (people who browse our website, sign up, or run a store on {SITE.product}). For this data we decide the purpose and means, so we are the
            data fiduciary.
          </li>
          <li>
            <strong>Shoppers on merchants&rsquo; stores.</strong> The merchant decides why their customers&rsquo; data is collected. We process it on the merchant&rsquo;s behalf to run their store, so we act as
            a data processor.
          </li>
        </ul>

        <h2>2. What we collect</h2>
        <ul>
          <li>
            <strong>Account and store details:</strong> your name, email address, phone number if you give one, store name and address, GST number where applicable, and your sign-in credentials (passwords
            are stored in hashed form, never in plain text).
          </li>
          <li>
            <strong>Billing details:</strong> plan, invoices and payment status. Card, UPI and bank details are collected by our payment provider (Razorpay), not stored by us.
          </li>
          <li>
            <strong>Usage and device data:</strong> IP address, browser and device type, pages visited, and security and error logs.
          </li>
          <li>
            <strong>Messages:</strong> what you send our support or grievance team.
          </li>
          <li>
            <strong>Store data we process for merchants:</strong> products, orders, and the details a merchant&rsquo;s customers give at checkout (such as name, address, phone and email).
          </li>
        </ul>

        <h2>3. Why we use it</h2>
        <ul>
          <li>To create your account and store, and to provide, support and improve the service.</li>
          <li>To bill you, issue invoices and meet tax and accounting rules.</li>
          <li>To keep the service secure and to prevent fraud and abuse.</li>
          <li>To send service messages such as account, billing and security notices. We send marketing only with your consent, and you can withdraw it at any time.</li>
          <li>To comply with the law and respond to lawful requests.</li>
        </ul>
        <p>
          We process personal data with your consent or for other uses the law permits, such as providing a service you asked for, complying with legal duties and keeping the service secure.
        </p>

        <h2>4. Who we share it with</h2>
        <p>We do not sell personal data. We share it only as needed with:</p>
        <ul>
          <li>service providers who help us run the platform, such as cloud hosting and infrastructure, email delivery and security providers (for example Cloudflare for security checks and content delivery);</li>
          <li>Razorpay, to process subscription payments;</li>
          <li>the merchant, if you are their customer;</li>
          <li>professional advisers, and courts, regulators or other authorities when the law requires it.</li>
        </ul>
        <p>These providers may only use the data to provide their service to us and must protect it.</p>

        <h2>5. Cookies</h2>
        <p>
          We use cookies and similar technologies that are needed to keep you signed in, remember your choices and protect our forms from abuse. We do not use advertising cookies. If we add analytics we
          will update this policy.
        </p>

        <h2>6. Storage, transfers and security</h2>
        <p>
          Data is stored on secure servers. Some providers may process data outside India. We use safeguards such as encryption in transit, access controls, encrypted storage of sensitive credentials and
          audit logs. No system is perfectly secure, so we also work to detect and respond to incidents, and we will notify you and the authorities where the law requires.
        </p>

        <h2>7. How long we keep it</h2>
        <p>
          We keep personal data while your account is active and for as long as needed for the purposes above. After you close your account we delete or anonymise store data after a short grace period, except
          records we must keep by law, such as tax and accounting records.
        </p>

        <h2>8. Your rights</h2>
        <p>You can ask us to:</p>
        <ul>
          <li>give you a summary of the personal data we hold about you and how it is used;</li>
          <li>correct, complete or update it;</li>
          <li>erase it, where we no longer need it for a lawful purpose;</li>
          <li>deal with a grievance about how your data is handled;</li>
          <li>withdraw consent you gave us, and nominate someone to exercise your rights if you cannot.</li>
        </ul>
        <p>
          Email <a href={`mailto:${SITE.grievance.email}`}>{SITE.grievance.email}</a> or <a href={`mailto:${SITE.emails.support}`}>{SITE.emails.support}</a>. We will respond as soon as we can and within
          {" "}{SITE.grievance.resolveDays} days. If you are a shopper on a merchant&rsquo;s store, you can also use the privacy request page on that store, or contact the merchant.
        </p>

        <h2>9. Children</h2>
        <p>The service is for people aged 18 and over. We do not knowingly collect personal data from children. If you think we have, tell us and we will delete it.</p>

        <h2>10. Changes to this policy</h2>
        <p>We may update this policy. We will post the new version here with its date and, for material changes, tell you by email or in the admin.</p>

        <h2>11. Contact and grievances</h2>
        <GrievanceBox />

        <RelatedLinks />
      </article>
    </PageFrame>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { DocHeader, PageFrame } from "@/components/marketing/landing/PageFrame.tsx";
import { CompanyBox } from "@/components/marketing/landing/LegalBits.tsx";
import { SITE } from "@/components/marketing/landing/site-info.ts";

export const metadata: Metadata = {
  title: "About us | BCOM",
  description: "BCOM (bcom.si) is an agent-first e-commerce platform for Indian brands, a product of Brand Sewa Digital Private Limited.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <PageFrame>
      <DocHeader
        eyebrow="About us"
        title="An e-commerce platform built for how India sells, and for how people will shop next."
      />
      <article className="doc">
        <h2>Who we are</h2>
        <p>
          {SITE.product} ({SITE.domain}) is a product of{" "}
          <a href={SITE.parentUrl} rel="noopener">{SITE.legalName}</a>, a company registered in India. We build software that helps Indian brands open an online store and sell without needing a developer.
        </p>

        <h2>What {SITE.product} does</h2>
        <p>
          You pick a store name and get a complete online store on <strong>yourname.{SITE.domain}</strong> with an admin to run it. Today that includes:
        </p>
        <ul>
          <li>a storefront with ready-made themes and a visual, no-code theme builder;</li>
          <li>products with variants, categories, collections and stock;</li>
          <li>online payments (UPI, cards and net banking) and cash on delivery, with GST tax invoices;</li>
          <li>orders, returns and exchanges;</li>
          <li>customers and segments, discounts, staff accounts and roles.</li>
        </ul>
        <p>
          Every plan starts with a 14-day free trial. See <Link href="/pricing">pricing</Link> for plans in rupees.
        </p>

        <h2>Why agent-first</h2>
        <p>
          More people now ask AI assistants such as ChatGPT, Gemini and Claude what to buy. We are building {SITE.product} so that stores on it are ready for that: products that assistants can read and compare,
          prices that stay locked and correct, and checkout that works as each assistant launches shopping in India. These features are marked <strong>Coming soon</strong> on our site until they are released, and
          stores on {SITE.product} get them first.
        </p>

        <h2>How we work</h2>
        <ul>
          <li>We say what works today and mark what is coming.</li>
          <li>India first: rupees, GST, cash on delivery and the way Indian shoppers buy.</li>
          <li>Your store and your customers&rsquo; data stay yours.</li>
        </ul>

        <h2>The company</h2>
        <CompanyBox />
        <p>
          Questions? <Link href="/contact">Contact us</Link>.
        </p>
      </article>
    </PageFrame>
  );
}

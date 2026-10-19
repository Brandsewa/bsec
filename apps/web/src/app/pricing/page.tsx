import type { Metadata } from "next";
import Link from "next/link";
import { DocHeader, PageFrame } from "@/components/marketing/landing/PageFrame.tsx";
import { FALLBACK_PLANS } from "@/components/marketing/landing/content.ts";
import { Pricing } from "@/components/marketing/landing/sections/Pricing.tsx";
import { loadLandingPlans } from "@/server/landing-plans.ts";

export const metadata: Metadata = {
  title: "Pricing | BCom",
  description: "BCom plans in Indian rupees plus GST. Every plan starts with a 14-day free trial.",
  alternates: { canonical: "/pricing" },
};

export default async function PricingPage() {
  const live = await loadLandingPlans();
  const plans = live.length > 0 ? live : FALLBACK_PLANS;
  return (
    <PageFrame>
      <DocHeader eyebrow="Pricing" title="Simple plans in rupees." intro="Start with a 14-day free trial. Pay monthly or yearly. Prices exclude GST." />
      <Pricing plans={plans} bare />
      <article className="doc">
        <h2>Good to know</h2>
        <ul>
          <li>Prices are in Indian rupees and exclusive of GST, which is added at checkout.</li>
          <li>The 14-day free trial needs no card.</li>
          <li>Plans are billed in advance through Razorpay subscriptions. You can cancel any time.</li>
          <li>
            Refunds are covered in the <Link href="/refund-policy">refund and cancellation policy</Link>.
          </li>
          <li>
            Custom domains and the AI shopping features are coming soon and are not part of any plan until released.
          </li>
        </ul>
      </article>
    </PageFrame>
  );
}

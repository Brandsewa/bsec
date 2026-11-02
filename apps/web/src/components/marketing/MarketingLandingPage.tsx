/*
 * bcom.si home page: agent-first e-commerce platform (docs/MARKETING-AGENT-FIRST-PLAN.md, docs/MARKETING-SITE-PLAN.md).
 * Honest by design: what a merchant can use today is shown as ready; the AI-agent features are marked Coming soon.
 * No invented customers, counts or testimonials; previews are labelled sample data.
 * Server component composition; only the nav, AI tabs, pricing toggle and the store-name checker are client components.
 * Styling is scoped under `.mk` (home/home.css), shared with the other marketing pages and signup.
 */

import { FALLBACK_PLANS, type LandingPlan } from "./landing/content.ts";
import { organizationJsonLd } from "./landing/seo.ts";
import { HomeFooter } from "./home/HomeFooter.tsx";
import { HomeNav } from "./home/HomeNav.tsx";
import { HomePricing } from "./home/HomePricing.tsx";
import { HomeRoot } from "./home/HomeRoot.tsx";
import { AiSection, Faq, Features, FinalCta, Hero, IncludedStrip, Standards, Statement, Steps } from "./home/sections.tsx";

export function MarketingLandingPage({ plans }: { plans?: LandingPlan[] | undefined }) {
  const planList = plans && plans.length > 0 ? plans : FALLBACK_PLANS;
  return (
    <HomeRoot>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd()) }} />
      <HomeNav />
      <main id="main">
        <Hero />
        <IncludedStrip />
        <Statement />
        <Features />
        <Steps />
        <AiSection />
        <Standards />
        <HomePricing plans={planList} />
        <Faq />
        <FinalCta />
      </main>
      <HomeFooter />
    </HomeRoot>
  );
}

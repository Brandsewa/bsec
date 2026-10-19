/*
 * bcom.si home page: agent-first e-commerce platform (docs/MARKETING-AGENT-FIRST-PLAN.md, docs/MARKETING-SITE-PLAN.md).
 * Honest by design: what a merchant can use today is shown as ready; the AI-agent features are marked Coming soon.
 * Server component composition; only the phone demo, pricing toggle, nav menu and the store-name checker are client components.
 * Styling is scoped under `.lp` (landing/landing.css).
 */

import { LandingShell } from "./landing/LandingShell.tsx";
import { FALLBACK_PLANS, type LandingPlan } from "./landing/content.ts";
import { Faq, FinalCta } from "./landing/sections/Close.tsx";
import { SiteFooter } from "./landing/sections/Footer.tsx";
import { Hero } from "./landing/sections/Hero.tsx";
import { AiEra } from "./landing/sections/Kit.tsx";
import { Nav } from "./landing/sections/Nav.tsx";
import { Pricing } from "./landing/sections/Pricing.tsx";
import { India, Themes } from "./landing/sections/Proof.tsx";
import { organizationJsonLd } from "./landing/seo.ts";

export function MarketingLandingPage({ plans }: { plans?: LandingPlan[] | undefined }) {
  const planList = plans && plans.length > 0 ? plans : FALLBACK_PLANS;
  return (
    <LandingShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd()) }} />
      <Nav />
      <Hero />
      <India />
      <AiEra />
      <Themes />
      <Pricing plans={planList} />
      <Faq />
      <FinalCta />
      <SiteFooter />
    </LandingShell>
  );
}

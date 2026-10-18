/*
 * bcom.si landing: agent-first redesign (docs/MARKETING-AGENT-FIRST-PLAN.md).
 * THESIS: people now search inside AI chats, so the page shows a store being found, chosen, paid for and confirmed
 * inside one. Server component composition; only the demos, tabs, pricing toggle and nav menu are client components.
 * Styling is scoped under `.lp` (landing/landing.css); the old Beam page is replaced.
 */

import { Journey } from "./landing/sections/Journey.tsx";
import { LandingShell } from "./landing/LandingShell.tsx";
import { FALLBACK_PLANS, type LandingPlan } from "./landing/content.ts";
import { Faq, FinalCta, Footer, SalesRep } from "./landing/sections/Close.tsx";
import { Hero } from "./landing/sections/Hero.tsx";
import { Kit, Visibility } from "./landing/sections/Kit.tsx";
import { Nav } from "./landing/sections/Nav.tsx";
import { Pricing } from "./landing/sections/Pricing.tsx";
import { India, Launch, Themes } from "./landing/sections/Proof.tsx";
import { Shift, StandardsStrip } from "./landing/sections/Story.tsx";

export function MarketingLandingPage({ plans }: { plans?: LandingPlan[] | undefined }) {
  const planList = plans && plans.length > 0 ? plans : FALLBACK_PLANS;
  return (
    <LandingShell>
      <Nav />
      <Hero />
      <StandardsStrip />
      <Shift />
      <section className="sec" id="how" style={{ background: "var(--bg2)", borderBlock: "1px solid var(--line)" }}>
        <div className="wrap">
          <div className="rv" style={{ maxWidth: 760 }}>
            <span className="eyebrow">How an assistant shops your store</span>
            <h2>From a question to a <i className="s gt">delivered order.</i></h2>
            <p className="lead">Every step happens in the chat. You add products as usual. The rest is built in.</p>
          </div>
          <Journey />
        </div>
      </section>
      <Kit />
      <SalesRep />
      <Visibility />
      <India />
      <Themes />
      <Launch />
      <Pricing plans={planList} />
      <Faq />
      <FinalCta />
      <Footer />
    </LandingShell>
  );
}

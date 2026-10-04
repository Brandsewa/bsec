"use client";

/*
 * bcom.si landing, design 3: "Riso Zine".
 * THESIS: the store as a risograph-printed zine. Two or three fluorescent spot inks overprint on toothy paper, a hair
 *   out of register, the way indie Indian brands print their own packaging and lookbooks; refuses the stock SaaS
 *   arrangement of centred hero, logo strip, icon cards and a white pricing table.
 * OWN-WORLD: warm paper ground, fluoro pink / federal blue / sunflower as whole fields, multiply overprint, halftone
 *   dots, grain, Unbounded display, Schibsted Grotesk body, a marker scrawl in the margins.
 * STORY: a D2C founder sees real orders printed on a slip, reads exactly what is live (and what is Coming soon), checks
 *   a store name and starts the 14-day trial.
 * FIRST VIEWPORT: left, an overprinted headline whose two ink layers slide into register, one sentence, the store-name
 *   field with the pink button; right, the order slip on spot-ink shapes, new orders stamped on.
 * FORM: Riso Zine, challenger (competitive verdict) of the 2026-10-04 roll, built as the third design to compare.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
 */

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { SubdomainAvailabilityChecker } from "./SubdomainAvailabilityChecker.tsx";
import { RisoSlip } from "./landing3/RisoSlip.tsx";
import { useRevealMotion } from "./landing/motion.ts";
import { COMING_SOON, FAQS, FALLBACK_PLANS, INCLUDED_IN_ALL, STEPS, THEMES, planBullets, type LandingPlan } from "./landing/content.ts";
import { rzBodyFont, rzDisplayFont, rzScrawlFont } from "./landing3/fonts.ts";
import "./landing3/riso.css";

const inr = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
const PLAN_INK = ["var(--rz-pink)", "var(--rz-blue)", "var(--rz-yellow)"];
const PLAN_TEXT = ["var(--rz-ink)", "#fff", "var(--rz-ink)"];

function Over({ children, load = false }: { children: string; load?: boolean }) {
  return (
    <span className={`rz-over${load ? " rz-load" : ""}`} data-text={children}>
      {children}
    </span>
  );
}

function Burst({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12 0l2.4 8.2L22.5 6l-5.2 6 5.2 6-8.1-2.2L12 24l-2.4-8.2L1.5 18l5.2-6-5.2-6 8.1 2.2L12 0z" />
    </svg>
  );
}

function Mark() {
  return (
    <span className="relative inline-block h-9 w-9" aria-hidden="true">
      <span className="absolute inset-0 rounded-full" style={{ background: "var(--rz-pink)", mixBlendMode: "multiply" }} />
      <span className="absolute inset-0 translate-x-[3px] translate-y-[2px] rounded-full" style={{ background: "var(--rz-blue)", mixBlendMode: "multiply" }} />
    </span>
  );
}

const TICKER = ["Cash on delivery", "GST invoices", "Theme builder", "Returns and exchanges", "Pre-orders", "Segments", "Quotes", "Reviews"];

export function MarketingLandingRiso({ plans }: { plans?: LandingPlan[] | undefined }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useRevealMotion(rootRef, { item: ".rz-rv", armedClass: "rz-armed" });
  const [interval, setInterval_] = useState<"monthly" | "yearly">("monthly");
  const planList = useMemo(() => (plans && plans.length > 0 ? plans : FALLBACK_PLANS), [plans]);
  const cheapest = Math.min(...planList.map((p) => p.monthlyPaise));

  return (
    <div ref={rootRef} className={`rz ${rzDisplayFont.variable} ${rzBodyFont.variable} ${rzScrawlFont.variable}`} id="top">
      {/* ---------- Nav ---------- */}
      <header className="sticky top-0 z-40" style={{ background: "var(--rz-paper)", borderBottom: "2.5px solid var(--rz-ink)" }}>
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
          <a href="#top" className="flex items-center gap-2.5 no-underline" aria-label="bcom.si home" style={{ color: "var(--rz-ink)" }}>
            <Mark />
            <span className="rz-display text-[1.3rem]" style={{ letterSpacing: "-0.05em" }}>bcom.si</span>
          </a>
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Sections">
            {[
              ["What works today", "#live"],
              ["Themes", "#themes"],
              ["How it works", "#steps"],
              ["Pricing", "#pricing"],
              ["FAQ", "#faq"],
            ].map(([label, href]) => (
              <a key={href} href={href} className="rounded-full px-3.5 py-2 text-[0.95rem] font-semibold no-underline hover:bg-[var(--rz-yellow)]" style={{ color: "var(--rz-ink)" }}>
                {label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <a href="https://admin.bcom.si" className="hidden rounded-full px-3.5 py-2 text-[0.95rem] font-semibold sm:inline-block" style={{ color: "var(--rz-ink)" }}>Log in</a>
            <Link href="/signup" className="rz-btn rz-btn-sm">Start free trial</Link>
          </div>
        </div>
      </header>

      <main>
        {/* ---------- Hero ---------- */}
        <section className="relative mx-auto grid max-w-7xl gap-14 px-5 pb-20 pt-14 sm:px-8 lg:grid-cols-12 lg:items-center lg:gap-8 lg:pb-28 lg:pt-20">
          <div className="lg:col-span-7">
            <h1 className="rz-display text-[clamp(2.3rem,5.6vw,4.7rem)]" style={{ color: "var(--rz-ink)" }}>
              Open your Indian <Over load>online store</Over> <Over load>today.</Over>
            </h1>
            <p className="mt-7 max-w-[54ch] text-[1.15rem]" style={{ color: "var(--rz-ink)" }}>
              A themed storefront, cash on delivery and GST invoices in one admin, made for Indian D2C brands. Choose a
              name and start your 14-day free trial.
            </p>
            <div className="mt-9">
              <SubdomainAvailabilityChecker platformDomain="bcom.si" variant="riso" />
              <p className="rz-soft mt-3 text-[0.95rem] font-medium">
                14 days free · no card needed · plans from {inr(cheapest)} a month + GST
              </p>
            </div>
          </div>
          <div className="flex justify-center lg:col-span-5 lg:justify-end">
            <RisoSlip />
          </div>
        </section>

        {/* ---------- Ticker band ---------- */}
        <div className="rz-marquee overflow-hidden py-3.5" style={{ background: "var(--rz-ink)", color: "var(--rz-yellow)", borderTop: "2.5px solid var(--rz-ink)" }} aria-label="What bcom.si does today">
          <div className="rz-marquee-track" aria-hidden="true">
            {[0, 1].map((rep) => (
              <ul key={rep} className="flex shrink-0 items-center">
                {TICKER.map((t) => (
                  <li key={`${rep}-${t}`} className="flex items-center gap-5 pr-5">
                    <span className="rz-display whitespace-nowrap text-[1.25rem]" style={{ letterSpacing: "-0.03em" }}>{t}</span>
                    <span style={{ color: "var(--rz-pink)" }}><Burst size={16} /></span>
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>

        {/* ---------- What works today ---------- */}
        <section id="live" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
          <div className="rz-rv max-w-3xl">
            <h2 className="rz-h2">Everything on this sheet <Over>works today.</Over></h2>
            <p className="mt-5 max-w-[60ch]" style={{ color: "var(--rz-ink-soft)" }}>
              No roadmap in disguise. These are the parts a merchant can use the day they sign up. What is still being
              built is marked Coming soon, below.
            </p>
          </div>

          <div className="mt-14 grid grid-cols-12 gap-6">
            <article className="rz-sticker rz-rv rz-halftone rz-field-pink col-span-12 lg:col-span-7" style={{ rotate: "-0.7deg" }}>
              <h3 className="rz-display text-[1.6rem]">Cash on delivery, done properly</h3>
              <p className="mt-3 max-w-[56ch] font-medium">
                Set a COD fee per store. Stock is held when the order is placed and released if it is cancelled; you
                confirm, ship and mark it delivered, and the cash collected is recorded.
              </p>
              <ol className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Order lifecycle">
                {["Placed", "Confirmed", "Shipped", "Delivered"].map((s, i) => (
                  <li key={s} className="bg-white px-3 py-2.5" style={{ border: "2.5px solid var(--rz-ink)" }}>
                    <span className="rz-num block text-xs font-bold" style={{ color: "var(--rz-blue)" }}>Step {i + 1}</span>
                    <span className="font-bold">{s}</span>
                  </li>
                ))}
              </ol>
            </article>

            <article className="rz-sticker rz-rv rz-field-yellow col-span-12 lg:col-span-5" style={{ rotate: "0.8deg" }}>
              <h3 className="rz-display text-[1.6rem]">GST invoices</h3>
              <p className="mt-3 font-medium">CGST and SGST, or IGST, worked out from your state and your customer&apos;s, with the HSN on each line.</p>
              <dl className="rz-num mt-5 space-y-1.5 bg-white p-4 text-sm font-medium" style={{ border: "2.5px solid var(--rz-ink)" }} aria-label="Example invoice lines">
                <div className="flex justify-between"><dt>Cotton kurta · HSN 6104</dt><dd className="font-bold">₹1,000.00</dd></div>
                <div className="flex justify-between"><dt>CGST 9% + SGST 9% (same state)</dt><dd>₹180.00</dd></div>
                <div className="flex justify-between"><dt>or IGST 18% (other state)</dt><dd>₹180.00</dd></div>
              </dl>
              <p className="rz-scrawl mt-2 text-2xl" style={{ lineHeight: 1 }}>example only, rates depend on your products</p>
            </article>

            <article className="rz-sticker rz-rv rz-halftone rz-field-blue col-span-12 lg:col-span-5" style={{ rotate: "0.6deg" }}>
              <h3 className="rz-display text-[1.6rem]">Change your theme without code</h3>
              <p className="mt-3 font-medium">
                Drag, drop and edit blocks: slider, product showcase, reviews, newsletter, cart. Set colours, fonts and
                heading sizes per device. There is no custom code to break.
              </p>
              <ul className="mt-5 grid grid-cols-2 gap-2.5 text-sm font-bold" aria-label="Blocks you can place">
                {["Hero slider", "Product showcase", "Reviews", "Newsletter"].map((b) => (
                  <li key={b} className="px-3 py-2" style={{ background: "var(--rz-yellow)", color: "var(--rz-ink)", border: "2.5px solid var(--rz-ink)" }}>{b}</li>
                ))}
              </ul>
            </article>

            <article className="rz-sticker rz-rv col-span-12 bg-white lg:col-span-7" style={{ rotate: "-0.5deg" }}>
              <h3 className="rz-display text-[1.6rem]">The whole order, in one place</h3>
              <p className="mt-3 max-w-[60ch] font-medium">
                Returns and exchanges with photos, a Request a quote button for price-on-request products, pre-orders
                with a ship-on date, and a list of abandoned checkouts.
              </p>
              <ul className="mt-5 flex flex-wrap gap-2.5 text-sm font-bold">
                {[["Returns and exchanges", "pink"], ["Request a quote", "blue"], ["Pre-orders", "yellow"], ["Abandoned checkouts", "pink"], ["Reviews", "blue"], ["Discounts", "yellow"]].map(([t, c]) => (
                  <li key={t} className="rounded-full px-3.5 py-1.5" style={{ background: `var(--rz-${c})`, color: c === "blue" ? "#fff" : "var(--rz-ink)", border: "2.5px solid var(--rz-ink)" }}>{t}</li>
                ))}
              </ul>
            </article>

            <article className="rz-sticker rz-rv rz-field-yellow col-span-12 md:col-span-6" style={{ rotate: "0.5deg" }}>
              <h3 className="rz-display text-[1.6rem]">Know who is buying</h3>
              <p className="mt-3 font-medium">Customer profiles, notes, consent history and CSV import. Build segments from rules and see who falls in.</p>
              <div className="mt-5 bg-white p-4 text-sm" style={{ border: "2.5px solid var(--rz-ink)" }} aria-label="Example segment rule">
                <p className="font-bold">Win-back <span className="rz-scrawl text-xl font-normal">example segment</span></p>
                <p className="rz-soft mt-1">Total spend over ₹5,000 and last order more than 60 days ago</p>
              </div>
            </article>

            <article className="rz-sticker rz-rv rz-field-pink col-span-12 md:col-span-6" style={{ rotate: "-0.6deg" }}>
              <h3 className="rz-display text-[1.6rem]">Shipping rates you control</h3>
              <p className="mt-3 font-medium">Set zones, rates and a free-shipping threshold. The cart and the checkout charge the same total.</p>
              <div className="mt-5 bg-white p-4" style={{ border: "2.5px solid var(--rz-ink)" }} aria-label="Example free shipping progress">
                <div className="flex justify-between text-sm font-bold"><span>Standard ₹70</span><span className="rz-num" style={{ color: "var(--rz-blue)" }}>Free above ₹1,200</span></div>
                <div className="mt-3 h-3 overflow-hidden rounded-full" style={{ border: "2px solid var(--rz-ink)" }}>
                  <div className="h-full" style={{ width: "78%", background: "var(--rz-blue)" }} />
                </div>
                <p className="rz-scrawl mt-1 text-xl" style={{ lineHeight: 1 }}>example cart: ₹260 away from free shipping</p>
              </div>
            </article>
          </div>

          <div className="rz-rv mt-14">
            <h3 className="rz-display text-[1.6rem]">Coming soon</h3>
            <p className="mt-1 max-w-[60ch]" style={{ color: "var(--rz-ink-soft)" }}>Not live yet. We will announce each one when it works, not before.</p>
            <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {COMING_SOON.map((c, i) => (
                <li key={c.name} className="relative p-4" style={{ border: "2.5px dashed var(--rz-ink)", rotate: `${i % 2 ? 0.6 : -0.6}deg` }}>
                  <p className="rz-display text-[1.05rem]">{c.name}</p>
                  <p className="rz-soft text-sm">{c.note}</p>
                  <span className="rz-scrawl absolute -right-1 -top-4 text-2xl" style={{ color: "var(--rz-pink)", rotate: "6deg" }}>soon!</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------- Themes ---------- */}
        <section id="themes" className="rz-field-blue rz-halftone" style={{ borderTop: "2.5px solid var(--rz-ink)", borderBottom: "2.5px solid var(--rz-ink)" }}>
          <div className="relative mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
            <div className="rz-rv max-w-3xl">
              <h2 className="rz-h2">Pick a print.</h2>
              <p className="mt-5 max-w-[60ch] font-medium" style={{ color: "#e6f1fa" }}>
                Start from a theme made for your niche, then make it yours in the editor. These are illustrations of the
                starting layouts.
              </p>
            </div>
            <ul className="mt-14 grid gap-9 md:grid-cols-3">
              {THEMES.map((t, i) => (
                <li key={t.code} className="rz-rv" style={{ transitionDelay: `${i * 90}ms` }}>
                  <div className="bg-white p-4 transition-transform duration-500 hover:-translate-y-2" style={{ border: "2.5px solid var(--rz-ink)", rotate: `${[-1.2, 0.8, -0.5][i]}deg` }}>
                    <div className="p-3" style={{ background: t.ground, color: t.ink }}>
                      <div className="flex items-center justify-between">
                        <span className="rz-display text-xs">Your store</span>
                        <span className="flex gap-1" aria-hidden="true">{[0, 1, 2].map((d) => <span key={d} className="h-1.5 w-4 rounded-full" style={{ background: t.accent, opacity: 0.35 + d * 0.25 }} />)}</span>
                      </div>
                      <div className="mt-3 p-3.5" style={{ background: t.tile }}>
                        <p className="text-[0.7rem] font-bold uppercase tracking-wider" style={{ color: t.accent }}>New in</p>
                        <p className="rz-display mt-1 text-base leading-tight">{t.name}</p>
                        <span className="mt-2.5 inline-block px-2.5 py-1 text-[0.7rem] font-bold" style={{ background: t.accent, color: t.ground }}>Shop now</span>
                      </div>
                      <div className="mt-2.5 grid grid-cols-3 gap-1.5" aria-hidden="true">
                        {[0, 1, 2].map((c) => <div key={c} className="aspect-[4/5]" style={{ background: t.tile }} />)}
                      </div>
                    </div>
                  </div>
                  <h3 className="rz-display mt-5 text-xl">{t.name}</h3>
                  <p className="text-sm font-medium" style={{ color: "#e6f1fa" }}>{t.industry}</p>
                  <p className="mt-1 font-medium">{t.line}</p>
                  <Link href={`/signup?template=${t.code}`} className="mt-3 inline-block font-bold underline decoration-[var(--rz-yellow)] decoration-[3px] underline-offset-4">Start with this theme</Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------- Steps ---------- */}
        <section id="steps" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
          <div className="rz-rv max-w-3xl"><h2 className="rz-h2">From a name to your <Over>first order.</Over></h2></div>
          <ol className="mt-14 grid gap-x-10 gap-y-12 md:grid-cols-2">
            {STEPS.map((s, i) => (
              <li key={s.title} className="rz-rv flex gap-6" style={{ transitionDelay: `${i * 80}ms` }}>
                <span className="rz-display rz-num text-[5.5rem] leading-none" style={{ letterSpacing: "-0.08em" }} aria-hidden="true"><Over>{String(i + 1)}</Over></span>
                <div className="pt-2">
                  <h3 className="rz-display text-xl">{s.title}</h3>
                  <p className="mt-2 font-medium" style={{ color: "var(--rz-ink-soft)" }}>{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* ---------- Pricing ---------- */}
        <section id="pricing" className="rz-field-yellow rz-halftone" style={{ borderTop: "2.5px solid var(--rz-ink)", borderBottom: "2.5px solid var(--rz-ink)" }}>
          <div className="relative mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
            <div className="rz-rv flex flex-col justify-between gap-6 md:flex-row md:items-end">
              <div className="max-w-2xl">
                <h2 className="rz-h2">Plans you can read in one go.</h2>
                <p className="mt-5 font-medium">Prices in rupees, plus GST. Every plan starts with a 14-day free trial.</p>
              </div>
              <div className="inline-flex bg-white p-1" role="group" aria-label="Billing period" style={{ border: "2.5px solid var(--rz-ink)", borderRadius: "999px" }}>
                {(["monthly", "yearly"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setInterval_(v)}
                    aria-pressed={interval === v}
                    className="min-h-[2.5rem] rounded-full px-5 font-bold"
                    style={interval === v ? { background: "var(--rz-ink)", color: "var(--rz-paper)" } : { color: "var(--rz-ink)" }}
                  >
                    {v === "monthly" ? "Monthly" : "Yearly"}
                  </button>
                ))}
              </div>
            </div>

            <ul className="mt-12 grid gap-7 lg:grid-cols-3">
              {planList.map((p, i) => {
                const perMonth = interval === "monthly" ? p.monthlyPaise : p.yearlyPaise / 12;
                const saving = p.monthlyPaise * 12 - p.yearlyPaise;
                return (
                  <li key={p.code} className="rz-rv flex flex-col bg-white" style={{ border: "2.5px solid var(--rz-ink)", transitionDelay: `${i * 90}ms`, rotate: `${[-0.6, 0.4, -0.3][i % 3]}deg` }}>
                    <div className="px-6 py-4" style={{ background: PLAN_INK[i % 3], color: PLAN_TEXT[i % 3], borderBottom: "2.5px solid var(--rz-ink)" }}>
                      <h3 className="rz-display text-2xl">{p.name}</h3>
                    </div>
                    <div className="flex flex-1 flex-col p-6">
                      <p className="rz-num flex items-end gap-2">
                        <span className="rz-display text-5xl" style={{ letterSpacing: "-0.06em" }}>{inr(perMonth)}</span>
                        <span className="rz-soft pb-1.5 font-medium">a month</span>
                      </p>
                      <p className="rz-soft rz-num mt-1 min-h-[1.5rem] text-sm font-medium">
                        {interval === "yearly" ? `Billed ${inr(p.yearlyPaise)} a year${saving > 0 ? ` · you save ${inr(saving)}` : ""}` : "Billed monthly"}
                      </p>
                      <ul className="mt-6 flex-1 space-y-2.5">
                        {planBullets(p.limits).map((b) => (
                          <li key={b} className="flex items-start gap-2.5 font-medium">
                            <span className="mt-1.5 shrink-0" style={{ color: "var(--rz-pink)" }}><Burst size={14} /></span>
                            {b}
                          </li>
                        ))}
                      </ul>
                      <Link href={`/signup?plan=${p.code}&interval=${interval}`} className="rz-btn mt-8 w-full">Start free trial</Link>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="rz-rv mt-12">
              <p className="rz-display text-xl">Every plan includes</p>
              <ul className="mt-3 flex flex-wrap gap-2.5">
                {INCLUDED_IN_ALL.map((x) => (
                  <li key={x} className="rounded-full bg-white px-4 py-2 font-bold" style={{ border: "2.5px solid var(--rz-ink)" }}>{x}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ---------- FAQ ---------- */}
        <section id="faq" className="mx-auto max-w-4xl px-5 py-20 sm:px-8 lg:py-28">
          <div className="rz-rv"><h2 className="rz-h2">Straight <Over>answers.</Over></h2></div>
          <div className="mt-10">
            {FAQS.map((f) => (
              <details key={f.q} className="rz-faq rz-rv py-1" style={{ borderTop: "2.5px solid var(--rz-ink)" }}>
                <summary className="rz-display flex min-h-[3.75rem] items-center justify-between gap-4 py-3 text-[1.1rem]" style={{ letterSpacing: "-0.03em" }}>
                  {f.q}
                  <span className="rz-plus shrink-0 text-3xl font-black leading-none" style={{ color: "var(--rz-pink)" }} aria-hidden="true">+</span>
                </summary>
                <p className="max-w-[62ch] pb-5 font-medium" style={{ color: "var(--rz-ink-soft)" }}>{f.a}</p>
              </details>
            ))}
            <div style={{ borderTop: "2.5px solid var(--rz-ink)" }} />
          </div>
        </section>

        {/* ---------- Close ---------- */}
        <section className="rz-field-pink rz-halftone" style={{ borderTop: "2.5px solid var(--rz-ink)" }}>
          <div className="rz-rv relative mx-auto max-w-5xl px-5 py-20 text-center sm:px-8 lg:py-28">
            <h2 className="rz-display text-[clamp(2rem,5vw,3.8rem)]">Print your store <Over>today.</Over></h2>
            <p className="mx-auto mt-4 max-w-[48ch] font-medium">Pick a name and start the 14-day trial. No card needed.</p>
            <div className="mx-auto mt-8 flex max-w-xl justify-center text-left">
              <SubdomainAvailabilityChecker platformDomain="bcom.si" variant="riso" />
            </div>
          </div>
        </section>
      </main>

      <footer style={{ background: "var(--rz-ink)", color: "var(--rz-paper)" }}>
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-5 py-12 sm:px-8 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Mark />
            <p className="max-w-xs text-sm" style={{ color: "#cfcbe0" }}>Online stores for Indian D2C brands, with cash on delivery and GST built in.</p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 font-semibold" aria-label="Footer">
            {[["What works today", "#live"], ["Themes", "#themes"], ["Pricing", "#pricing"], ["FAQ", "#faq"]].map(([label, href]) => (
              <a key={href} href={href} style={{ color: "var(--rz-paper)" }}>{label}</a>
            ))}
            <a href="https://admin.bcom.si" style={{ color: "var(--rz-paper)" }}>Log in</a>
            <Link href="/signup" style={{ color: "var(--rz-yellow)" }}>Start free trial</Link>
          </nav>
        </div>
        <p className="mx-auto max-w-7xl px-5 pb-10 text-xs sm:px-8" style={{ color: "#cfcbe0" }}>© {new Date().getFullYear()} bcom.si. Example data on this page is made up for illustration.</p>
      </footer>
    </div>
  );
}

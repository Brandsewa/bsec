"use client";

/*
 * bcom.si landing, design 4: "Neubrutalist Grid".
 * THESIS: the whole page is one rigid grid of heavy-outlined blocks in flat solids, every control a physical click;
 *   refuses the stock SaaS arrangement of soft cards, gradients and a centred hero.
 * OWN-WORLD: off-white graph paper, 3px black outlines, one 6px hard shadow, marigold / hot pink / electric blue / lime
 *   as solid fields, Epilogue 900 display, Work Sans body; buttons travel into their shadow on press.
 * STORY: a D2C founder sees a live-looking dashboard, reads exactly what is live (and what is Coming soon), checks a
 *   store name and starts the 14-day trial.
 * FIRST VIEWPORT: left, a stacked headline with marker-highlighted words, one sentence, the outlined store-name field
 *   and pink button; right, a tiled dashboard (orders ticking, COD to collect, latest orders) popping in on the grid.
 * FORM: Neubrutalist Grid, challenger (competitive verdict) of the 2026-10-04 roll, built as the fourth design.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
 */

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { SubdomainAvailabilityChecker } from "./SubdomainAvailabilityChecker.tsx";
import { NeoBoard } from "./landing4/NeoBoard.tsx";
import { useRevealMotion } from "./landing/motion.ts";
import { COMING_SOON, FAQS, FALLBACK_PLANS, INCLUDED_IN_ALL, STEPS, THEMES, planBullets, type LandingPlan } from "./landing/content.ts";
import { nbBodyFont, nbDisplayFont } from "./landing4/fonts.ts";
import "./landing4/nb.css";

const inr = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
const PLAN_BG = ["nb-p", "nb-bl", "nb-l"];
const TICKER = ["Cash on delivery", "GST invoices", "Theme builder", "Returns and exchanges", "Pre-orders", "Segments", "Quotes", "Reviews"];

function Check() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="square">
      <path d="M4 13l5 5L20 6" />
    </svg>
  );
}

export function MarketingLandingNeo({ plans }: { plans?: LandingPlan[] | undefined }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useRevealMotion(rootRef, { item: ".nb-rv", armedClass: "nb-armed" });
  const [interval, setInterval_] = useState<"monthly" | "yearly">("monthly");
  const planList = useMemo(() => (plans && plans.length > 0 ? plans : FALLBACK_PLANS), [plans]);
  const cheapest = Math.min(...planList.map((p) => p.monthlyPaise));

  return (
    <div ref={rootRef} className={`nb ${nbDisplayFont.variable} ${nbBodyFont.variable}`} id="top">
      {/* ---------- Top bar ---------- */}
      <header className="sticky top-0 z-40 bg-[var(--nb-bg)]" style={{ borderBottom: "var(--nb-b) solid var(--nb-ink)" }}>
        <div className="mx-auto flex h-[4.25rem] max-w-7xl items-center justify-between px-5 sm:px-8">
          <a href="#top" className="flex items-center gap-2.5 no-underline" style={{ color: "var(--nb-ink)" }} aria-label="bcom.si home">
            <span className="nb-flat nb-p flex h-10 w-10 items-center justify-center text-xl font-black" style={{ boxShadow: "3px 3px 0 var(--nb-ink)", fontFamily: "var(--nb-display)" }} aria-hidden="true">b</span>
            <span className="nb-display text-[1.35rem]">bcom.si</span>
          </a>
          <nav className="hidden items-center gap-1.5 lg:flex" aria-label="Sections">
            {[["What works today", "#live"], ["Themes", "#themes"], ["How it works", "#steps"], ["Pricing", "#pricing"], ["FAQ", "#faq"]].map(([label, href]) => (
              <a key={href} href={href} className="px-3 py-2 text-[0.95rem] font-bold no-underline hover:bg-[var(--nb-yellow)]" style={{ color: "var(--nb-ink)" }}>{label}</a>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <a href="https://admin.bcom.si" className="hidden px-2 text-[0.95rem] font-bold sm:inline-block" style={{ color: "var(--nb-ink)" }}>Log in</a>
            <Link href="/signup" className="nb-btn nb-btn-sm">Start free trial</Link>
          </div>
        </div>
      </header>

      <main>
        {/* ---------- Hero ---------- */}
        <section className="mx-auto grid max-w-7xl gap-12 px-5 pb-20 pt-14 sm:px-8 lg:grid-cols-12 lg:items-center lg:gap-10 lg:pb-28 lg:pt-20">
          <div className="lg:col-span-7">
            <h1 className="nb-display text-[clamp(2.6rem,6.4vw,5.4rem)]">
              Open your Indian <span className="nb-hl">online store</span> <span className="nb-hl nb-hl-p">today.</span>
            </h1>
            <p className="mt-7 max-w-[54ch] text-[1.15rem] font-medium">
              A themed storefront, cash on delivery and GST invoices in one admin, made for Indian D2C brands. Choose a
              name and start your 14-day free trial.
            </p>
            <div className="mt-9">
              <SubdomainAvailabilityChecker platformDomain="bcom.si" variant="neo" />
              <p className="mt-3 text-[0.95rem] font-semibold">14 days free · no card needed · plans from {inr(cheapest)} a month + GST</p>
            </div>
          </div>
          <div className="flex justify-center lg:col-span-5 lg:justify-end">
            <NeoBoard />
          </div>
        </section>

        {/* ---------- Ticker ---------- */}
        <div className="nb-ticker overflow-hidden bg-[var(--nb-ink)] py-3" style={{ color: "var(--nb-yellow)" }} aria-label="What bcom.si does today">
          <div className="nb-ticker-track" aria-hidden="true">
            {[0, 1].map((rep) => (
              <ul key={rep} className="flex shrink-0 items-center">
                {TICKER.map((t) => (
                  <li key={`${rep}-${t}`} className="nb-display flex items-center gap-5 whitespace-nowrap pr-5 text-[1.2rem]" style={{ letterSpacing: "-0.02em" }}>
                    {t}<span style={{ color: "var(--nb-pink)" }}>■</span>
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>

        {/* ---------- What works today ---------- */}
        <section id="live" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
          <div className="nb-rv max-w-3xl">
            <h2 className="nb-h2">Everything on this grid <span className="nb-hl nb-hl-l">works today.</span></h2>
            <p className="mt-5 max-w-[60ch] text-[1.08rem] font-medium">
              No roadmap in disguise. These are the parts a merchant can use the day they sign up. What is still being
              built is marked Coming soon, below.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-12 gap-6">
            <article className="nb-box nb-cell nb-rv nb-p col-span-12 p-6 lg:col-span-7">
              <h3 className="nb-display text-[1.6rem]">Cash on delivery, done properly</h3>
              <p className="mt-3 max-w-[56ch] font-medium">
                Set a COD fee per store. Stock is held when the order is placed and released if it is cancelled; you
                confirm, ship and mark it delivered, and the cash collected is recorded.
              </p>
              <ol className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Order lifecycle">
                {["Placed", "Confirmed", "Shipped", "Delivered"].map((s, i) => (
                  <li key={s} className="nb-flat bg-white px-3 py-2.5">
                    <span className="nb-num block text-xs font-bold">Step {i + 1}</span>
                    <span className="font-black">{s}</span>
                  </li>
                ))}
              </ol>
            </article>

            <article className="nb-box nb-cell nb-rv nb-y col-span-12 p-6 lg:col-span-5">
              <h3 className="nb-display text-[1.6rem]">GST invoices</h3>
              <p className="mt-3 font-medium">CGST and SGST, or IGST, worked out from your state and your customer&apos;s, with the HSN on each line.</p>
              <dl className="nb-flat nb-num mt-5 space-y-1.5 bg-white p-4 text-sm font-semibold" aria-label="Example invoice lines">
                <div className="flex justify-between"><dt>Cotton kurta · HSN 6104</dt><dd className="font-black">₹1,000.00</dd></div>
                <div className="flex justify-between"><dt>CGST 9% + SGST 9% (same state)</dt><dd>₹180.00</dd></div>
                <div className="flex justify-between"><dt>or IGST 18% (other state)</dt><dd>₹180.00</dd></div>
              </dl>
              <p className="mt-2 text-sm font-semibold">Example only. Rates depend on your products.</p>
            </article>

            <article className="nb-box nb-cell nb-rv nb-bl col-span-12 p-6 lg:col-span-5">
              <h3 className="nb-display text-[1.6rem]">Change your theme without code</h3>
              <p className="mt-3 font-medium">
                Drag, drop and edit blocks: slider, product showcase, reviews, newsletter, cart. Set colours, fonts and
                heading sizes per device. There is no custom code to break.
              </p>
              <ul className="mt-5 grid grid-cols-2 gap-3 text-sm font-black" aria-label="Blocks you can place">
                {["Hero slider", "Product showcase", "Reviews", "Newsletter"].map((b) => (
                  <li key={b} className="nb-flat nb-y px-3 py-2" style={{ color: "var(--nb-ink)" }}>{b}</li>
                ))}
              </ul>
            </article>

            <article className="nb-box nb-cell nb-rv col-span-12 bg-white p-6 lg:col-span-7">
              <h3 className="nb-display text-[1.6rem]">The whole order, in one place</h3>
              <p className="mt-3 max-w-[60ch] font-medium">
                Returns and exchanges with photos, a Request a quote button for price-on-request products, pre-orders
                with a ship-on date, and a list of abandoned checkouts.
              </p>
              <ul className="mt-5 flex flex-wrap gap-3 text-sm font-black">
                {[["Returns and exchanges", "nb-p"], ["Request a quote", "nb-y"], ["Pre-orders", "nb-l"], ["Abandoned checkouts", "nb-y"], ["Reviews", "nb-p"], ["Discounts", "nb-l"]].map(([t, c]) => (
                  <li key={t} className={`nb-flat ${c} px-3 py-1.5`}>{t}</li>
                ))}
              </ul>
            </article>

            <article className="nb-box nb-cell nb-rv nb-l col-span-12 p-6 md:col-span-6">
              <h3 className="nb-display text-[1.6rem]">Know who is buying</h3>
              <p className="mt-3 font-medium">Customer profiles, notes, consent history and CSV import. Build segments from rules and see who falls in.</p>
              <div className="nb-flat mt-5 bg-white p-4 text-sm" aria-label="Example segment rule">
                <p className="font-black">Win-back <span className="font-semibold opacity-70">· example segment</span></p>
                <p className="mt-1 font-medium">Total spend over ₹5,000 and last order more than 60 days ago</p>
              </div>
            </article>

            <article className="nb-box nb-cell nb-rv nb-y col-span-12 p-6 md:col-span-6">
              <h3 className="nb-display text-[1.6rem]">Shipping rates you control</h3>
              <p className="mt-3 font-medium">Set zones, rates and a free-shipping threshold. The cart and the checkout charge the same total.</p>
              <div className="nb-flat mt-5 bg-white p-4" aria-label="Example free shipping progress">
                <div className="flex justify-between text-sm font-black"><span>Standard ₹70</span><span className="nb-num">Free above ₹1,200</span></div>
                <div className="nb-flat mt-3 h-4 bg-white"><div className="h-full nb-bl" style={{ width: "78%", borderRight: "var(--nb-b) solid var(--nb-ink)" }} /></div>
                <p className="mt-2 text-sm font-semibold">Example cart: ₹260 away from free shipping</p>
              </div>
            </article>
          </div>

          <div className="nb-rv mt-14">
            <h3 className="nb-display text-[1.6rem]">Coming soon</h3>
            <p className="mt-1 max-w-[60ch] font-medium">Not live yet. We will announce each one when it works, not before.</p>
            <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {COMING_SOON.map((c) => (
                <li key={c.name} className="p-4" style={{ border: "var(--nb-b) dashed var(--nb-ink)", background: "transparent" }}>
                  <p className="nb-display text-[1.05rem]">{c.name}</p>
                  <p className="text-sm font-medium">{c.note}</p>
                  <span className="nb-flat nb-y mt-3 inline-block px-2 py-0.5 text-xs font-black">Coming soon</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------- Themes ---------- */}
        <section id="themes" className="nb-bl" style={{ borderTop: "var(--nb-b) solid var(--nb-ink)", borderBottom: "var(--nb-b) solid var(--nb-ink)" }}>
          <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
            <div className="nb-rv max-w-3xl">
              <h2 className="nb-h2">Pick a theme.</h2>
              <p className="mt-5 max-w-[60ch] font-medium">
                Start from a theme made for your niche, then make it yours in the editor. These are illustrations of the
                starting layouts.
              </p>
            </div>
            <ul className="mt-12 grid gap-8 md:grid-cols-3">
              {THEMES.map((t) => (
                <li key={t.code} className="nb-rv">
                  <div className="nb-box nb-cell bg-white" style={{ color: "var(--nb-ink)" }}>
                    <div className="flex items-center gap-1.5 px-3 py-2" style={{ borderBottom: "var(--nb-b) solid var(--nb-ink)", background: "var(--nb-yellow)" }} aria-hidden="true">
                      {["var(--nb-pink)", "var(--nb-lime)", "#fff"].map((c) => <span key={c} className="nb-flat h-3 w-3" style={{ background: c, borderWidth: "2px" }} />)}
                      <span className="ml-2 text-[0.7rem] font-black">{t.code}.bcom.si</span>
                    </div>
                    <div className="p-3" style={{ background: t.ground, color: t.ink }}>
                      <div className="p-3.5" style={{ background: t.tile }}>
                        <p className="text-[0.7rem] font-bold uppercase tracking-wider" style={{ color: t.accent }}>New in</p>
                        <p className="nb-display mt-1 text-base leading-tight">{t.name}</p>
                        <span className="mt-2.5 inline-block px-2.5 py-1 text-[0.7rem] font-black" style={{ background: t.accent, color: t.ground }}>Shop now</span>
                      </div>
                      <div className="mt-2.5 grid grid-cols-3 gap-1.5" aria-hidden="true">
                        {[0, 1, 2].map((c) => <div key={c} className="aspect-[4/5]" style={{ background: t.tile }} />)}
                      </div>
                    </div>
                  </div>
                  <h3 className="nb-display mt-5 text-xl">{t.name}</h3>
                  <p className="text-sm font-semibold">{t.industry}</p>
                  <p className="mt-1 font-medium">{t.line}</p>
                  <Link href={`/signup?template=${t.code}`} className="nb-btn nb-btn-lime nb-btn-sm mt-4">Start with this theme</Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------- Steps ---------- */}
        <section id="steps" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
          <div className="nb-rv max-w-3xl"><h2 className="nb-h2">From a name to your <span className="nb-hl nb-hl-p">first order.</span></h2></div>
          <ol className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className={`nb-box nb-cell nb-rv ${["nb-y", "nb-p", "nb-l", "nb-bl"][i]} p-5`}>
                <span className="nb-flat nb-num flex h-12 w-12 items-center justify-center bg-white text-2xl font-black" style={{ color: "var(--nb-ink)", fontFamily: "var(--nb-display)" }} aria-hidden="true">{i + 1}</span>
                <h3 className="nb-display mt-4 text-xl">{s.title}</h3>
                <p className="mt-2 font-medium">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ---------- Pricing ---------- */}
        <section id="pricing" className="nb-y" style={{ borderTop: "var(--nb-b) solid var(--nb-ink)", borderBottom: "var(--nb-b) solid var(--nb-ink)" }}>
          <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
            <div className="nb-rv flex flex-col justify-between gap-6 md:flex-row md:items-end">
              <div className="max-w-2xl">
                <h2 className="nb-h2">Plans you can read in one go.</h2>
                <p className="mt-5 font-medium">Prices in rupees, plus GST. Every plan starts with a 14-day free trial.</p>
              </div>
              <div className="nb-flat inline-flex bg-white" role="group" aria-label="Billing period">
                {(["monthly", "yearly"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setInterval_(v)}
                    aria-pressed={interval === v}
                    className="min-h-[2.75rem] px-5 font-black"
                    style={interval === v ? { background: "var(--nb-ink)", color: "var(--nb-yellow)" } : { color: "var(--nb-ink)" }}
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
                  <li key={p.code} className="nb-box nb-cell nb-rv flex flex-col bg-white">
                    <div className={`${PLAN_BG[i % 3]} px-6 py-4`} style={{ borderBottom: "var(--nb-b) solid var(--nb-ink)" }}>
                      <h3 className="nb-display text-2xl">{p.name}</h3>
                    </div>
                    <div className="flex flex-1 flex-col p-6">
                      <p className="nb-num flex items-end gap-2">
                        <span className="nb-display text-5xl">{inr(perMonth)}</span>
                        <span className="pb-1.5 font-semibold">a month</span>
                      </p>
                      <p className="nb-num mt-1 min-h-[1.5rem] text-sm font-semibold">
                        {interval === "yearly" ? `Billed ${inr(p.yearlyPaise)} a year${saving > 0 ? ` · you save ${inr(saving)}` : ""}` : "Billed monthly"}
                      </p>
                      <ul className="mt-6 flex-1 space-y-2.5">
                        {planBullets(p.limits).map((b) => (
                          <li key={b} className="flex items-start gap-2.5 font-semibold"><span className="mt-0.5 shrink-0"><Check /></span>{b}</li>
                        ))}
                      </ul>
                      <Link href={`/signup?plan=${p.code}&interval=${interval}`} className="nb-btn nb-btn-pink mt-8 w-full">Start free trial</Link>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="nb-rv mt-12">
              <p className="nb-display text-xl">Every plan includes</p>
              <ul className="mt-3 flex flex-wrap gap-3">
                {INCLUDED_IN_ALL.map((x) => (
                  <li key={x} className="nb-flat bg-white px-4 py-2 font-black">{x}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ---------- FAQ ---------- */}
        <section id="faq" className="mx-auto max-w-4xl px-5 py-20 sm:px-8 lg:py-28">
          <div className="nb-rv"><h2 className="nb-h2">Straight <span className="nb-hl">answers.</span></h2></div>
          <div className="mt-10 space-y-4">
            {FAQS.map((f) => (
              <details key={f.q} className="nb-faq nb-box nb-rv">
                <summary className="flex min-h-[3.75rem] items-center justify-between gap-4 px-5 py-3">
                  <span className="nb-display text-[1.1rem]" style={{ letterSpacing: "-0.02em" }}>{f.q}</span>
                  <span className="nb-sign nb-flat relative flex h-9 w-9 shrink-0 items-center justify-center bg-white" aria-hidden="true">
                    <span className="absolute h-[3px] w-4 bg-[var(--nb-ink)]" />
                    <span className="nb-sign-v absolute h-4 w-[3px] bg-[var(--nb-ink)]" />
                  </span>
                </summary>
                <p className="max-w-[62ch] px-5 pb-5 font-medium" style={{ borderTop: "var(--nb-b) solid var(--nb-ink)", paddingTop: "1rem" }}>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ---------- Close ---------- */}
        <section className="nb-p" style={{ borderTop: "var(--nb-b) solid var(--nb-ink)" }}>
          <div className="nb-rv mx-auto max-w-5xl px-5 py-20 text-center sm:px-8 lg:py-28">
            <h2 className="nb-display text-[clamp(2.1rem,5.4vw,4rem)]">Open your store <span className="nb-hl">today.</span></h2>
            <p className="mx-auto mt-4 max-w-[48ch] font-semibold">Pick a name and start the 14-day trial. No card needed.</p>
            <div className="mx-auto mt-8 flex max-w-xl justify-center text-left">
              <SubdomainAvailabilityChecker platformDomain="bcom.si" variant="neo" />
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-[var(--nb-ink)]" style={{ color: "var(--nb-bg)" }}>
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-5 py-12 sm:px-8 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <span className="nb-p flex h-10 w-10 items-center justify-center text-xl font-black" style={{ color: "var(--nb-ink)", fontFamily: "var(--nb-display)" }} aria-hidden="true">b</span>
            <p className="max-w-xs text-sm" style={{ color: "#e7e2cf" }}>Online stores for Indian D2C brands, with cash on delivery and GST built in.</p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 font-bold" aria-label="Footer">
            {[["What works today", "#live"], ["Themes", "#themes"], ["Pricing", "#pricing"], ["FAQ", "#faq"]].map(([label, href]) => (
              <a key={href} href={href} style={{ color: "var(--nb-bg)" }}>{label}</a>
            ))}
            <a href="https://admin.bcom.si" style={{ color: "var(--nb-bg)" }}>Log in</a>
            <Link href="/signup" style={{ color: "var(--nb-yellow)" }}>Start free trial</Link>
          </nav>
        </div>
        <p className="mx-auto max-w-7xl px-5 pb-10 text-xs sm:px-8" style={{ color: "#e7e2cf" }}>© {new Date().getFullYear()} bcom.si. Example data on this page is made up for illustration.</p>
      </footer>
    </div>
  );
}

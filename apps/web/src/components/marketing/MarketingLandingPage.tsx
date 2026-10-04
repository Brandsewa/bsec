"use client";

/*
 * bcom.si landing page: "Block-Print Bazaar".
 * THESIS: a store is a bolt of cloth you print yourself; refuses the stock SaaS arrangement of centred hero, logo
 *   strip, three icon cards and a pricing table on white.
 * OWN-WORLD: indigo-dyed cotton ground, undyed cotton panels that carry the product UI, madder-red carved block for
 *   the one primary action, turmeric stitch thread, jaal/booti block-repeat tiles, Bricolage Grotesque display.
 * STORY: a D2C founder sees the real admin working, learns exactly what is live (and what is Coming soon), checks a
 *   store name and starts the 14-day trial.
 * FIRST VIEWPORT: left, a stamped four-line headline, one sentence, the store-name field with the madder button;
 *   right, the sample admin printed on cloth with a wooden block pressing a rosette behind it.
 * FORM: Block-Print Bazaar, assigned by the roll (seed 8b58d96c, index 4 of 7), raised by the continuous thread
 *   (neon circuit) and damped-spring numbers (night instruments).
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
 */

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { SubdomainAvailabilityChecker } from "./SubdomainAvailabilityChecker.tsx";
import { SampleAdmin } from "./landing/SampleAdmin.tsx";
import { useRevealMotion } from "./landing/motion.ts";
import {
  BrandMark,
  CarvedBlock,
  IconArrow,
  IconBox,
  IconCash,
  IconCheck,
  IconClock,
  IconLayout,
  IconPlus,
  IconReceipt,
  IconTruck,
  IconUsers,
  Needle,
  Rosette,
} from "./landing/Motifs.tsx";
import {
  COMING_SOON,
  FAQS,
  FALLBACK_PLANS,
  INCLUDED_IN_ALL,
  STEPS,
  THEMES,
  planBullets,
  type LandingPlan,
} from "./landing/content.ts";
import { bzBodyFont, bzDisplayFont } from "./landing/fonts.ts";
import "./landing/landing.css";

const inr = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

function Words({ text, accentFrom }: { text: string; accentFrom?: number }) {
  return (
    <>
      {text.split(" ").map((w, i) => (
        <span
          key={`${w}-${i}`}
          className={`bz-word${accentFrom !== undefined && i >= accentFrom ? " bz-accent" : ""}`}
          data-text={accentFrom !== undefined && i >= accentFrom ? w : undefined}
          style={{ ["--i" as string]: i } as React.CSSProperties}
        >
          {w}
          {i < text.split(" ").length - 1 ? " " : ""}
        </span>
      ))}
    </>
  );
}

export function MarketingLandingPage({ plans }: { plans?: LandingPlan[] | undefined }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useRevealMotion(rootRef);
  const [interval, setInterval_] = useState<"monthly" | "yearly">("monthly");

  const planList = useMemo(() => (plans && plans.length > 0 ? plans : FALLBACK_PLANS), [plans]);
  const cheapest = Math.min(...planList.map((p) => p.monthlyPaise));

  return (
    <div ref={rootRef} className={`bz ${bzDisplayFont.variable} ${bzBodyFont.variable}`} id="top">
      {/* The running stitch: a thread that draws itself through the whole cloth as you scroll. */}
      <div className="bz-thread" aria-hidden="true">
        <div className="bz-thread-ghost" />
        <div className="bz-thread-line" />
      </div>

      {/* ---------- Nav ---------- */}
      <header className="sticky top-0 z-40" style={{ background: "rgb(13 19 64 / 0.92)", backdropFilter: "blur(10px)" }}>
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
          <a href="#top" className="flex items-center gap-2.5 no-underline" aria-label="bcom.si home">
            <BrandMark size={34} />
            <span className="text-[1.35rem] font-bold tracking-tight" style={{ fontFamily: "var(--bz-display)", color: "#f1e9d6" }}>
              bcom<span style={{ color: "var(--bz-turmeric)" }}>.si</span>
            </span>
          </a>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Sections">
            {[
              ["What works today", "#live"],
              ["Themes", "#themes"],
              ["How it works", "#steps"],
              ["Pricing", "#pricing"],
              ["FAQ", "#faq"],
            ].map(([label, href]) => (
              <a key={href} href={href} className="bz-btn-quiet inline-flex text-[0.95rem]">
                {label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-1.5">
            <a href="https://admin.bcom.si" className="bz-btn-quiet hidden text-[0.95rem] sm:inline-flex">
              Log in
            </a>
            <Link href="/signup" className="bz-btn bz-btn-sm">
              Start free trial
            </Link>
          </div>
        </div>
        <div className="bz-border-zigzag" aria-hidden="true" />
      </header>

      <main>
        {/* ---------- Hero ---------- */}
        <section className="relative mx-auto grid max-w-7xl gap-12 px-5 pb-20 pt-14 sm:px-8 lg:grid-cols-12 lg:gap-8 lg:pb-28 lg:pt-20">
          <div className="lg:col-span-7">
            <h1 className="bz-display text-[clamp(2.7rem,7.2vw,5.6rem)]">
              <Words text="Open your Indian online store today." accentFrom={5} />
            </h1>
            <p className="bz-lede mt-7 text-[1.15rem]">
              A themed storefront, cash on delivery and GST invoices in one admin, made for Indian D2C brands. Choose a
              name and start your 14-day free trial.
            </p>
            <div className="mt-9 max-w-xl">
              <SubdomainAvailabilityChecker platformDomain="bcom.si" />
              <p className="bz-muted mt-4 text-[0.9rem]">
                14 days free · no card needed · plans from {inr(cheapest)} a month + GST
              </p>
            </div>
          </div>

          <div className="relative lg:col-span-5">
            {/* The block presses once, then lifts away and leaves its imprint on the cloth. */}
            <div className="relative mx-auto w-full max-w-[34rem]">
              <Rosette
                className="bz-imprint pointer-events-none absolute -right-4 -top-4 z-0 h-[15rem] w-[15rem] sm:-right-8 sm:h-[18rem] sm:w-[18rem]"
                style={{ color: "var(--bz-madder)", ["--rosette-eye" as string]: "#141c55", mixBlendMode: "screen", opacity: 0.95 } as React.CSSProperties}
              />
              <CarvedBlock
                className="bz-stamp-block pointer-events-none absolute right-2 -top-2 z-20 h-[9.5rem] w-[8rem] sm:right-0 sm:top-0 sm:h-[11.5rem] sm:w-[9.7rem]"
              />
              <div className="relative z-10 pt-20 sm:pt-24" style={{ transform: "rotate(-1.1deg)" }}>
                <SampleAdmin />
              </div>
            </div>
          </div>
        </section>

        {/* ---------- What works today ---------- */}
        <section id="live" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
          <div className="bz-rv max-w-3xl" data-rv="print">
            <h2 className="bz-h2">Everything on this cloth works today.</h2>
            <p className="bz-lede mt-5">
              No roadmap in disguise. These are the parts a merchant can use the day they sign up. What is still being
              built is marked Coming soon, further down.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-12 gap-5">
            {/* Cash on delivery */}
            <article className="bz-panel bz-panel-indigo bz-rv col-span-12 lg:col-span-7" data-rv="print">
              <div className="flex items-center gap-3">
                <IconCash width={28} height={28} style={{ color: "var(--bz-turmeric)" }} />
                <h3 className="text-2xl font-bold" style={{ fontFamily: "var(--bz-display)" }}>Cash on delivery, done properly</h3>
              </div>
              <p className="bz-lede mt-3 max-w-[58ch]">
                Set a COD fee per store. Stock is held when the order is placed and released if it is cancelled; you
                confirm, ship and mark it delivered, and the cash collected is recorded.
              </p>
              <ol className="mt-6 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4" aria-label="Order lifecycle">
                {["Placed", "Confirmed", "Shipped", "Delivered"].map((s, i) => (
                  <li key={s} className="rounded-xl px-3 py-2.5" style={{ background: "var(--bz-indigo-deep)" }}>
                    <span className="bz-num block text-xs" style={{ color: "var(--bz-turmeric)" }}>Step {i + 1}</span>
                    <span className="font-semibold">{s}</span>
                  </li>
                ))}
              </ol>
            </article>

            {/* GST */}
            <article className="bz-panel bz-panel-cotton bz-rv col-span-12 lg:col-span-5" data-rv="rise">
              <div className="flex items-center gap-3">
                <IconReceipt width={28} height={28} style={{ color: "var(--bz-madder)" }} />
                <h3 className="text-2xl font-bold" style={{ fontFamily: "var(--bz-display)" }}>GST invoices</h3>
              </div>
              <p className="bz-muted mt-3">
                CGST and SGST, or IGST, worked out from your state and your customer&apos;s, with the HSN on each line.
              </p>
              <dl className="bz-num mt-5 space-y-1.5 rounded-xl p-4 text-sm" style={{ background: "rgb(20 28 85 / 0.07)" }} aria-label="Example invoice lines">
                <div className="flex justify-between"><dt>Cotton kurta · HSN 6104</dt><dd>₹1,000.00</dd></div>
                <div className="flex justify-between bz-muted"><dt>CGST 9% + SGST 9% (same state)</dt><dd>₹180.00</dd></div>
                <div className="flex justify-between bz-muted"><dt>or IGST 18% (other state)</dt><dd>₹180.00</dd></div>
              </dl>
              <p className="bz-muted mt-3 text-xs">Example only. Rates and amounts depend on your products.</p>
            </article>

            {/* Theme builder */}
            <article className="bz-panel bz-panel-madder bz-rv col-span-12 lg:col-span-5" data-rv="rise">
              <div className="flex items-center gap-3">
                <IconLayout width={28} height={28} />
                <h3 className="text-2xl font-bold" style={{ fontFamily: "var(--bz-display)" }}>Change your theme without code</h3>
              </div>
              <p className="mt-3" style={{ color: "#f6dcd2" }}>
                Drag, drop and edit blocks: slider, product showcase, reviews, newsletter, cart. Set colours, fonts and
                heading sizes per device. There is no custom code to break.
              </p>
              <ul className="mt-5 grid grid-cols-2 gap-2 text-sm font-semibold" aria-label="Blocks you can place">
                {["Hero slider", "Product showcase", "Reviews", "Newsletter"].map((b) => (
                  <li key={b} className="rounded-lg px-3 py-2" style={{ background: "rgb(20 28 85 / 0.55)" }}>{b}</li>
                ))}
              </ul>
            </article>

            {/* Orders */}
            <article className="bz-panel bz-panel-deep bz-rv col-span-12 lg:col-span-7" data-rv="print">
              <div className="flex items-center gap-3">
                <IconBox width={28} height={28} style={{ color: "var(--bz-turmeric)" }} />
                <h3 className="text-2xl font-bold" style={{ fontFamily: "var(--bz-display)" }}>The whole order, in one place</h3>
              </div>
              <p className="bz-lede mt-3 max-w-[60ch]">
                Returns and exchanges with photos, a Request a quote button for price-on-request products, pre-orders
                with a ship-on date, and a list of abandoned checkouts.
              </p>
              <ul className="mt-5 flex flex-wrap gap-2 text-sm font-semibold">
                {["Returns and exchanges", "Request a quote", "Pre-orders", "Abandoned checkouts", "Reviews", "Discounts"].map((t) => (
                  <li key={t} className="rounded-full px-3.5 py-1.5" style={{ background: "var(--bz-indigo-lift)" }}>{t}</li>
                ))}
              </ul>
            </article>

            {/* Customers */}
            <article className="bz-panel bz-panel-cotton bz-rv col-span-12 md:col-span-6" data-rv="rise">
              <div className="flex items-center gap-3">
                <IconUsers width={28} height={28} style={{ color: "var(--bz-madder)" }} />
                <h3 className="text-2xl font-bold" style={{ fontFamily: "var(--bz-display)" }}>Know who is buying</h3>
              </div>
              <p className="bz-muted mt-3">
                Customer profiles, notes, consent history and CSV import. Build segments from rules and see who falls in.
              </p>
              <div className="mt-5 rounded-xl p-4 text-sm" style={{ background: "rgb(20 28 85 / 0.07)" }} aria-label="Example segment rule">
                <p className="font-semibold">Win-back <span className="bz-muted font-normal">· example segment</span></p>
                <p className="bz-muted mt-1">Total spend over ₹5,000 and last order more than 60 days ago</p>
              </div>
            </article>

            {/* Shipping */}
            <article className="bz-panel bz-panel-indigo bz-rv col-span-12 md:col-span-6" data-rv="rise">
              <div className="flex items-center gap-3">
                <IconTruck width={28} height={28} style={{ color: "var(--bz-turmeric)" }} />
                <h3 className="text-2xl font-bold" style={{ fontFamily: "var(--bz-display)" }}>Shipping rates you control</h3>
              </div>
              <p className="bz-lede mt-3">
                Set zones, rates and a free-shipping threshold. The cart and the checkout charge the same total.
              </p>
              <div className="mt-5 rounded-xl p-4" style={{ background: "var(--bz-indigo-deep)" }} aria-label="Example free shipping progress">
                <div className="flex justify-between text-sm"><span>Standard ₹70</span><span className="bz-num" style={{ color: "var(--bz-turmeric)" }}>Free above ₹1,200</span></div>
                <div className="mt-3 h-2 overflow-hidden rounded-full" style={{ background: "rgb(241 233 214 / 0.14)" }}>
                  <div className="h-full rounded-full" style={{ width: "78%", background: "var(--bz-turmeric)" }} />
                </div>
                <p className="bz-muted mt-2 text-xs">Example cart: ₹260 away from free shipping</p>
              </div>
            </article>
          </div>

          {/* Honest strip: not live yet */}
          <div className="bz-rv mt-12" data-rv="unroll">
            <h3 className="text-xl font-bold" style={{ fontFamily: "var(--bz-display)" }}>Coming soon</h3>
            <p className="bz-muted mt-1 max-w-[60ch] text-[0.95rem]">Not live yet. We will announce each one when it works, not before.</p>
            <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {COMING_SOON.map((c) => (
                <li key={c.name} className="bz-soon">
                  <p className="flex items-center gap-2 text-[0.95rem] font-semibold">
                    <IconClock width={18} height={18} style={{ color: "var(--bz-turmeric)" }} />
                    {c.name}
                  </p>
                  <p className="bz-muted mt-1 text-sm">{c.note}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------- Themes ---------- */}
        <section id="themes" className="bz-cotton" style={{ backgroundImage: "var(--bz-tile-jaal-ink)" }}>
          <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
            <div className="bz-rv max-w-3xl" data-rv="print">
              <h2 className="bz-h2">Choose your block.</h2>
              <p className="bz-muted mt-5 max-w-[60ch]">
                Start from a theme made for your niche, then make it yours in the editor. These are illustrations of
                the starting layouts.
              </p>
            </div>
            <ul className="mt-12 grid gap-8 md:grid-cols-3">
              {THEMES.map((t, i) => (
                <li key={t.code} className="bz-rv" data-rv="rise" style={{ transitionDelay: `${i * 90}ms` }}>
                  <div className="bz-swatch rounded-2xl p-4" style={{ background: t.ground, color: t.ink }}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold" style={{ fontFamily: "var(--bz-display)" }}>Your store</span>
                      <span className="flex gap-1.5" aria-hidden="true">
                        {[0, 1, 2].map((d) => <span key={d} className="h-1.5 w-5 rounded-full" style={{ background: t.accent, opacity: 0.35 + d * 0.25 }} />)}
                      </span>
                    </div>
                    <div className="mt-4 rounded-xl p-5" style={{ background: t.tile }}>
                      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: t.accent }}>New in</p>
                      <p className="mt-1 text-xl font-bold leading-tight" style={{ fontFamily: "var(--bz-display)" }}>{t.name}</p>
                      <span className="mt-3 inline-block rounded-md px-3 py-1.5 text-xs font-bold" style={{ background: t.accent, color: t.ground }}>Shop now</span>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2" aria-hidden="true">
                      {[0, 1, 2].map((c) => (
                        <div key={c}>
                          <div className="aspect-[4/5] rounded-lg" style={{ background: t.tile }} />
                          <div className="mt-1.5 h-1.5 w-3/4 rounded-full" style={{ background: t.ink, opacity: 0.5 }} />
                          <div className="mt-1 h-1.5 w-1/2 rounded-full" style={{ background: t.accent }} />
                        </div>
                      ))}
                    </div>
                  </div>
                  <h3 className="mt-5 text-xl font-bold" style={{ fontFamily: "var(--bz-display)" }}>{t.name}</h3>
                  <p className="bz-muted text-sm">{t.industry}</p>
                  <p className="mt-1">{t.line}</p>
                  <Link href={`/signup?template=${t.code}`} className="mt-3 inline-flex items-center gap-1.5 font-semibold" style={{ color: "var(--bz-madder)" }}>
                    Start with this theme <IconArrow width={18} height={18} />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------- How it works ---------- */}
        <section id="steps" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
          <div className="bz-rv max-w-3xl" data-rv="print">
            <h2 className="bz-h2">From a name to your first order.</h2>
          </div>
          <ol className="mt-12 grid gap-x-10 gap-y-10 md:grid-cols-2">
            {STEPS.map((s, i) => (
              <li key={s.title} className="bz-rv flex gap-5" data-rv="rise" style={{ transitionDelay: `${i * 80}ms` }}>
                <span
                  className="bz-num flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-2xl font-bold"
                  style={{ background: "var(--bz-turmeric)", color: "var(--bz-indigo-deep)", fontFamily: "var(--bz-display)" }}
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-xl font-bold" style={{ fontFamily: "var(--bz-display)" }}>{s.title}</h3>
                  <p className="bz-lede mt-1.5">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* ---------- Pricing ---------- */}
        <section id="pricing" style={{ background: "var(--bz-indigo-deep)" }}>
          <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
            <div className="bz-rv flex flex-col justify-between gap-6 md:flex-row md:items-end" data-rv="print">
              <div className="max-w-2xl">
                <h2 className="bz-h2">Plans you can read in one go.</h2>
                <p className="bz-lede mt-5">Prices in rupees, plus GST. Every plan starts with a 14-day free trial.</p>
              </div>
              <div className="inline-flex rounded-xl p-1" role="group" aria-label="Billing period" style={{ background: "var(--bz-indigo)" }}>
                {(["monthly", "yearly"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setInterval_(v)}
                    aria-pressed={interval === v}
                    className="min-h-[2.5rem] rounded-lg px-4 text-[0.95rem] font-semibold transition-colors"
                    style={interval === v ? { background: "var(--bz-cotton)", color: "var(--bz-indigo-deep)" } : { color: "var(--bz-cotton-dim)" }}
                  >
                    {v === "monthly" ? "Monthly" : "Yearly"}
                  </button>
                ))}
              </div>
            </div>

            <ul className="mt-12 grid gap-6 lg:grid-cols-3">
              {planList.map((p, i) => {
                const perMonth = interval === "monthly" ? p.monthlyPaise : p.yearlyPaise / 12;
                const saving = p.monthlyPaise * 12 - p.yearlyPaise;
                return (
                  <li key={p.code} className="bz-panel bz-panel-cotton bz-rv flex flex-col" data-rv="rise" style={{ transitionDelay: `${i * 90}ms` }}>
                    <h3 className="text-2xl font-bold" style={{ fontFamily: "var(--bz-display)" }}>{p.name}</h3>
                    <p className="bz-num mt-4 flex items-end gap-1.5">
                      <span className="text-5xl font-bold tracking-tight" style={{ fontFamily: "var(--bz-display)" }}>{inr(perMonth)}</span>
                      <span className="bz-muted pb-1.5">a month</span>
                    </p>
                    <p className="bz-muted bz-num mt-1 min-h-[1.5rem] text-sm">
                      {interval === "yearly" ? `Billed ${inr(p.yearlyPaise)} a year${saving > 0 ? ` · you save ${inr(saving)}` : ""}` : "Billed monthly"}
                    </p>
                    <ul className="mt-6 flex-1 space-y-2.5">
                      {planBullets(p.limits).map((b) => (
                        <li key={b} className="flex items-start gap-2.5 text-[0.98rem]">
                          <IconCheck width={20} height={20} className="mt-0.5 shrink-0" style={{ color: "var(--bz-madder)" }} />
                          {b}
                        </li>
                      ))}
                    </ul>
                    <Link href={`/signup?plan=${p.code}&interval=${interval}`} className="bz-btn mt-8 w-full">
                      Start free trial
                    </Link>
                  </li>
                );
              })}
            </ul>

            <div className="bz-rv mt-10" data-rv="unroll">
              <p className="font-semibold">Every plan includes</p>
              <ul className="mt-3 flex flex-wrap gap-2.5">
                {INCLUDED_IN_ALL.map((x) => (
                  <li key={x} className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-[0.95rem]" style={{ background: "var(--bz-indigo-lift)" }}>
                    <IconCheck width={18} height={18} style={{ color: "var(--bz-turmeric)" }} />
                    {x}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ---------- FAQ ---------- */}
        <section id="faq" className="mx-auto max-w-4xl px-5 py-20 sm:px-8 lg:py-28">
          <div className="bz-rv" data-rv="print">
            <h2 className="bz-h2">Straight answers.</h2>
          </div>
          <div className="mt-10 divide-y" style={{ borderColor: "rgb(241 233 214 / 0.18)" }}>
            {FAQS.map((f) => (
              <details key={f.q} className="bz-faq bz-rv py-1" data-rv="rise" style={{ borderColor: "rgb(241 233 214 / 0.18)" }}>
                <summary className="flex min-h-[3.5rem] items-center justify-between gap-4 py-3 text-lg font-semibold" style={{ fontFamily: "var(--bz-display)" }}>
                  {f.q}
                  <IconPlus width={24} height={24} className="bz-plus shrink-0" style={{ color: "var(--bz-turmeric)" }} />
                </summary>
                <p className="bz-lede pb-5">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ---------- Close ---------- */}
        <section className="px-5 pb-20 sm:px-8 lg:pb-28">
          <div className="bz-cotton bz-rv relative mx-auto max-w-6xl overflow-hidden rounded-3xl px-6 py-14 sm:px-12 sm:py-20" data-rv="print" style={{ backgroundImage: "var(--bz-tile-jaal-ink)" }}>
            <Rosette
              className="pointer-events-none absolute -right-16 -top-16 h-72 w-72"
              style={{ color: "var(--bz-madder)", ["--rosette-eye" as string]: "#f1e9d6", opacity: 0.9 } as React.CSSProperties}
            />
            <h2 className="bz-h2 relative max-w-2xl">Press your store onto the cloth.</h2>
            <p className="bz-muted relative mt-4 max-w-[52ch]">Pick a name and start the 14-day trial. No card needed.</p>
            <div className="relative mt-8 max-w-xl">
              <SubdomainAvailabilityChecker platformDomain="bcom.si" />
            </div>
          </div>
        </section>
      </main>

      {/* ---------- Footer ---------- */}
      <footer style={{ background: "var(--bz-indigo-deep)" }}>
        <div className="bz-border-zigzag" aria-hidden="true" />
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-5 py-12 sm:px-8 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <BrandMark size={32} />
            <p className="max-w-xs text-sm" style={{ color: "var(--bz-cotton-dim)" }}>
              Online stores for Indian D2C brands, with cash on delivery and GST built in.
            </p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-[0.95rem]" aria-label="Footer">
            {[
              ["What works today", "#live"],
              ["Themes", "#themes"],
              ["Pricing", "#pricing"],
              ["FAQ", "#faq"],
            ].map(([label, href]) => (
              <a key={href} href={href} style={{ color: "var(--bz-cotton)" }}>{label}</a>
            ))}
            <a href="https://admin.bcom.si" style={{ color: "var(--bz-cotton)" }}>Log in</a>
            <Link href="/signup" style={{ color: "var(--bz-turmeric)" }}>Start free trial</Link>
          </nav>
        </div>
        <p className="mx-auto max-w-7xl px-5 pb-10 text-xs sm:px-8" style={{ color: "var(--bz-cotton-dim)" }}>
          © {new Date().getFullYear()} bcom.si. Example data on this page is made up for illustration.
        </p>
      </footer>

      {/* The needle sits at the foot of the page where the thread ends. */}
      <Needle className="pointer-events-none absolute bottom-6 right-6 hidden h-10 w-5 rotate-12 opacity-80 md:block" />
    </div>
  );
}

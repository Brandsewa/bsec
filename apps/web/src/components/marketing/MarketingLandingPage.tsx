"use client";

/*
 * bcom.si landing: "Beam".
 * THESIS: one shaft of light falls from the top of the page onto the lit edge of the product window; the product is
 *   the hero. Refuses the stock SaaS arrangement of a centred headline over a flat gradient with a floating mockup.
 * OWN-WORLD: near-black ground, a vertical beam with a bloom where it lands, slow violet smoke, a dot grid that only
 *   exists in the light, light motes rising from the foot, a warm-glow pill, Geist throughout.
 * STORY: a D2C founder sees a real-looking order board under the light, learns exactly what is live (and what is
 *   Coming soon), checks a store name and starts the 14-day trial.
 * FIRST VIEWPORT: left, a left-aligned headline, one sentence, the store-name field with the warm pill; the beam falls
 *   at 57% of the width onto the order-board window rising from the bottom edge.
 * FORM: Beam, chosen by the owner on 2026-10-05 from six explored designs, in the style of modern dark developer-tool
 *   heroes (original build, no third-party assets, copy or code). The other five live in git history on
 *   design/marketing-landing (commits before the cleanup).
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
 */

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { SubdomainAvailabilityChecker } from "./SubdomainAvailabilityChecker.tsx";
import { AppWindow } from "./beam/AppWindow.tsx";
import { Dust } from "./beam/Dust.tsx";
import { Founders } from "./beam/Founders.tsx";
import { Smoke } from "./beam/Smoke.tsx";
import { useRevealMotion } from "./landing/motion.ts";
import { COMING_SOON, FAQS, FALLBACK_PLANS, INCLUDED_IN_ALL, STEPS, THEMES, planBullets, type LandingPlan } from "./landing/content.ts";
import { bmFont } from "./beam/fonts.ts";
import "./beam/beam.css";

const inr = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
const STRIP = ["Cash on delivery", "GST invoices", "Theme builder", "Orders", "Returns", "Customers"];

function Arrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12h15M13 6l6 6-6 6" />
    </svg>
  );
}

export function MarketingLandingPage({ plans }: { plans?: LandingPlan[] | undefined }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useRevealMotion(rootRef, { item: ".bm-rv", armedClass: "bm-armed" });
  const [interval, setInterval_] = useState<"monthly" | "yearly">("monthly");
  const planList = useMemo(() => (plans && plans.length > 0 ? plans : FALLBACK_PLANS), [plans]);
  const cheapest = Math.min(...planList.map((p) => p.monthlyPaise));

  return (
    <div ref={rootRef} className={`bm ${bmFont.variable}`} id="top">
      {/* ---------- Hero ---------- */}
      <section className="bm-hero" style={{ ["--bm-foot" as string]: "var(--bm-window-h)" } as React.CSSProperties}>
        <style>{`.bm-hero{--bm-window-h:24rem}@media(min-width:640px){.bm-hero{--bm-window-h:34rem}}`}</style>

        {/* light layers (they fall away as the page scrolls) */}
        <div className="bm-light absolute inset-0" aria-hidden="true">
          <div className="bm-smoke bm-smoke-a" />
          <div className="bm-smoke bm-smoke-b" />
          <div className="bm-smoke bm-smoke-c" />
          <Smoke beamX={0.57} />
          <div className="bm-grid" />
          <div className="bm-bloom" />
          <Dust beamX={0.57} foot={544} />
        </div>
        <div className="bm-grain" aria-hidden="true" />
        <div className="bm-flare bm-light" aria-hidden="true">
          <div className="bm-flare-wide" />
        </div>

        <Founders />

        {/* nav */}
        <header className="relative z-30">
          <div className="mx-auto flex h-[4.5rem] max-w-7xl items-center justify-between px-5 sm:px-8">
            <a href="#top" className="flex items-center gap-2.5 no-underline" style={{ color: "var(--bm-text)" }} aria-label="Bs Commerce home">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg text-[1.05rem] font-bold" style={{ background: "linear-gradient(135deg,#8f8dff,#6f8bff)", color: "#0a0a12" }} aria-hidden="true">B</span>
              <span className="text-[1.25rem] font-semibold tracking-tight">Bs Commerce</span>
            </a>
            <nav className="hidden items-center gap-1 lg:flex" aria-label="Sections">
              {[["What works today", "#live"], ["Themes", "#themes"], ["How it works", "#steps"], ["Pricing", "#pricing"], ["FAQ", "#faq"]].map(([label, href]) => (
                <a key={href} href={href} className="rounded-full px-3.5 py-2 text-[0.92rem] font-medium no-underline hover:bg-[rgb(255_255_255/0.08)]" style={{ color: "var(--bm-text)" }}>{label}</a>
              ))}
            </nav>
            <div className="flex items-center gap-2.5">
              <a href="https://admin.bcom.si" className="bm-outline hidden sm:inline-flex">Log in</a>
              <Link href="/signup" className="bm-pill bm-pill-sm">Sign up</Link>
            </div>
          </div>
        </header>

        {/* copy */}
        <div className="relative z-20 mx-auto max-w-7xl px-5 pb-16 pt-14 sm:px-8 sm:pt-20 lg:pt-24">
          <h1 className="bm-h1 bm-rise max-w-[11ch]" style={{ ["--d" as string]: "100ms" } as React.CSSProperties}>
            Open your Indian online store today.
          </h1>
          <p className="bm-dim bm-rise mt-7 max-w-[34rem] text-[1.1rem]" style={{ ["--d" as string]: "300ms" } as React.CSSProperties}>
            bcom.si gives Indian D2C brands a themed storefront, cash on delivery and GST invoices in one admin. Choose a
            name and start your 14-day free trial.
          </p>
          <div className="bm-rise mt-9 max-w-[34rem]" style={{ ["--d" as string]: "500ms" } as React.CSSProperties}>
            <SubdomainAvailabilityChecker platformDomain="bcom.si" />
            <p className="bm-dim mt-3 text-[0.9rem]">14 days free · no card needed · plans from {inr(cheapest)} a month + GST</p>
          </div>
        </div>

        {/* the lit window */}
        <div className="relative z-20 mx-auto w-[min(92vw,76rem)]">
          <AppWindow />
        </div>
      </section>

      {/* ---------- Strip ---------- */}
      <section className="mx-auto max-w-7xl px-5 py-12 sm:px-8">
        <p className="bm-dim text-[0.98rem]">Everything you need to sell in India:</p>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[1.05rem] font-semibold">
          {STRIP.map((s, i) => (
            <span key={s} className="flex items-center gap-3">
              {s}
              {i < STRIP.length - 1 && <span aria-hidden="true" style={{ color: "var(--bm-dim)" }}>·</span>}
            </span>
          ))}
        </p>
      </section>

      {/* ---------- What works today ---------- */}
      <section id="live" className="mx-auto max-w-7xl px-5 py-16 sm:px-8 lg:py-24">
        <div className="bm-rv max-w-3xl">
          <h2 className="bm-h2">Everything here works today.</h2>
          <p className="bm-dim mt-5 max-w-[60ch]">
            No roadmap in disguise. These are the parts a merchant can use the day they sign up. What is still being
            built is marked Coming soon, below.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-6 gap-5">
          <article className="bm-panel bm-rv col-span-6 p-6 lg:col-span-4">
            <h3 className="text-[1.45rem] font-semibold tracking-tight">Cash on delivery, done properly</h3>
            <p className="bm-dim mt-2 max-w-[56ch]">
              Set a COD fee per store. Stock is held when the order is placed and released if it is cancelled; you
              confirm, ship and mark it delivered, and the cash collected is recorded.
            </p>
            <ol className="mt-6 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4" aria-label="Order lifecycle">
              {["Placed", "Confirmed", "Shipped", "Delivered"].map((s, i) => (
                <li key={s} className="rounded-xl px-3 py-2.5" style={{ background: "var(--bm-panel-2)", border: "1px solid var(--bm-line)" }}>
                  <span className="bm-num block text-xs" style={{ color: "var(--bm-warm)" }}>Step {i + 1}</span>
                  <span className="font-semibold">{s}</span>
                </li>
              ))}
            </ol>
          </article>

          <article className="bm-panel bm-rv col-span-6 p-6 md:col-span-3 lg:col-span-2">
            <h3 className="text-[1.35rem] font-semibold tracking-tight">GST invoices</h3>
            <p className="bm-dim mt-2">CGST and SGST, or IGST, worked out from your state and your customer&apos;s, with the HSN on each line.</p>
            <dl className="bm-num mt-4 space-y-1.5 rounded-xl p-3.5 text-sm" style={{ background: "var(--bm-panel-2)", border: "1px solid var(--bm-line)" }} aria-label="Example invoice lines">
              <div className="flex justify-between"><dt>Cotton kurta · HSN 6104</dt><dd className="font-semibold">₹1,000.00</dd></div>
              <div className="bm-dim flex justify-between"><dt>CGST + SGST 9% + 9%</dt><dd>₹180.00</dd></div>
              <div className="bm-dim flex justify-between"><dt>or IGST 18%</dt><dd>₹180.00</dd></div>
            </dl>
            <p className="bm-dim mt-2 text-xs">Example only. Rates depend on your products.</p>
          </article>

          <article className="bm-panel bm-rv col-span-6 p-6 md:col-span-3 lg:col-span-2">
            <h3 className="text-[1.35rem] font-semibold tracking-tight">Change your theme without code</h3>
            <p className="bm-dim mt-2">
              Drag, drop and edit blocks: slider, product showcase, reviews, newsletter, cart. Colours, fonts and
              heading sizes per device. No custom code to break.
            </p>
            <ul className="mt-4 flex flex-wrap gap-2 text-sm font-medium" aria-label="Blocks you can place">
              {["Hero slider", "Product showcase", "Reviews", "Newsletter"].map((b) => (
                <li key={b} className="rounded-full px-3 py-1" style={{ background: "rgb(143 141 255 / 0.16)", color: "#d4d3ff" }}>{b}</li>
              ))}
            </ul>
          </article>

          <article className="bm-panel bm-rv col-span-6 p-6 lg:col-span-4">
            <h3 className="text-[1.45rem] font-semibold tracking-tight">The whole order, in one place</h3>
            <p className="bm-dim mt-2 max-w-[60ch]">
              Returns and exchanges with photos, a Request a quote button for price-on-request products, pre-orders
              with a ship-on date, and a list of abandoned checkouts.
            </p>
            <ul className="mt-5 flex flex-wrap gap-2.5 text-sm font-medium">
              {["Returns and exchanges", "Request a quote", "Pre-orders", "Abandoned checkouts", "Reviews", "Discounts"].map((t) => (
                <li key={t} className="rounded-full px-3.5 py-1.5" style={{ border: "1px solid var(--bm-line)", background: "var(--bm-panel-2)" }}>{t}</li>
              ))}
            </ul>
          </article>

          <article className="bm-panel bm-rv col-span-6 p-6 md:col-span-3">
            <h3 className="text-[1.35rem] font-semibold tracking-tight">Know who is buying</h3>
            <p className="bm-dim mt-2">Customer profiles, notes, consent history and CSV import. Build segments from rules and see who falls in.</p>
            <div className="mt-4 rounded-xl p-3.5 text-sm" style={{ background: "var(--bm-panel-2)", border: "1px solid var(--bm-line)" }} aria-label="Example segment rule">
              <p className="font-semibold">Win-back <span className="bm-dim font-normal">· example segment</span></p>
              <p className="bm-dim mt-1">Total spend over ₹5,000 and last order more than 60 days ago</p>
            </div>
          </article>

          <article className="bm-panel bm-rv col-span-6 p-6 md:col-span-3">
            <h3 className="text-[1.35rem] font-semibold tracking-tight">Shipping rates you control</h3>
            <p className="bm-dim mt-2">Set zones, rates and a free-shipping threshold. The cart and the checkout charge the same total.</p>
            <div className="mt-4 rounded-xl p-3.5" style={{ background: "var(--bm-panel-2)", border: "1px solid var(--bm-line)" }} aria-label="Example free shipping progress">
              <div className="flex justify-between text-sm"><span>Standard ₹70</span><span className="bm-num" style={{ color: "var(--bm-warm)" }}>Free above ₹1,200</span></div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full" style={{ background: "rgb(255 255 255 / 0.12)" }}><div className="h-full rounded-full" style={{ width: "78%", background: "var(--bm-violet)" }} /></div>
              <p className="bm-dim mt-2 text-xs">Example cart: ₹260 away from free shipping</p>
            </div>
          </article>
        </div>

        <div className="bm-rv mt-14">
          <h3 className="text-[1.45rem] font-semibold tracking-tight">Coming soon</h3>
          <p className="bm-dim mt-1 max-w-[60ch]">Not live yet. We will announce each one when it works, not before.</p>
          <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {COMING_SOON.map((c) => (
              <li key={c.name} className="rounded-2xl p-4" style={{ border: "1px dashed rgb(255 255 255 / 0.25)" }}>
                <p className="font-semibold tracking-tight">{c.name}</p>
                <p className="bm-dim text-sm">{c.note}</p>
                <p className="mt-2 text-xs font-semibold" style={{ color: "var(--bm-warm)" }}>Coming soon</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ---------- Themes ---------- */}
      <section id="themes" style={{ background: "var(--bm-panel)", borderTop: "1px solid var(--bm-line)", borderBottom: "1px solid var(--bm-line)" }}>
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
          <div className="bm-rv max-w-3xl">
            <h2 className="bm-h2">Start from a theme made for your niche.</h2>
            <p className="bm-dim mt-5 max-w-[60ch]">Then make it yours in the editor. These are illustrations of the starting layouts.</p>
          </div>
          <ul className="mt-12 grid gap-8 md:grid-cols-3">
            {THEMES.map((t, i) => (
              <li key={t.code} className="bm-rv" style={{ transitionDelay: `${i * 100}ms` }}>
                <div className="rounded-2xl p-3" style={{ background: "var(--bm-bg)", border: "1px solid var(--bm-line)" }}>
                  <div className="rounded-xl p-3" style={{ background: t.ground, color: t.ink }}>
                    <div className="flex items-center justify-between"><span className="text-xs font-semibold">Your store</span><span className="flex gap-1" aria-hidden="true">{[0, 1, 2].map((d) => <span key={d} className="h-1 w-4 rounded-full" style={{ background: t.accent, opacity: 0.4 + d * 0.25 }} />)}</span></div>
                    <div className="mt-3 rounded-lg p-3.5" style={{ background: t.tile }}>
                      <p className="text-[0.62rem] font-bold uppercase tracking-wider" style={{ color: t.accent }}>New in</p>
                      <p className="mt-0.5 text-base font-semibold leading-tight">{t.name}</p>
                      <span className="mt-2 inline-block rounded px-2.5 py-1 text-[0.65rem] font-bold" style={{ background: t.accent, color: t.ground }}>Shop now</span>
                    </div>
                    <div className="mt-2.5 grid grid-cols-3 gap-1.5" aria-hidden="true">{[0, 1, 2].map((c) => <div key={c} className="aspect-[4/5] rounded" style={{ background: t.tile }} />)}</div>
                  </div>
                </div>
                <h3 className="mt-5 text-xl font-semibold tracking-tight">{t.name}</h3>
                <p className="bm-dim text-sm">{t.industry}</p>
                <p className="mt-1">{t.line}</p>
                <Link href={`/signup?template=${t.code}`} className="bm-outline mt-4">Start with this theme</Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ---------- Steps ---------- */}
      <section id="steps" className="mx-auto max-w-5xl px-5 py-20 sm:px-8 lg:py-28">
        <div className="bm-rv"><h2 className="bm-h2">From a name to your first order.</h2></div>
        <ol className="mt-12">
          {STEPS.map((s, i) => (
            <li key={s.title} className="bm-rv grid gap-3 py-7 md:grid-cols-[6rem_1fr_1.3fr] md:gap-8" style={{ borderTop: "1px solid var(--bm-line)" }}>
              <span className="bm-num text-[2.6rem] font-semibold leading-none tracking-tight" style={{ color: "var(--bm-violet)" }} aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="text-xl font-semibold tracking-tight">{s.title}</h3>
              <p className="bm-dim">{s.body}</p>
            </li>
          ))}
          <li style={{ borderTop: "1px solid var(--bm-line)" }} aria-hidden="true" />
        </ol>
      </section>

      {/* ---------- Pricing ---------- */}
      <section id="pricing" style={{ background: "var(--bm-panel)", borderTop: "1px solid var(--bm-line)", borderBottom: "1px solid var(--bm-line)" }}>
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
          <div className="bm-rv flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div className="max-w-2xl">
              <h2 className="bm-h2">Plans you can read in one go.</h2>
              <p className="bm-dim mt-5">Prices in rupees, plus GST. Every plan starts with a 14-day free trial.</p>
            </div>
            <div className="inline-flex rounded-full p-1" role="group" aria-label="Billing period" style={{ background: "var(--bm-bg)", border: "1px solid var(--bm-line)" }}>
              {(["monthly", "yearly"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setInterval_(v)}
                  aria-pressed={interval === v}
                  className="min-h-[2.5rem] rounded-full px-5 font-semibold"
                  style={interval === v ? { background: "var(--bm-text)", color: "#0a0a12" } : { color: "var(--bm-text)" }}
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
                <li key={p.code} className="bm-panel bm-rv flex flex-col p-7" style={{ background: "var(--bm-bg)", transitionDelay: `${i * 90}ms` }}>
                  <h3 className="text-2xl font-semibold tracking-tight">{p.name}</h3>
                  <p className="bm-num mt-5 flex items-end gap-2">
                    <span className="text-5xl font-semibold tracking-tight">{inr(perMonth)}</span>
                    <span className="bm-dim pb-1.5">a month</span>
                  </p>
                  <p className="bm-dim bm-num mt-1 min-h-[1.5rem] text-sm">
                    {interval === "yearly" ? `Billed ${inr(p.yearlyPaise)} a year${saving > 0 ? ` · you save ${inr(saving)}` : ""}` : "Billed monthly"}
                  </p>
                  <ul className="mt-6 flex-1 space-y-2.5">
                    {planBullets(p.limits).map((b) => (
                      <li key={b} className="flex items-start gap-2.5">
                        <svg width="18" height="18" viewBox="0 0 24 24" className="mt-1 shrink-0" aria-hidden="true" fill="none" stroke="#8f8dff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
                        {b}
                      </li>
                    ))}
                  </ul>
                  <Link href={`/signup?plan=${p.code}&interval=${interval}`} className="bm-pill mt-8 w-full">Start free trial <Arrow /></Link>
                </li>
              );
            })}
          </ul>
          <div className="bm-rv mt-12">
            <p className="text-xl font-semibold tracking-tight">Every plan includes</p>
            <ul className="mt-3 flex flex-wrap gap-2.5">
              {INCLUDED_IN_ALL.map((x) => (
                <li key={x} className="rounded-full px-4 py-2" style={{ border: "1px solid var(--bm-line)", background: "var(--bm-bg)" }}>{x}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ---------- FAQ ---------- */}
      <section id="faq" className="mx-auto max-w-4xl px-5 py-20 sm:px-8 lg:py-28">
        <div className="bm-rv"><h2 className="bm-h2">Straight answers.</h2></div>
        <div className="mt-10">
          {FAQS.map((f) => (
            <details key={f.q} className="bm-faq bm-rv py-1" style={{ borderTop: "1px solid var(--bm-line)" }}>
              <summary className="flex min-h-[3.75rem] items-center justify-between gap-4 py-3 text-[1.1rem] font-semibold tracking-tight">
                {f.q}
                <svg width="22" height="22" viewBox="0 0 24 24" className="bm-plus shrink-0" aria-hidden="true" fill="none" stroke="#9ea4bd" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              </summary>
              <p className="bm-dim max-w-[62ch] pb-5">{f.a}</p>
            </details>
          ))}
          <div style={{ borderTop: "1px solid var(--bm-line)" }} />
        </div>
      </section>

      {/* ---------- Close ---------- */}
      <section className="relative isolate overflow-hidden" style={{ borderTop: "1px solid var(--bm-line)" }}>
        <div className="absolute inset-x-0 bottom-0 h-72" style={{ background: "radial-gradient(ellipse 45% 100% at 50% 100%, rgb(125 140 255 / 0.45), transparent 70%)" }} aria-hidden="true" />
        <div className="bm-rv relative mx-auto max-w-4xl px-5 py-24 text-center sm:px-8">
          <h2 className="bm-h2">Switch on your store today.</h2>
          <p className="bm-dim mx-auto mt-4 max-w-[46ch]">Pick a name and start the 14-day trial. No card needed.</p>
          <div className="mx-auto mt-8 flex max-w-xl justify-center text-left">
            <SubdomainAvailabilityChecker platformDomain="bcom.si" />
          </div>
        </div>
      </section>

      <footer style={{ borderTop: "1px solid var(--bm-line)" }}>
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-5 py-12 sm:px-8 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg font-bold" style={{ background: "linear-gradient(135deg,#8f8dff,#6f8bff)", color: "#0a0a12" }} aria-hidden="true">b</span>
            <p className="bm-dim max-w-xs text-sm">Online stores for Indian D2C brands, with cash on delivery and GST built in.</p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Footer">
            {[["What works today", "#live"], ["Themes", "#themes"], ["Pricing", "#pricing"], ["FAQ", "#faq"]].map(([label, href]) => (
              <a key={href} href={href} style={{ color: "var(--bm-text)" }}>{label}</a>
            ))}
            <a href="https://admin.bcom.si" style={{ color: "var(--bm-text)" }}>Log in</a>
            <Link href="/signup" style={{ color: "var(--bm-warm)" }}>Start free trial</Link>
          </nav>
        </div>
        <p className="bm-dim mx-auto max-w-7xl px-5 pb-10 text-xs sm:px-8">© {new Date().getFullYear()} bcom.si. Example data on this page is made up for illustration.</p>
      </footer>
    </div>
  );
}

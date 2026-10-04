"use client";

/*
 * bcom.si landing, design 5: "Night Sky".
 * THESIS: a modern dark SaaS page where the store is a sun and everything it does is in orbit around it; refuses the
 *   stock dark-SaaS arrangement of a glowing gradient headline, glass cards and a logo strip.
 * OWN-WORLD: midnight ground with a deterministic starfield, solid panels with fine star-chart borders, constellation
 *   line art that draws itself, slow orbits, moon-phase plan tiers, moon silver text with sun-gold as the one action
 *   colour, Sora display, Albert Sans body.
 * STORY: a D2C founder sees their store at the centre of what bcom.si does today, reads exactly what is live (and the
 *   still-unmapped stars), checks a store name and starts the 14-day trial.
 * FIRST VIEWPORT: left, a headline that resolves from blur, one sentence, the store-name field with the gold button;
 *   right, the orbit diagram (your store, themes, COD, GST, orders, customers) with a live order log overlapping it.
 * FORM: Night Sky, commissioned by the owner on 2026-10-05 as the fifth design to compare.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
 */

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { SubdomainAvailabilityChecker } from "./SubdomainAvailabilityChecker.tsx";
import { OrbitHero } from "./landing5/OrbitHero.tsx";
import { SkyLog } from "./landing5/SkyLog.tsx";
import { Starfield } from "./landing5/Starfield.tsx";
import { useRevealMotion } from "./landing/motion.ts";
import { COMING_SOON, FAQS, FALLBACK_PLANS, INCLUDED_IN_ALL, STEPS, THEMES, planBullets, type LandingPlan } from "./landing/content.ts";
import { skBodyFont, skDisplayFont } from "./landing5/fonts.ts";
import "./landing5/sky.css";

const inr = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

/** A hand-placed constellation: stars joined by lines that draw when the panel is revealed. */
function Constellation({ pts, color = "#cfd6ff" }: { pts: [number, number][]; color?: string }) {
  return (
    <svg viewBox="0 0 120 60" width="120" height="60" className="sk-line" aria-hidden="true">
      {pts.slice(1).map(([x, y], i) => {
        const [px, py] = pts[i] as [number, number];
        return <line key={i} x1={px} y1={py} x2={x} y2={y} stroke={color} strokeOpacity="0.55" strokeWidth="1.2" pathLength={1} />;
      })}
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === 0 ? 3.4 : 2.4} fill={i === 0 ? "#ffc766" : color} />
      ))}
    </svg>
  );
}

function Moon({ phase }: { phase: 0 | 1 | 2 }) {
  return (
    <svg width="44" height="44" viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="16" fill="none" stroke="#dfe6ff" strokeWidth="1.6" />
      {phase === 0 && (
        <>
          <mask id="sk-crescent"><rect width="40" height="40" fill="#fff" /><circle cx="27" cy="16" r="13" fill="#000" /></mask>
          <circle cx="20" cy="20" r="16" fill="#dfe6ff" mask="url(#sk-crescent)" />
        </>
      )}
      {phase === 1 && <path d="M20 4A16 16 0 0 0 20 36Z" fill="#dfe6ff" />}
      {phase === 2 && <circle cx="20" cy="20" r="16" fill="#dfe6ff" />}
    </svg>
  );
}

function Words({ text, from }: { text: string; from: number }) {
  const parts = text.split(" ");
  return (
    <>
      {parts.map((w, i) => (
        <span key={`${w}-${i}`} className="sk-word" style={{ ["--i" as string]: i, color: i >= from ? "var(--sk-gold)" : undefined } as React.CSSProperties}>
          {w}
          {i < parts.length - 1 ? " " : ""}
        </span>
      ))}
    </>
  );
}

const CONSTELLATIONS: [number, number][][] = [
  [[10, 44], [34, 20], [62, 34], [88, 12], [110, 30]],
  [[12, 12], [40, 38], [70, 16], [104, 44]],
  [[8, 30], [30, 10], [58, 28], [84, 46], [112, 22]],
  [[14, 46], [38, 24], [66, 40], [92, 14]],
  [[10, 20], [36, 44], [64, 22], [90, 40], [112, 10]],
  [[12, 36], [44, 12], [72, 30], [106, 50]],
];

export function MarketingLandingSky({ plans }: { plans?: LandingPlan[] | undefined }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useRevealMotion(rootRef, { item: ".sk-rv", armedClass: "sk-armed" });
  const [interval, setInterval_] = useState<"monthly" | "yearly">("monthly");
  const planList = useMemo(() => (plans && plans.length > 0 ? plans : FALLBACK_PLANS), [plans]);
  const cheapest = Math.min(...planList.map((p) => p.monthlyPaise));

  return (
    <div ref={rootRef} className={`sk ${skDisplayFont.variable} ${skBodyFont.variable}`} id="top">
      <Starfield />

      {/* ---------- Nav ---------- */}
      <header className="sticky top-0 z-40" style={{ background: "rgb(6 8 24 / 0.94)", borderBottom: "1px solid var(--sk-line)" }}>
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
          <a href="#top" className="flex items-center gap-2.5 no-underline" style={{ color: "var(--sk-text)" }} aria-label="bcom.si home">
            <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true"><circle cx="15" cy="15" r="9" fill="#ffc766" /><circle cx="15" cy="15" r="13.5" fill="none" stroke="#8b7bff" strokeWidth="1.3" strokeDasharray="2 3.2" /><circle cx="26" cy="9" r="2.4" fill="#5eead4" /></svg>
            <span className="sk-display text-[1.25rem]">bcom.si</span>
          </a>
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Sections">
            {[["What works today", "#live"], ["Themes", "#themes"], ["How it works", "#steps"], ["Pricing", "#pricing"], ["FAQ", "#faq"]].map(([label, href]) => (
              <a key={href} href={href} className="rounded-full px-3.5 py-2 text-[0.95rem] font-medium no-underline hover:bg-[rgb(190_200_255/0.1)]" style={{ color: "var(--sk-text)" }}>{label}</a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <a href="https://admin.bcom.si" className="hidden rounded-full px-3.5 py-2 text-[0.95rem] font-medium sm:inline-block" style={{ color: "var(--sk-text)" }}>Log in</a>
            <Link href="/signup" className="sk-btn sk-btn-sm">Start free trial</Link>
          </div>
        </div>
      </header>

      <main>
        {/* ---------- Hero ---------- */}
        <section className="mx-auto grid max-w-7xl gap-12 px-5 pb-20 pt-14 sm:px-8 lg:grid-cols-12 lg:items-center lg:gap-6 lg:pb-28 lg:pt-16">
          <div className="lg:col-span-6">
            <h1 className="sk-display text-[clamp(2.5rem,5.8vw,4.8rem)]">
              <Words text="Open your Indian online store today." from={5} />
            </h1>
            <p className="sk-dim mt-7 max-w-[52ch] text-[1.15rem]">
              A themed storefront, cash on delivery and GST invoices in one admin, made for Indian D2C brands. Choose a
              name and start your 14-day free trial.
            </p>
            <div className="mt-9">
              <SubdomainAvailabilityChecker platformDomain="bcom.si" variant="sky" />
              <p className="sk-dim mt-3 text-[0.95rem]">14 days free · no card needed · plans from {inr(cheapest)} a month + GST</p>
            </div>
          </div>
          <div className="relative lg:col-span-6">
            <div className="mx-auto w-full max-w-[34rem]">
              <OrbitHero />
            </div>
            <div className="relative z-10 mx-auto -mt-10 w-full max-w-[19rem] sm:max-w-[20rem] lg:absolute lg:-bottom-6 lg:right-0 lg:mt-0">
              <SkyLog />
            </div>
          </div>
        </section>

        {/* ---------- What works today: constellation panels ---------- */}
        <section id="live" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
          <div className="sk-rv max-w-3xl">
            <h2 className="sk-h2">Every star on this map is <span style={{ color: "var(--sk-gold)" }}>switched on.</span></h2>
            <p className="sk-dim mt-5 max-w-[60ch]">
              No roadmap in disguise. These are the parts a merchant can use the day they sign up. The stars not yet
              mapped are marked Coming soon, below.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-6 gap-5">
            <article className="sk-panel sk-rv col-span-6 p-6 lg:col-span-4">
              <Constellation pts={CONSTELLATIONS[0] as [number, number][]} />
              <h3 className="sk-display mt-4 text-[1.5rem]">Cash on delivery, done properly</h3>
              <p className="sk-dim mt-2 max-w-[56ch]">
                Set a COD fee per store. Stock is held when the order is placed and released if it is cancelled; you
                confirm, ship and mark it delivered, and the cash collected is recorded.
              </p>
              <ol className="mt-6 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4" aria-label="Order lifecycle">
                {["Placed", "Confirmed", "Shipped", "Delivered"].map((s, i) => (
                  <li key={s} className="rounded-xl px-3 py-2.5" style={{ background: "var(--sk-panel-2)", border: "1px solid var(--sk-line)" }}>
                    <span className="sk-num block text-xs" style={{ color: "var(--sk-gold)" }}>Step {i + 1}</span>
                    <span className="font-semibold">{s}</span>
                  </li>
                ))}
              </ol>
            </article>

            <article className="sk-panel sk-rv col-span-6 p-6 md:col-span-3 lg:col-span-2">
              <Constellation pts={CONSTELLATIONS[1] as [number, number][]} />
              <h3 className="sk-display mt-4 text-[1.4rem]">GST invoices</h3>
              <p className="sk-dim mt-2">CGST and SGST, or IGST, worked out from your state and your customer&apos;s, with the HSN on each line.</p>
              <dl className="sk-num mt-4 space-y-1.5 rounded-xl p-3.5 text-sm" style={{ background: "var(--sk-panel-2)", border: "1px solid var(--sk-line)" }} aria-label="Example invoice lines">
                <div className="flex justify-between"><dt>Cotton kurta · HSN 6104</dt><dd className="font-semibold">₹1,000.00</dd></div>
                <div className="sk-dim flex justify-between"><dt>CGST + SGST 9% + 9%</dt><dd>₹180.00</dd></div>
                <div className="sk-dim flex justify-between"><dt>or IGST 18%</dt><dd>₹180.00</dd></div>
              </dl>
              <p className="sk-dim mt-2 text-xs">Example only. Rates depend on your products.</p>
            </article>

            <article className="sk-panel sk-rv col-span-6 p-6 md:col-span-3 lg:col-span-2">
              <Constellation pts={CONSTELLATIONS[2] as [number, number][]} />
              <h3 className="sk-display mt-4 text-[1.4rem]">Change your theme without code</h3>
              <p className="sk-dim mt-2">
                Drag, drop and edit blocks: slider, product showcase, reviews, newsletter, cart. Colours, fonts and
                heading sizes per device. No custom code to break.
              </p>
              <ul className="mt-4 flex flex-wrap gap-2 text-sm font-medium" aria-label="Blocks you can place">
                {["Hero slider", "Product showcase", "Reviews", "Newsletter"].map((b) => (
                  <li key={b} className="rounded-full px-3 py-1" style={{ background: "rgb(139 123 255 / 0.2)", color: "#d7d2ff" }}>{b}</li>
                ))}
              </ul>
            </article>

            <article className="sk-panel sk-rv col-span-6 p-6 lg:col-span-4">
              <Constellation pts={CONSTELLATIONS[3] as [number, number][]} />
              <h3 className="sk-display mt-4 text-[1.5rem]">The whole order, in one place</h3>
              <p className="sk-dim mt-2 max-w-[60ch]">
                Returns and exchanges with photos, a Request a quote button for price-on-request products, pre-orders
                with a ship-on date, and a list of abandoned checkouts.
              </p>
              <ul className="mt-5 flex flex-wrap gap-2.5 text-sm font-medium">
                {["Returns and exchanges", "Request a quote", "Pre-orders", "Abandoned checkouts", "Reviews", "Discounts"].map((t) => (
                  <li key={t} className="rounded-full px-3.5 py-1.5" style={{ border: "1px solid var(--sk-line)", background: "var(--sk-panel-2)" }}>{t}</li>
                ))}
              </ul>
            </article>

            <article className="sk-panel sk-rv col-span-6 p-6 md:col-span-3">
              <Constellation pts={CONSTELLATIONS[4] as [number, number][]} />
              <h3 className="sk-display mt-4 text-[1.4rem]">Know who is buying</h3>
              <p className="sk-dim mt-2">Customer profiles, notes, consent history and CSV import. Build segments from rules and see who falls in.</p>
              <div className="mt-4 rounded-xl p-3.5 text-sm" style={{ background: "var(--sk-panel-2)", border: "1px solid var(--sk-line)" }} aria-label="Example segment rule">
                <p className="font-semibold">Win-back <span className="sk-dim font-normal">· example segment</span></p>
                <p className="sk-dim mt-1">Total spend over ₹5,000 and last order more than 60 days ago</p>
              </div>
            </article>

            <article className="sk-panel sk-rv col-span-6 p-6 md:col-span-3">
              <Constellation pts={CONSTELLATIONS[5] as [number, number][]} />
              <h3 className="sk-display mt-4 text-[1.4rem]">Shipping rates you control</h3>
              <p className="sk-dim mt-2">Set zones, rates and a free-shipping threshold. The cart and the checkout charge the same total.</p>
              <div className="mt-4 rounded-xl p-3.5" style={{ background: "var(--sk-panel-2)", border: "1px solid var(--sk-line)" }} aria-label="Example free shipping progress">
                <div className="flex justify-between text-sm"><span>Standard ₹70</span><span className="sk-num" style={{ color: "var(--sk-gold)" }}>Free above ₹1,200</span></div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full" style={{ background: "rgb(190 200 255 / 0.16)" }}><div className="h-full rounded-full" style={{ width: "78%", background: "var(--sk-teal)" }} /></div>
                <p className="sk-dim mt-2 text-xs">Example cart: ₹260 away from free shipping</p>
              </div>
            </article>
          </div>

          <div className="sk-rv mt-14">
            <h3 className="sk-display text-[1.5rem]">Not yet mapped</h3>
            <p className="sk-dim mt-1 max-w-[60ch]">Coming soon. We will announce each one when it works, not before.</p>
            <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {COMING_SOON.map((c) => (
                <li key={c.name} className="rounded-2xl p-4" style={{ border: "1px dashed rgb(190 200 255 / 0.4)" }}>
                  <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="8" fill="none" stroke="#a9b1d9" strokeDasharray="2 3" /><circle cx="11" cy="11" r="2.2" fill="#a9b1d9" /></svg>
                  <p className="sk-display mt-2 text-[1.05rem]">{c.name}</p>
                  <p className="sk-dim text-sm">{c.note}</p>
                  <p className="mt-2 text-xs font-semibold" style={{ color: "var(--sk-gold)" }}>Coming soon</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------- Themes: portholes ---------- */}
        <section id="themes" style={{ background: "var(--sk-panel)", borderTop: "1px solid var(--sk-line)", borderBottom: "1px solid var(--sk-line)" }}>
          <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
            <div className="sk-rv max-w-3xl">
              <h2 className="sk-h2">Pick your sky.</h2>
              <p className="sk-dim mt-5 max-w-[60ch]">
                Start from a theme made for your niche, then make it yours in the editor. These are illustrations of the
                starting layouts.
              </p>
            </div>
            <ul className="mt-12 grid gap-10 md:grid-cols-3">
              {THEMES.map((t, i) => (
                <li key={t.code} className="sk-rv text-center" style={{ transitionDelay: `${i * 100}ms` }}>
                  <div className="mx-auto aspect-square w-full max-w-[17rem] overflow-hidden rounded-full p-[10%]" style={{ background: t.ground, color: t.ink, border: "1px solid rgb(190 200 255 / 0.4)", boxShadow: "0 0 0 8px var(--sk-bg), 0 0 0 9px var(--sk-line)" }}>
                    <div className="flex h-full flex-col justify-center gap-2">
                      <div className="flex items-center justify-between"><span className="sk-display text-[0.7rem]">Your store</span><span className="flex gap-1" aria-hidden="true">{[0, 1, 2].map((d) => <span key={d} className="h-1 w-3 rounded-full" style={{ background: t.accent, opacity: 0.4 + d * 0.25 }} />)}</span></div>
                      <div className="rounded-lg p-2.5 text-left" style={{ background: t.tile }}>
                        <p className="text-[0.55rem] font-bold uppercase tracking-wider" style={{ color: t.accent }}>New in</p>
                        <p className="sk-display mt-0.5 text-[0.85rem] leading-tight">{t.name}</p>
                        <span className="mt-1.5 inline-block rounded px-2 py-0.5 text-[0.55rem] font-bold" style={{ background: t.accent, color: t.ground }}>Shop now</span>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5" aria-hidden="true">{[0, 1, 2].map((c) => <div key={c} className="aspect-[4/5] rounded" style={{ background: t.tile }} />)}</div>
                    </div>
                  </div>
                  <h3 className="sk-display mt-6 text-xl">{t.name}</h3>
                  <p className="sk-dim text-sm">{t.industry}</p>
                  <p className="mt-1">{t.line}</p>
                  <Link href={`/signup?template=${t.code}`} className="sk-btn sk-btn-ghost sk-btn-sm mt-4">Start with this theme</Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------- Flight plan ---------- */}
        <section id="steps" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
          <div className="sk-rv max-w-3xl"><h2 className="sk-h2">Your flight plan, <span style={{ color: "var(--sk-gold)" }}>four waypoints.</span></h2></div>
          <ol className="relative mt-14 grid gap-10 md:grid-cols-2 lg:grid-cols-4">
            <svg className="sk-line absolute left-0 top-[1.55rem] hidden h-2 w-full lg:block" viewBox="0 0 100 2" preserveAspectRatio="none" aria-hidden="true">
              <line x1="6" y1="1" x2="94" y2="1" stroke="#8b7bff" strokeOpacity="0.55" strokeWidth="0.5" strokeDasharray="1.2 1.8" vectorEffect="non-scaling-stroke" />
            </svg>
            {STEPS.map((s, i) => (
              <li key={s.title} className="sk-rv relative" style={{ transitionDelay: `${i * 90}ms` }}>
                <span className="sk-display sk-num relative z-10 flex h-12 w-12 items-center justify-center rounded-full text-lg" style={{ background: "var(--sk-bg)", border: "1.5px solid var(--sk-gold)", color: "var(--sk-gold)" }} aria-hidden="true">{i + 1}</span>
                <h3 className="sk-display mt-5 text-xl">{s.title}</h3>
                <p className="sk-dim mt-2">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ---------- Pricing: phases of the moon ---------- */}
        <section id="pricing" style={{ background: "var(--sk-panel)", borderTop: "1px solid var(--sk-line)", borderBottom: "1px solid var(--sk-line)" }}>
          <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
            <div className="sk-rv flex flex-col justify-between gap-6 md:flex-row md:items-end">
              <div className="max-w-2xl">
                <h2 className="sk-h2">Plans, by phase.</h2>
                <p className="sk-dim mt-5">Prices in rupees, plus GST. Every plan starts with a 14-day free trial.</p>
              </div>
              <div className="inline-flex rounded-full p-1" role="group" aria-label="Billing period" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-line)" }}>
                {(["monthly", "yearly"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setInterval_(v)}
                    aria-pressed={interval === v}
                    className="min-h-[2.5rem] rounded-full px-5 font-semibold"
                    style={interval === v ? { background: "var(--sk-gold)", color: "var(--sk-ink)" } : { color: "var(--sk-text)" }}
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
                  <li key={p.code} className="sk-panel sk-rv flex flex-col p-7" style={{ background: "var(--sk-bg)", transitionDelay: `${i * 90}ms` }}>
                    <div className="flex items-center justify-between">
                      <h3 className="sk-display text-2xl">{p.name}</h3>
                      <Moon phase={(i % 3) as 0 | 1 | 2} />
                    </div>
                    <p className="sk-num mt-5 flex items-end gap-2">
                      <span className="sk-display text-5xl">{inr(perMonth)}</span>
                      <span className="sk-dim pb-1.5">a month</span>
                    </p>
                    <p className="sk-dim sk-num mt-1 min-h-[1.5rem] text-sm">
                      {interval === "yearly" ? `Billed ${inr(p.yearlyPaise)} a year${saving > 0 ? ` · you save ${inr(saving)}` : ""}` : "Billed monthly"}
                    </p>
                    <ul className="mt-6 flex-1 space-y-2.5">
                      {planBullets(p.limits).map((b) => (
                        <li key={b} className="flex items-start gap-2.5">
                          <svg width="18" height="18" viewBox="0 0 24 24" className="mt-1 shrink-0" aria-hidden="true" fill="none" stroke="#5eead4" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
                          {b}
                        </li>
                      ))}
                    </ul>
                    <Link href={`/signup?plan=${p.code}&interval=${interval}`} className="sk-btn mt-8 w-full">Start free trial</Link>
                  </li>
                );
              })}
            </ul>

            <div className="sk-rv mt-12">
              <p className="sk-display text-xl">Every plan includes</p>
              <ul className="mt-3 flex flex-wrap gap-2.5">
                {INCLUDED_IN_ALL.map((x) => (
                  <li key={x} className="rounded-full px-4 py-2" style={{ border: "1px solid var(--sk-line)", background: "var(--sk-bg)" }}>{x}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ---------- FAQ ---------- */}
        <section id="faq" className="mx-auto max-w-4xl px-5 py-20 sm:px-8 lg:py-28">
          <div className="sk-rv"><h2 className="sk-h2">Straight answers.</h2></div>
          <div className="mt-10">
            {FAQS.map((f) => (
              <details key={f.q} className="sk-faq sk-rv py-1" style={{ borderTop: "1px solid var(--sk-line)" }}>
                <summary className="sk-display flex min-h-[3.75rem] items-center justify-between gap-4 py-3 text-[1.1rem]" style={{ letterSpacing: "-0.02em" }}>
                  {f.q}
                  <svg width="22" height="22" viewBox="0 0 24 24" className="sk-plus shrink-0" aria-hidden="true" fill="none" stroke="#ffc766" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                </summary>
                <p className="sk-dim max-w-[62ch] pb-5">{f.a}</p>
              </details>
            ))}
            <div style={{ borderTop: "1px solid var(--sk-line)" }} />
          </div>
        </section>

        {/* ---------- Close: the moon ---------- */}
        <section className="px-5 pb-20 sm:px-8 lg:pb-28">
          <div className="sk-rv relative mx-auto max-w-5xl overflow-hidden rounded-3xl px-6 py-16 text-center sm:px-12" style={{ background: "var(--sk-panel)", border: "1px solid var(--sk-line)" }}>
            <svg className="pointer-events-none absolute -right-20 -top-20 h-72 w-72" viewBox="0 0 100 100" aria-hidden="true">
              <circle cx="50" cy="50" r="46" fill="#dfe6ff" opacity="0.92" />
              <circle cx="34" cy="38" r="7" fill="#c3cbf0" /><circle cx="62" cy="58" r="10" fill="#c3cbf0" /><circle cx="44" cy="70" r="4.5" fill="#c3cbf0" /><circle cx="70" cy="30" r="4" fill="#c3cbf0" />
            </svg>
            <h2 className="sk-h2 relative">Launch your store <span style={{ color: "var(--sk-gold)" }}>today.</span></h2>
            <p className="sk-dim relative mx-auto mt-4 max-w-[48ch]">Pick a name and start the 14-day trial. No card needed.</p>
            <div className="relative mx-auto mt-8 flex max-w-xl justify-center text-left">
              <SubdomainAvailabilityChecker platformDomain="bcom.si" variant="sky" />
            </div>
          </div>
        </section>
      </main>

      <footer style={{ borderTop: "1px solid var(--sk-line)", background: "rgb(6 8 24 / 0.9)" }}>
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-5 py-12 sm:px-8 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <svg width="28" height="28" viewBox="0 0 30 30" aria-hidden="true"><circle cx="15" cy="15" r="9" fill="#ffc766" /><circle cx="15" cy="15" r="13.5" fill="none" stroke="#8b7bff" strokeWidth="1.3" strokeDasharray="2 3.2" /></svg>
            <p className="sk-dim max-w-xs text-sm">Online stores for Indian D2C brands, with cash on delivery and GST built in.</p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Footer">
            {[["What works today", "#live"], ["Themes", "#themes"], ["Pricing", "#pricing"], ["FAQ", "#faq"]].map(([label, href]) => (
              <a key={href} href={href} style={{ color: "var(--sk-text)" }}>{label}</a>
            ))}
            <a href="https://admin.bcom.si" style={{ color: "var(--sk-text)" }}>Log in</a>
            <Link href="/signup" style={{ color: "var(--sk-gold)" }}>Start free trial</Link>
          </nav>
        </div>
        <p className="sk-dim mx-auto max-w-7xl px-5 pb-10 text-xs sm:px-8">© {new Date().getFullYear()} bcom.si. Example data on this page is made up for illustration.</p>
      </footer>
    </div>
  );
}

"use client";

/*
 * bcom.si landing, design 2: "The Bahi-Khata".
 * THESIS: the shop's own book of accounts. Orders, GST and cash on delivery are entries in the ledger every Indian
 *   trader keeps; refuses the stock SaaS arrangement of hero, logo strip, icon cards and a white pricing table.
 * OWN-WORLD: red book-cloth ground, ruled yellowed paper with a double red margin, blue-black ink, brass corners,
 *   rubber stamp, entries in a shopkeeper's pen (Kalam), Young Serif headings, Hind body.
 * STORY: a D2C founder sees real orders written into a day book, reads an index of exactly what is live (and what is
 *   Coming soon), checks a firm name and opens a 14-day trial.
 * FIRST VIEWPORT: left, the gilt-stamped headline, one sentence and the firm-name line with the red "Open my khata"
 *   button; right, a ruled Day Book page with entries being written in and a stamp thumping onto it.
 * FORM: Bahi-Khata, Impeccable's pick (candidate 1 of 7), built as the second design to compare against Block-Print Bazaar.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
 */

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { SubdomainAvailabilityChecker } from "./SubdomainAvailabilityChecker.tsx";
import { LedgerDayBook } from "./landing2/LedgerDayBook.tsx";
import { useRevealMotion } from "./landing/motion.ts";
import { COMING_SOON, FAQS, FALLBACK_PLANS, INCLUDED_IN_ALL, STEPS, THEMES, type LandingPlan } from "./landing/content.ts";
import { bkBodyFont, bkDisplayFont, bkPenFont } from "./landing2/fonts.ts";
import "./landing2/bahi.css";

const inr = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const fmt = (n: number) => n.toLocaleString("en-IN");

/** The index of what works today: ledger head, what it does. Every line is live in the product. */
const INDEX_LIVE = [
  { head: "Cash book", sub: "Cash on delivery", body: "Take COD orders with a fee you set. Stock is held at checkout and released if the order is cancelled; you confirm, ship and mark it delivered." },
  { head: "Tax ledger", sub: "GST invoices", body: "Tax invoices with CGST and SGST, or IGST, worked out from your state and your customer's, with the HSN on each line." },
  { head: "Pattern book", sub: "Themes", body: "Pick a theme, then drag and drop blocks to change it: slider, product showcase, reviews, newsletter, cart. Colours, fonts and heading sizes per device, with no code." },
  { head: "Order book", sub: "Orders", body: "Returns and exchanges with photos, Request a quote on price-on-request products, pre-orders with a ship-on date, abandoned checkouts, reviews and discounts." },
  { head: "Customer register", sub: "Customers", body: "Profiles, notes, consent history, CSV import, and segments built from rules." },
  { head: "Carriage", sub: "Shipping rates", body: "Your zones, your rates and a free-shipping threshold. The cart and the checkout charge the same total." },
];

function PenUnderline({ className = "" }: { className?: string }) {
  return (
    <svg className={`bk-pen-underline ${className}`} viewBox="0 0 220 14" preserveAspectRatio="none" aria-hidden="true">
      <path d="M2 9 C 40 2, 78 12, 112 6 S 190 3, 218 8" fill="none" stroke="#c9992e" strokeWidth="4" strokeLinecap="round" pathLength="1" />
    </svg>
  );
}

function Seal({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="bcom.si">
      <circle cx="24" cy="24" r="22" fill="#c9992e" />
      <circle cx="24" cy="24" r="18.5" fill="none" stroke="#5a0f12" strokeWidth="1.5" strokeDasharray="2 2.4" />
      <text x="24" y="31.5" textAnchor="middle" fontFamily="var(--bk-display)" fontSize="23" fill="#5a0f12">b</text>
    </svg>
  );
}

export function MarketingLandingBahi({ plans }: { plans?: LandingPlan[] | undefined }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useRevealMotion(rootRef, { item: ".bk-rv", armedClass: "bk-armed" });
  const [interval, setInterval_] = useState<"monthly" | "yearly">("monthly");
  const planList = useMemo(() => (plans && plans.length > 0 ? plans : FALLBACK_PLANS), [plans]);
  const cheapest = Math.min(...planList.map((p) => p.monthlyPaise));

  return (
    <div ref={rootRef} className={`bk ${bkDisplayFont.variable} ${bkBodyFont.variable} ${bkPenFont.variable}`} id="top">
      {/* ---------- Nav: the cloth cover with gilt lettering ---------- */}
      <header className="sticky top-0 z-40" style={{ background: "var(--bk-cloth-deep)", borderBottom: "3px double var(--bk-brass)" }}>
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
          <a href="#top" className="flex items-center gap-2.5 no-underline" aria-label="bcom.si home">
            <Seal size={36} />
            <span className="bk-display text-[1.5rem]" style={{ color: "var(--bk-brass)" }}>bcom.si</span>
          </a>
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Sections">
            {[
              ["What works today", "#live"],
              ["Themes", "#themes"],
              ["How it works", "#steps"],
              ["Pricing", "#pricing"],
              ["FAQ", "#faq"],
            ].map(([label, href]) => (
              <a key={href} href={href} className="rounded px-3 py-2 text-[0.98rem] font-medium no-underline hover:underline" style={{ color: "#f6ecc4", textDecorationColor: "var(--bk-brass)", textUnderlineOffset: "0.3em" }}>
                {label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <a href="https://admin.bcom.si" className="hidden rounded px-3 py-2 text-[0.98rem] font-medium sm:inline-block" style={{ color: "#f6ecc4" }}>Log in</a>
            <Link href="/signup" className="bk-btn bk-btn-gilt bk-btn-sm">Start free trial</Link>
          </div>
        </div>
      </header>

      <main>
        {/* ---------- Hero ---------- */}
        <section className="mx-auto grid max-w-7xl gap-12 px-5 pb-20 pt-14 sm:px-8 lg:grid-cols-12 lg:gap-8 lg:pb-28 lg:pt-20">
          <div className="lg:col-span-7">
            <p className="bk-pen text-2xl" style={{ color: "var(--bk-brass)" }} lang="hi">॥ शुभ लाभ ॥</p>
            <h1 className="bk-display mt-3 text-[clamp(2.6rem,6.6vw,5.4rem)]" style={{ color: "#f6ecc4" }}>
              Open your Indian online store{" "}
              <span className="relative inline-block" style={{ color: "var(--bk-brass)" }}>
                today.
                <PenUnderline className="absolute -bottom-2 left-0 h-3.5 w-full" />
              </span>
            </h1>
            <p className="bk-soft mt-7 max-w-[56ch] text-[1.15rem]">
              A themed storefront, cash on delivery and GST invoices in one admin, made for Indian D2C brands. Enter your
              firm&apos;s name and start your 14-day free trial.
            </p>
            <div className="mt-9">
              <SubdomainAvailabilityChecker platformDomain="bcom.si" variant="ledger" />
              <p className="bk-soft mt-4 text-[0.95rem]">
                14 days free · no card needed · plans from {inr(cheapest)} a month + GST
              </p>
            </div>
          </div>
          <div className="relative flex items-start justify-center lg:col-span-5 lg:justify-end">
            <LedgerDayBook />
          </div>
        </section>

        {/* ---------- Index: what works today ---------- */}
        <section id="live" className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-24">
          <div className="bk-rv max-w-3xl">
            <h2 className="bk-h2" style={{ color: "#f6ecc4" }}>Everything in this book works today.</h2>
            <p className="bk-soft mt-5 max-w-[60ch]">
              No roadmap in disguise. These are the entries a merchant can use the day they sign up. What is still being
              built sits at the foot of the page, marked Coming soon.
            </p>
          </div>

          <div className="bk-paper bk-corners bk-rv mt-12" style={{ lineHeight: "var(--bk-line)", paddingTop: "var(--bk-line)", paddingBottom: "var(--bk-line)" }}>
            <h3 className="bk-in bk-display text-2xl" style={{ lineHeight: "calc(var(--bk-line) * 2)" }}>Index of heads</h3>
            <dl>
              {INDEX_LIVE.map((e, i) => (
                <div key={e.head} className="bk-in grid gap-x-8 md:grid-cols-[12.5rem_1fr_4.5rem]" style={{ marginTop: "var(--bk-line)" }}>
                  <dt className="relative">
                    <span className="bk-num absolute right-full mr-[0.5rem] hidden text-[0.85rem] md:inline" style={{ color: "var(--bk-margin)", left: "calc(-1 * var(--bk-m) - 0.9rem + 0.3rem)", width: "calc(var(--bk-m) - 0.9rem)", textAlign: "right" }}>{i + 1}</span>
                    <span className="bk-display text-[1.25rem]">{e.head}</span>
                    <span className="bk-pen block" style={{ color: "var(--bk-ink-soft)" }}>{e.sub}</span>
                  </dt>
                  <dd className="bk-muted" style={{ color: "var(--bk-ink)" }}>{e.body}</dd>
                  <dd className="md:text-right">
                    <span className="bk-pen font-bold" style={{ color: "#1f5a2c" }}>✓ Live</span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="bk-rv mt-10">
            <h3 className="bk-display text-2xl" style={{ color: "#f6ecc4" }}>Coming soon</h3>
            <p className="bk-soft mt-1 max-w-[60ch]">Not live yet. We will announce each one when it works, not before.</p>
            <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {COMING_SOON.map((c) => (
                <li key={c.name} className="rounded px-4 py-3" style={{ border: "2px dashed rgb(246 236 196 / 0.45)" }}>
                  <p className="bk-display text-[1.1rem]">{c.name}</p>
                  <p className="bk-soft text-[0.95rem]">{c.note}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------- Pattern book (themes) ---------- */}
        <section id="themes" style={{ background: "var(--bk-cloth-deep)", borderTop: "3px double var(--bk-brass)", borderBottom: "3px double var(--bk-brass)" }}>
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-24">
            <div className="bk-rv max-w-3xl">
              <h2 className="bk-h2" style={{ color: "#f6ecc4" }}>Choose a pattern from the book.</h2>
              <p className="bk-soft mt-5 max-w-[60ch]">
                Start from a theme made for your niche, then make it yours in the editor. These are illustrations of the
                starting layouts.
              </p>
            </div>
            <ul className="mt-14 grid gap-10 md:grid-cols-3">
              {THEMES.map((t, i) => (
                <li key={t.code} className="bk-rv" style={{ transitionDelay: `${i * 90}ms` }}>
                  <div className="bk-swatch relative rounded p-4" style={{ background: "var(--bk-paper)", color: "var(--bk-ink)", boxShadow: "0 18px 30px -22px rgb(0 0 0 / 0.7)", rotate: `${i === 1 ? 0.8 : i === 0 ? -1 : 0.4}deg` }}>
                    <span className="bk-tape" aria-hidden="true" />
                    <div className="rounded p-3" style={{ background: t.ground, color: t.ink }}>
                      <div className="flex items-center justify-between">
                        <span className="bk-display text-sm">Your store</span>
                        <span className="flex gap-1" aria-hidden="true">{[0, 1, 2].map((d) => <span key={d} className="h-1.5 w-4 rounded-full" style={{ background: t.accent, opacity: 0.35 + d * 0.25 }} />)}</span>
                      </div>
                      <div className="mt-3 rounded p-3.5" style={{ background: t.tile }}>
                        <p className="text-[0.7rem] font-semibold uppercase tracking-wider" style={{ color: t.accent }}>New in</p>
                        <p className="bk-display mt-0.5 text-lg leading-tight">{t.name}</p>
                        <span className="mt-2.5 inline-block rounded px-2.5 py-1 text-[0.7rem] font-semibold" style={{ background: t.accent, color: t.ground }}>Shop now</span>
                      </div>
                      <div className="mt-2.5 grid grid-cols-3 gap-1.5" aria-hidden="true">
                        {[0, 1, 2].map((c) => <div key={c} className="aspect-[4/5] rounded" style={{ background: t.tile }} />)}
                      </div>
                    </div>
                  </div>
                  <h3 className="bk-display mt-5 text-xl" style={{ color: "#f6ecc4" }}>{t.name}</h3>
                  <p className="bk-soft text-sm">{t.industry}</p>
                  <p className="mt-1" style={{ color: "#f6ecc4" }}>{t.line}</p>
                  <Link href={`/signup?template=${t.code}`} className="bk-link mt-2 inline-block font-semibold" style={{ color: "var(--bk-brass)" }}>Start with this theme</Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------- Entries to open your khata (steps) ---------- */}
        <section id="steps" className="mx-auto max-w-4xl px-5 py-16 sm:px-8 lg:py-24">
          <div className="bk-rv">
            <h2 className="bk-h2" style={{ color: "#f6ecc4" }}>Four entries to open your khata.</h2>
          </div>
          <div className="bk-paper bk-corners bk-rv mt-12" style={{ lineHeight: "var(--bk-line)", paddingTop: "var(--bk-line)", paddingBottom: "var(--bk-line)" }}>
            <ol>
              {STEPS.map((s, i) => (
                <li key={s.title} className="bk-in relative" style={{ marginBottom: "var(--bk-line)" }}>
                  <span className="bk-num absolute text-[0.95rem]" style={{ left: "calc(-1 * var(--bk-m) - 0.9rem + 0.3rem)", width: "calc(var(--bk-m) - 0.9rem)", textAlign: "right", color: "var(--bk-margin)" }}>{i + 1}.</span>
                  <p className="bk-display text-[1.3rem]">{s.title}</p>
                  <p className="bk-pen text-[1.1rem]" style={{ color: "var(--bk-ink)" }}>{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ---------- Rate card (pricing) ---------- */}
        <section id="pricing" style={{ background: "var(--bk-cloth-deep)", borderTop: "3px double var(--bk-brass)" }}>
          <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8 lg:py-24">
            <div className="bk-rv flex flex-col justify-between gap-6 md:flex-row md:items-end">
              <div className="max-w-2xl">
                <h2 className="bk-h2" style={{ color: "#f6ecc4" }}>The rate card.</h2>
                <p className="bk-soft mt-5">Prices in rupees, plus GST. Every plan starts with a 14-day free trial.</p>
              </div>
              <div className="inline-flex rounded p-1" role="group" aria-label="Billing period" style={{ background: "var(--bk-cloth)", border: "2px solid var(--bk-brass-deep)" }}>
                {(["monthly", "yearly"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setInterval_(v)}
                    aria-pressed={interval === v}
                    className="min-h-[2.5rem] rounded px-4 font-semibold"
                    style={interval === v ? { background: "var(--bk-paper)", color: "var(--bk-ink)" } : { color: "#f6ecc4" }}
                  >
                    {v === "monthly" ? "Monthly" : "Yearly"}
                  </button>
                ))}
              </div>
            </div>

            <ul className="mt-12 grid gap-8 lg:grid-cols-3">
              {planList.map((p, i) => {
                const perMonth = interval === "monthly" ? p.monthlyPaise : p.yearlyPaise / 12;
                const saving = p.monthlyPaise * 12 - p.yearlyPaise;
                const products = num(p.limits.products);
                const orders = num(p.limits.orders_month);
                const staff = num(p.limits.staff_seats);
                const storage = num(p.limits.storage_mb);
                const domains = num(p.limits.custom_domains);
                const rows: [string, string][] = [
                  ...(products !== null ? [["Products", fmt(products)] as [string, string]] : []),
                  ...(orders !== null ? [["Orders a month", fmt(orders)] as [string, string]] : []),
                  ...(staff !== null ? [["Staff accounts", fmt(staff)] as [string, string]] : []),
                  ...(storage !== null ? [["Media storage", `${fmt(Math.round(storage / 1024))} GB`] as [string, string]] : []),
                  ...(domains !== null ? [["Custom domains (coming soon)", fmt(domains)] as [string, string]] : []),
                ];
                return (
                  <li key={p.code} className="bk-paper bk-corners bk-rv flex flex-col pb-6 pt-5" style={{ transitionDelay: `${i * 90}ms`, ["--bk-m" as string]: "1.5rem" } as React.CSSProperties}>
                    <div className="bk-in">
                      <h3 className="bk-display text-2xl">{p.name}</h3>
                      <p className="bk-num mt-2 flex items-end gap-2">
                        <span className="bk-display text-5xl">{inr(perMonth)}</span>
                        <span className="bk-pen pb-1.5 text-lg" style={{ color: "var(--bk-ink-soft)" }}>a month</span>
                      </p>
                      <p className="bk-pen bk-num min-h-[2rem] text-[1.05rem]" style={{ color: "var(--bk-ink-soft)" }}>
                        {interval === "yearly" ? `Billed ${inr(p.yearlyPaise)} a year${saving > 0 ? ` · you save ${inr(saving)}` : ""}` : "Billed monthly"}
                      </p>
                    </div>
                    <ul className="bk-in mt-4 flex-1" style={{ lineHeight: "var(--bk-line)" }}>
                      {rows.map(([label, value]) => (
                        <li key={label} className="flex items-baseline gap-2">
                          <span>{label}</span>
                          <span className="min-w-4 flex-1 translate-y-[-0.2em] border-b-2 border-dotted" style={{ borderColor: "var(--bk-ink-soft)" }} aria-hidden="true" />
                          <span className="bk-num font-semibold">{value}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="bk-in mt-6">
                      <Link href={`/signup?plan=${p.code}&interval=${interval}`} className="bk-btn w-full">Start free trial</Link>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="bk-rv mt-10">
              <p className="bk-display text-xl" style={{ color: "#f6ecc4" }}>Every plan includes</p>
              <ul className="mt-3 flex flex-wrap gap-2.5">
                {INCLUDED_IN_ALL.map((x) => (
                  <li key={x} className="rounded px-4 py-2" style={{ border: "1.5px solid var(--bk-brass)", color: "#f6ecc4" }}>✓ {x}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ---------- FAQ as remarks ---------- */}
        <section id="faq" className="mx-auto max-w-4xl px-5 py-16 sm:px-8 lg:py-24">
          <div className="bk-rv"><h2 className="bk-h2" style={{ color: "#f6ecc4" }}>Straight answers.</h2></div>
          <div className="bk-paper bk-corners bk-rv mt-10" style={{ lineHeight: "var(--bk-line)", paddingTop: "var(--bk-line)", paddingBottom: "var(--bk-line)" }}>
            {FAQS.map((f) => (
              <details key={f.q} className="bk-faq bk-in">
                <summary className="flex items-start gap-3 py-0 text-[1.15rem]" style={{ fontFamily: "var(--bk-display)" }}>
                  <span className="bk-tick mt-[0.1em] shrink-0 text-lg" style={{ color: "var(--bk-margin)" }} aria-hidden="true">▸</span>
                  {f.q}
                </summary>
                <p className="bk-pen text-[1.1rem]" style={{ color: "var(--bk-ink)", paddingBottom: "var(--bk-line)" }}>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ---------- Close ---------- */}
        <section className="px-5 pb-20 sm:px-8 lg:pb-28">
          <div className="bk-rv mx-auto max-w-5xl rounded-md px-6 py-14 text-center sm:px-12" style={{ border: "3px double var(--bk-brass)", background: "var(--bk-cloth-deep)" }}>
            <div className="mx-auto w-fit"><Seal size={64} /></div>
            <h2 className="bk-h2 mt-5" style={{ color: "#f6ecc4" }}>Open your khata today.</h2>
            <p className="bk-soft mx-auto mt-3 max-w-[48ch]">Pick a name and start the 14-day trial. No card needed.</p>
            <div className="mx-auto mt-8 flex max-w-xl justify-center text-left">
              <SubdomainAvailabilityChecker platformDomain="bcom.si" variant="ledger" />
            </div>
          </div>
        </section>
      </main>

      <footer style={{ background: "var(--bk-cloth-deep)", borderTop: "3px double var(--bk-brass)" }}>
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-5 py-12 sm:px-8 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Seal size={34} />
            <p className="bk-soft max-w-xs text-sm">Online stores for Indian D2C brands, with cash on delivery and GST built in.</p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Footer">
            {[
              ["What works today", "#live"],
              ["Themes", "#themes"],
              ["Pricing", "#pricing"],
              ["FAQ", "#faq"],
            ].map(([label, href]) => (
              <a key={href} href={href} className="bk-link" style={{ color: "#f6ecc4" }}>{label}</a>
            ))}
            <a href="https://admin.bcom.si" className="bk-link" style={{ color: "#f6ecc4" }}>Log in</a>
            <Link href="/signup" className="bk-link" style={{ color: "var(--bk-brass)" }}>Start free trial</Link>
          </nav>
        </div>
        <p className="bk-soft mx-auto max-w-7xl px-5 pb-10 text-xs sm:px-8">© {new Date().getFullYear()} bcom.si. Example data on this page is made up for illustration.</p>
      </footer>
    </div>
  );
}

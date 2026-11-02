import Link from "next/link";
import type { ReactNode } from "react";
import { SubdomainAvailabilityChecker } from "../SubdomainAvailabilityChecker.tsx";
import { FAQS } from "../landing/content.ts";
import { AiTabs } from "./AiTabs.tsx";
import { ArrowIcon, BrushIcon, CashIcon, GlobeIcon, ReceiptIcon, ReturnIcon, TagIcon, UsersIcon } from "./icons.tsx";
import { AdminWindow, BarsMock, CatalogMock, InvoiceMock, SegmentMock, ShipMock, ThemeMock } from "./mocks.tsx";

export function Hero() {
  return (
    <section className="hero">
      <div className="wrap hero-in">
        <div>
          <span className="stamp"><b />Ready today · AI agents coming soon</span>
          <h1>The agent-first <span className="nb">e-commerce</span> platform for Indian brands.</h1>
          <p className="lead">
            A complete online store you can open today: cash on delivery, GST invoices, themes, orders and returns. Built from day one for the AI shopping era, so selling through ChatGPT, Gemini and Claude arrives as each one launches in India.
          </p>
          <SubdomainAvailabilityChecker platformDomain="bcom.si" />
          <p className="fine">14-day free trial · Cash on delivery and GST invoices included</p>
        </div>
        <AdminWindow />
      </div>
    </section>
  );
}

const INCLUDED: Array<[string, ReactNode]> = [
  ["Cash on delivery", <CashIcon key="c" />],
  ["GST tax invoices", <ReceiptIcon key="r" />],
  ["Visual theme builder", <BrushIcon key="b" />],
  ["Returns and exchanges", <ReturnIcon key="x" />],
  ["Customers and segments", <UsersIcon key="u" />],
];

export function IncludedStrip() {
  return (
    <section className="strip" aria-label="Included on every plan">
      <div className="wrap strip-in">
        <span className="kick">Included on every plan</span>
        <ul>
          {INCLUDED.map(([label, icon]) => (
            <li key={label}>{icon}{label}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function Statement() {
  return (
    <section className="sec statement">
      <div className="wrap">
        <p className="rv">
          Selling online usually means a website, a payment link, a GST spreadsheet and a chat group. <span>BCOM puts all of it in one place, then gets your store ready for the way people will shop next.</span>
        </p>
      </div>
    </section>
  );
}

const SMALL: Array<{ title: string; body: string; art: ReactNode }> = [
  { title: "Customers and segments", body: "Know who is buying, tag them, build segments and import or export your list.", art: <SegmentMock /> },
  { title: "Shipping, orders, returns and exchanges", body: "Set your shipping zones and rates, confirm and ship orders, mark them delivered and handle returns and exchanges in one place.", art: <ShipMock /> },
  { title: "Intelligent analytics", body: "Understand what sells and who buys. Get reports on your sales, customers and orders generated for you.", art: <BarsMock /> },
  { title: "Themes and visual theme builder", body: "Start from a theme made for your niche. Drag, drop and edit blocks. No code.", art: <ThemeMock /> },
];

export function Features() {
  return (
    <section className="sec soft" id="ready">
      <div className="wrap">
        <div className="head rv">
          <span className="kick">Ready today</span>
          <h2>A complete store, built for how India sells.</h2>
          <p>Open a store today and start taking orders. No waiting for new features.</p>
        </div>
        <div className="joined bento rv">
          <article className="cell big">
            <div className="cell-t">
              <h3>Complete catalogue management</h3>
              <p>Products, variants, categories, collections and stock. SEO is built in, with sitemaps and structured data so search and answer engines can read your catalogue, and it is built for GEO.</p>
            </div>
            <div className="cell-art"><CatalogMock /></div>
          </article>
          <article className="cell big">
            <div className="cell-t">
              <h3>Payments and invoices</h3>
              <p>Accept all online payments, including UPI, cards and net banking, plus cash on delivery with a fee you set. Issue GST tax invoices with CGST, SGST or IGST and HSN on each line.</p>
            </div>
            <div className="cell-art"><InvoiceMock /></div>
          </article>
          {SMALL.map((c) => (
            <article className="cell sm" key={c.title}>
              <div className="cell-t">
                <h3>{c.title}</h3>
                <p>{c.body}</p>
              </div>
              <div className="cell-art">{c.art}</div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

const STEPS: Array<[string, string, ReactNode]> = [
  ["Claim your name", "Pick a name and your store lives on yourname.bcom.si.", <GlobeIcon key="g" />],
  ["Add your products", "Add products, variants, categories and stock.", <TagIcon key="t" />],
  ["Make it yours", "Pick a theme made for your niche and edit blocks without code.", <BrushIcon key="b" />],
  ["Take orders", "Set shipping rates and your COD fee, then share your store link.", <ReceiptIcon key="r" />],
];

export function Steps() {
  return (
    <section className="steps" aria-label="How to open a store">
      <div className="wrap">
        <ol>
          {STEPS.map(([title, body, icon], i) => (
            <li key={title} className="rv">
              <span className="step-n">{icon}<code>0{i + 1}</code></span>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function AiSection() {
  return (
    <section className="sec" id="ai">
      <div className="wrap">
        <div className="head rv">
          <span className="kick">Built for the AI shopping era</span>
          <h2>People now shop by asking. Your store will be ready.</h2>
          <p>Shoppers are starting to ask ChatGPT, Gemini and Claude what to buy. These features are designed in and arrive as each assistant launches shopping in India. Stores on BCOM get them first.</p>
        </div>
        <AiTabs />
      </div>
    </section>
  );
}

const STANDARDS: Array<[string, string]> = [
  ["MCP", "Tools for assistants"],
  ["UCP", "Google commerce"],
  ["ACP", "OpenAI commerce"],
  ["AP2", "Safe agent payments"],
  ["A2A", "Agent to agent"],
];

export function Standards() {
  return (
    <section className="band">
      <div className="wrap band-in">
        <h2 className="rv">Designed for the open standards behind AI commerce.</h2>
        <ul className="stds rv">
          {STANDARDS.map(([name, note]) => (
            <li key={name}><b>{name}</b><span>{note}</span></li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function Faq() {
  return (
    <section className="sec soft" id="faq">
      <div className="wrap faq-in">
        <div className="head rv">
          <span className="kick">FAQ</span>
          <h2>Straight answers.</h2>
        </div>
        <div className="faq rv">
          {FAQS.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FinalCta({ plansLink = true }: { plansLink?: boolean }) {
  return (
    <section className="band cta">
      <div className="wrap">
        <h2>Open your store today. Be ready for what comes next.</h2>
        <p>14-day free trial. No card needed to start.</p>
        <SubdomainAvailabilityChecker platformDomain="bcom.si" />
        {plansLink && <Link className="textlink" href="/pricing">Compare plans <ArrowIcon size={15} /></Link>}
      </div>
    </section>
  );
}

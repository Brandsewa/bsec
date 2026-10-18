import Link from "next/link";
import { SubdomainAvailabilityChecker } from "../../SubdomainAvailabilityChecker.tsx";
import { FAQS } from "../content.ts";
import { NegotiationDemo } from "../NegotiationDemo.tsx";

export function SalesRep() {
  return (
    <section className="sec" style={{ background: "var(--bg2)", borderBlock: "1px solid var(--line)" }}>
      <div className="wrap">
        <NegotiationDemo />
      </div>
    </section>
  );
}

export function Faq() {
  return (
    <section className="sec" id="faq" style={{ paddingTop: 20 }}>
      <div className="wrap">
        <div className="rv" style={{ textAlign: "center" }}>
          <span className="eyebrow">FAQ</span>
          <h2>Straight <i className="s gt">answers.</i></h2>
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

export function FinalCta() {
  return (
    <section className="cta">
      <div className="aurora" aria-hidden="true"><i /><i /><i /></div>
      <div className="wrap">
        <span className="pill am"><b />14-day free trial</span>
        <h2>Open your store before the <i className="s gt">AI shopping wave.</i></h2>
        <div style={{ maxWidth: 540, margin: "36px auto 0", textAlign: "left" }}>
          <SubdomainAvailabilityChecker platformDomain="bcom.si" variant="lp" />
        </div>
        <div className="word" aria-hidden="true">Bs Commerce</div>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer>
      <div className="wrap">
        <span>© {new Date().getFullYear()} Bs Commerce. Chats, brands and figures on this page are illustrations.</span>
        <div className="fl">
          <a href="#how">How it works</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">FAQ</a>
          <a href="https://admin.bcom.si">Log in</a>
          <Link href="/signup">Start free trial</Link>
        </div>
      </div>
    </footer>
  );
}

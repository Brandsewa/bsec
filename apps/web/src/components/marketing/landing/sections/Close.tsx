import { SubdomainAvailabilityChecker } from "../../SubdomainAvailabilityChecker.tsx";
import { FAQS } from "../content.ts";

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
        <h2>Open your store today. <i className="s gt">Be ready for what comes next.</i></h2>
        <div style={{ maxWidth: 540, margin: "36px auto 0", textAlign: "left" }}>
          <SubdomainAvailabilityChecker platformDomain="bcom.si" variant="lp" />
        </div>
        
      </div>
    </section>
  );
}

import { SubdomainAvailabilityChecker } from "../../SubdomainAvailabilityChecker.tsx";
import { PhoneDemo } from "../PhoneDemo.tsx";

export function Hero() {
  return (
    <header className="hero">
      <div className="aurora" aria-hidden="true"><i /><i /><i /></div>
      <div className="grid-bg" aria-hidden="true" />
      <div className="wrap herog">
        <div className="htxt">
          <span className="pill"><b />Ready today · AI agents coming soon</span>
          <h1>
            The <i className="s gt">agent-first</i> e-commerce platform for Indian brands.
          </h1>
          <p className="lead">
            A complete online store you can open today: cash on delivery, GST invoices, themes, orders and returns. Built from day one for the AI shopping era, so selling through ChatGPT, Gemini and Claude arrives as each one launches in India.
          </p>
          <SubdomainAvailabilityChecker platformDomain="bcom.si" />
          <p className="fine">14-day free trial · Cash on delivery and GST invoices included</p>
        </div>
        <PhoneDemo />
      </div>
    </header>
  );
}

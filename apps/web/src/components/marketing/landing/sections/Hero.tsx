import { SubdomainAvailabilityChecker } from "../../SubdomainAvailabilityChecker.tsx";
import { PhoneDemo } from "../PhoneDemo.tsx";

export function Hero() {
  return (
    <header className="hero">
      <div className="aurora" aria-hidden="true"><i /><i /><i /></div>
      <div className="grid-bg" aria-hidden="true" />
      <div className="wrap herog">
        <div className="htxt">
          <span className="pill am"><b />Indian stores first in line</span>
          <h1>
            Be found where people now <i className="s gt">shop.</i> Inside <i className="s">AI chats.</i>
          </h1>
          <p className="lead">
            Bs Commerce stores are built for ChatGPT, Gemini and Claude. Get discovered, recommended and checked out by AI assistants, starting with India.
          </p>
          <SubdomainAvailabilityChecker platformDomain="bcom.si" variant="lp" />
          <p className="fine">14-day free trial · Cash on delivery and GST invoices included</p>
        </div>
        <PhoneDemo />
      </div>
    </header>
  );
}

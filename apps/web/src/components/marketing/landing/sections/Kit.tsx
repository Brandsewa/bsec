import { StandardsStrip } from "./Story.tsx";

/** "Coming soon" marker for features that are designed in but not released yet. */
const soon = (text = "Coming soon") => (
  <span className="pill am">
    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
    {text}
  </span>
);

const SOURCES: Array<[string, string, string]> = [
  ["ChatGPT", "#4ade80", "78%"],
  ["Gemini", "#60a5fa", "56%"],
  ["Claude", "#fbbf24", "24%"],
  ["Web", "#a78bfa", "38%"],
];

export function AiEra() {
  return (
    <section className="sec" id="ai" style={{ background: "var(--bg2)", borderBlock: "1px solid var(--line)" }}>
      <div className="wrap">
        <div className="rv" style={{ maxWidth: 780 }}>
          <span className="eyebrow">Built for the AI shopping era</span>
          <h2>People now shop by asking. <i className="s gt">Your store will be ready.</i></h2>
          <p className="lead">
            Shoppers are starting to ask ChatGPT, Gemini and Claude what to buy. These features are designed in and arrive as each assistant launches shopping in India. Stores on Bs Commerce get them first.
          </p>
        </div>
        <div className="bento">
          <div className="spot bc c1 rv">
            {soon()}
            <h3>A catalog assistants can understand</h3>
            <p>Products are read and enriched with material, fit, occasion and tax code, so assistants can match them to real questions.</p>
            <div className="tags">
              <span>material <em>wool blend</em></span><span>fit <em>relaxed</em></span><span>occasion <em>gifting</em></span><span>season <em>winter</em></span>
              <span>HSN <em>6110</em></span><span>colour <em>grey</em></span>
            </div>
          </div>
          <div className="spot bc c2 rv d1">
            {soon("Built for the future")}
            <h3>Prices that can&rsquo;t be invented</h3>
            <p>Each AI cart is locked for a short window with your price, GST and shipping.</p>
            <div className="cdr" aria-hidden="true">
              <svg viewBox="0 0 128 128" width="128" height="128">
                <defs><linearGradient id="lp-rg"><stop offset="0" stopColor="#a78bfa" /><stop offset="1" stopColor="#fbbf24" /></linearGradient></defs>
                <circle className="bg" cx="64" cy="64" r="56" /><circle className="fg" cx="64" cy="64" r="56" />
              </svg>
              <div>10:00</div>
            </div>
          </div>
          <div className="spot bc c3 rv">
            {soon()}
            <h3>Pay inside the chat</h3>
            <p>UPI and cards inside the assistant, with cash on delivery always an option.</p>
            <div className="upi"><span className="p">UPI</span><span>Cards</span><span>Cash on delivery</span></div>
          </div>
          <div className="spot bc c4 rv d1">
            {soon("Built for the future")}
            <h3>An AI sales rep for your store</h3>
            <p>A buyer&rsquo;s assistant can ask for a bundle price. Your store answers inside the limits you set, for example up to 10% off orders above ₹2,500.</p>
          </div>
          <div className="spot bc c5 rv d2">
            {soon()}
            <h3>See which assistant sold</h3>
            <p>Searches, carts and revenue by source: ChatGPT, Gemini, Claude and web.</p>
            <div className="mini" aria-hidden="true">
              {SOURCES.map(([name, color, w]) => (
                <div className="br" key={name}>
                  <span>{name}</span>
                  <div className="t"><i style={{ ["--c" as string]: color, ["--w" as string]: w } as React.CSSProperties} /></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <StandardsStrip />
    </section>
  );
}

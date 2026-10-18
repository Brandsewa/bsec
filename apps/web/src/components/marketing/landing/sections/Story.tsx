const STANDARDS: Array<[string, string]> = [
  ["MCP", "tools for assistants"],
  ["UCP", "Google commerce"],
  ["ACP", "OpenAI commerce"],
  ["AP2", "safe agent payments"],
  ["A2A", "agent to agent"],
];

export function StandardsStrip() {
  return (
    <div className="stdband">
      <div className="wrap">
        <div className="std-h"><span className="eyebrow">Built on open standards for AI commerce</span></div>
      </div>
      <div className="std">
        <div className="tr">
          {[...STANDARDS, ...STANDARDS].map(([name, note], i) => (
            <span key={i} aria-hidden={i >= STANDARDS.length ? true : undefined}>
              {name}<small>{note}</small>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

const grey = "linear-gradient(135deg,#64748b,#334155)";

export function Shift() {
  return (
    <section className="sec">
      <div className="wrap">
        <div className="shiftg">
          <div className="rv">
            <span className="eyebrow">The shift</span>
            <h2>Page one is now a <i className="s gt">sentence.</i></h2>
            <p className="lead">
              People used to scroll ten results and open five tabs. Now they ask an assistant, and it answers with a short list. If your store isn&rsquo;t readable by AI, you&rsquo;re not on it.
            </p>
          </div>
          <div className="vs rv d1">
            <div className="old" aria-hidden="true">
              <div className="cap">Search, before</div>
              <div className="l t" /><div className="l" /><div className="l" style={{ width: "70%" }} />
              <div className="l t" /><div className="l" /><div className="l" style={{ width: "80%" }} />
              <div className="l t" /><div className="l" />
            </div>
            <div className="new">
              <div className="cap">Ask, now</div>
              <div className="pick"><span className="im" style={{ background: "linear-gradient(135deg,#f59e0b,#b45309)" }} />Your hoodie<b>#1</b></div>
              <div className="pick"><span className="im" style={{ background: grey }} />Store B<b>#2</b></div>
              <div className="pick"><span className="im" style={{ background: grey }} />Store C<b>#3</b></div>
            </div>
          </div>
        </div>
        <div className="three">
          <div className="spot rv"><div className="n">01</div><h3>People ask, not search</h3><p>&ldquo;Find me&rdquo;, &ldquo;compare these&rdquo;, &ldquo;buy that&rdquo;. Shopping starts in a chat box now.</p></div>
          <div className="spot rv d1"><div className="n">02</div><h3>A handful of picks</h3><p>Assistants recommend a short list. Being on it is the new page one.</p></div>
          <div className="spot rv d2"><div className="n">03</div><h3>Readable or invisible</h3><p>Prices, stock and delivery have to be machine-readable to be recommended.</p></div>
        </div>
      </div>
    </section>
  );
}

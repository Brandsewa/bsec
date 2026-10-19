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
        <div className="std-h"><span className="eyebrow">Designed for the open standards behind AI commerce</span></div>
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

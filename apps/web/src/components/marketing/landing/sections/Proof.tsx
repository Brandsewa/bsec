import { STEPS, THEMES } from "../content.ts";

const INDIA: Array<[string, string, string, string]> = [
  ["₹", "Cash on delivery", "Order confirmation and risk checks to cut returns to origin.", "d0"],
  ["GST", "Invoices that add up", "CGST, SGST and IGST worked out on every order.", "d1"],
  ["PIN", "Pincode checks", "Shoppers know you deliver before they commit.", "d2"],
  ["Aa", "Visual theme builder", "Drag, drop and edit blocks. No code.", "d0"],
  ["↩", "Returns and exchanges", "Handled in one place, start to finish.", "d1"],
  ["&", "Customers and segments", "Know who is buying and who is drifting away.", "d2"],
];

export function India() {
  return (
    <section className="sec light" id="india">
      <div className="wrap">
        <div className="rv" style={{ maxWidth: 820 }}>
          <span className="eyebrow">Built for India</span>
          <h2>The AI layer sits on a store made for <i className="s gt">how India sells.</i></h2>
        </div>
        <div className="ig">
          {INDIA.map(([glyph, title, body, d], i) => (
            <div key={title} className={`ii rv ${d === "d0" ? "" : d}`}>
              <div className="n">0{i + 1}</div>
              <div className="gl" aria-hidden="true">{glyph}</div>
              <h3>{title}</h3>
              <p>{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

interface ThemeLook { cls: string; line: string; nav: string }
const DEFAULT_LOOK: ThemeLook = { cls: "a", line: "Quiet, considered.", nav: "Your store" };
const THEME_LOOK: Record<string, ThemeLook> = {
  "starter-minimal": DEFAULT_LOOK,
  "fashion-editorial": { cls: "b", line: "The new season.", nav: "YOURSTORE" },
  "gourmet-artisan": { cls: "c", line: "Warm and rich.", nav: "Your store" },
};

export function Themes() {
  return (
    <section className="sec">
      <div className="wrap">
        <div className="rv" style={{ maxWidth: 760 }}>
          <span className="eyebrow">Themes</span>
          <h2>Start from a look made for <i className="s gt">your niche.</i></h2>
          <p className="lead">Pick one, change anything in the editor, make it yours.</p>
        </div>
        <div className="themes">
          {THEMES.map((t, i) => {
            const look = THEME_LOOK[t.code] ?? DEFAULT_LOOK;
            return (
              <div key={t.code} className={`spot th rv ${i === 1 ? "d1" : i === 2 ? "d2" : ""}`}>
                <div className={`pv ${look.cls}`} aria-hidden="true">
                  <div className="nv"><span>{look.nav}</span><span>Shop · Cart</span></div>
                  <div className="hr">{look.line}</div>
                  <div className="rw"><i /><i /><i /></div>
                </div>
                <div className="t"><h3>{t.name}</h3><p>{t.line}</p></div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function Launch() {
  return (
    <section className="sec" style={{ background: "var(--bg2)", borderBlock: "1px solid var(--line)" }}>
      <div className="wrap">
        <div className="rv" style={{ maxWidth: 760 }}>
          <span className="eyebrow">Launch</span>
          <h2>From a name to your <i className="s gt">first order.</i></h2>
        </div>
        <div className="ls">
          {STEPS.map((s, i) => (
            <div key={s.title} className={`spot rv ${i === 1 ? "d1" : i === 2 ? "d2" : i === 3 ? "d3" : ""}`}>
              <div className="n">{i + 1}</div>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

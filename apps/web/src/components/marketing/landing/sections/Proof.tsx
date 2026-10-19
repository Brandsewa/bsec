import { THEMES } from "../content.ts";

const READY: Array<[string, string, string, string]> = [
  ["₹", "Cash on delivery", "Order confirmation and a COD fee you set, to keep returns to origin down.", "d0"],
  ["GST", "GST tax invoices", "CGST, SGST and IGST worked out from your state and your customer's, with HSN on each line.", "d1"],
  ["Aa", "Visual theme builder", "Start from a theme made for your niche. Drag, drop and edit blocks. No code.", "d2"],
  ["↩", "Orders, returns and exchanges", "Confirm, ship and mark delivered. Handle returns and exchanges in one place.", "d0"],
  ["&", "Customers and segments", "Know who is buying, tag them, build segments and import or export your list.", "d1"],
  ["@", "Your storefront, your link", "A store on yourname.bcom.si you can share on Google, Instagram, WhatsApp and anywhere else.", "d2"],
];

export function India() {
  return (
    <section className="sec light" id="ready">
      <div className="wrap">
        <div className="rv" style={{ maxWidth: 820 }}>
          <span className="eyebrow">Ready today</span>
          <h2>A complete store, <i className="s gt">built for how India sells.</i></h2>
          <p className="lead">Open a store today and start taking orders. No waiting for new features.</p>
        </div>
        <div className="ig">
          {READY.map(([glyph, title, body, d], i) => (
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

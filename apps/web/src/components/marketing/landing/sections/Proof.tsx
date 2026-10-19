const READY: Array<[string, string, string, string]> = [
  ["SEO", "Complete catalogue management", "Products, variants, categories, collections and stock. SEO is built in, with sitemaps and structured data so search and answer engines can read your catalogue, and it is built for GEO.", "d0"],
  ["&", "Customers and segments", "Know who is buying, tag them, build segments and import or export your list.", "d1"],
  ["Aa", "Visual theme builder", "Start from a theme made for your niche. Drag, drop and edit blocks. No code.", "d2"],
  ["↩", "Shipping, orders, returns and exchanges", "Set your shipping zones and rates, confirm and ship orders, mark them delivered and handle returns and exchanges in one place.", "d0"],
  ["COD", "Cash on delivery and GST invoices", "Take COD orders with a fee you set, and issue tax invoices with CGST, SGST or IGST and HSN on each line.", "d1"],
  ["₹", "Finance", "Track your sales, income and expenses, and get GST-ready figures and reports for your books.", "d2"],
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

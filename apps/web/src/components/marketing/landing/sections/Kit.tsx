const pill = (text: string, amber = false) => (
  <span className={`pill ${amber ? "am" : ""}`}><b />{text}</span>
);

export function Kit() {
  return (
    <section className="sec" id="kit">
      <div className="wrap">
        <div className="rv" style={{ maxWidth: 760 }}>
          <span className="eyebrow">What every store gets</span>
          <h2>An AI-ready store, <i className="s gt">out of the box.</i></h2>
        </div>
        <div className="bento">
          <div className="spot bc c1 rv">
            {pill("Built in")}
            <h3>A catalog assistants actually understand</h3>
            <p>Upload a product and we read the photos and description, then fill in material, fit, occasion and tax code, so assistants match it to real questions.</p>
            <div className="tags">
              <span>material <em>wool blend</em></span><span>fit <em>relaxed</em></span><span>occasion <em>gifting</em></span><span>season <em>winter</em></span>
              <span>HSN <em>6110</em></span><span>colour <em>grey</em></span><span>care <em>machine wash</em></span>
            </div>
          </div>
          <div className="spot bc c2 rv d1">
            {pill("Indian stores first", true)}
            <h3>Prices that can&rsquo;t be invented</h3>
            <p>Each cart is locked for a short window with your price, GST and shipping.</p>
            <div className="cdr" aria-hidden="true">
              <svg viewBox="0 0 128 128" width="128" height="128">
                <defs><linearGradient id="lp-rg"><stop offset="0" stopColor="#a78bfa" /><stop offset="1" stopColor="#fbbf24" /></linearGradient></defs>
                <circle className="bg" cx="64" cy="64" r="56" /><circle className="fg" cx="64" cy="64" r="56" />
              </svg>
              <div>10:00</div>
            </div>
          </div>
          <div className="spot bc c3 rv">
            {pill("Built in")}
            <h3>Delivery by pincode</h3>
            <p>Shoppers hear if you reach them before they commit.</p>
            <div className="pin"><span className="f">411001</span><span className="r">✓ Friday · free</span></div>
          </div>
          <div className="spot bc c4 rv d1">
            {pill("Indian stores first", true)}
            <h3>Pay with UPI, inside the chat</h3>
            <p>Built around how India pays, with COD still one tap away.</p>
            <div className="upi"><span className="p">UPI</span><span>Cash on delivery</span><span>Cards</span></div>
          </div>
          <div className="spot bc c5 rv d2">
            {pill("Preview")}
            <h3>See which assistant sold</h3>
            <p>Searches, carts and revenue by source. Details below.</p>
            <div className="tags" style={{ marginTop: 20 }}><span>ChatGPT</span><span>Gemini</span><span>Claude</span><span>Web</span></div>
          </div>
        </div>
      </div>
    </section>
  );
}

const SOURCES: Array<[string, string, string, string]> = [
  ["ChatGPT", "#4ade80", "78%", "₹38k"],
  ["Gemini", "#60a5fa", "56%", "₹27k"],
  ["Claude", "#fbbf24", "24%", "₹11k"],
  ["Web", "#a78bfa", "38%", "₹18k"],
];

export function Visibility() {
  return (
    <section className="sec">
      <div className="wrap">
        <div className="negg">
          <div className="win rv" style={{ order: 2 }}>
            <div className="wbar"><span className="dots"><i /><i /><i /></span><span className="wtag" style={{ marginLeft: 0 }}>AI visibility · Sample data</span></div>
            <div className="dash">
              <div className="kp">
                <div><small>Searches</small><strong>1,284</strong><em>↑ 24%</em></div>
                <div><small>Carts</small><strong>212</strong><em>↑ 11%</em></div>
                <div><small>Revenue</small><strong>₹94k</strong><em>↑ 18%</em></div>
              </div>
              <div className="chart" aria-hidden="true">
                <svg viewBox="0 0 400 150" preserveAspectRatio="none">
                  <defs><linearGradient id="lp-ag" x1="0" x2="1"><stop offset="0" stopColor="#a78bfa" /><stop offset="1" stopColor="#f472b6" /></linearGradient></defs>
                  <path className="ln" stroke="url(#lp-ag)" d="M0 120 C40 112 60 100 95 104 S150 70 190 76 S250 40 290 52 S350 20 400 14" />
                </svg>
              </div>
              <div>
                {SOURCES.map(([name, color, w, amount]) => (
                  <div className="br" key={name}>
                    <span>{name}</span>
                    <div className="t"><i style={{ ["--c" as string]: color, ["--w" as string]: w } as React.CSSProperties} /></div>
                    <b>{amount}</b>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="rv">
            <span className="eyebrow">AI visibility</span>
            <h2>Know which assistant <i className="s gt">brought the sale.</i></h2>
            <p className="lead">See searches, carts and revenue by source, so you know where to invest. AI orders land next to your web orders, in one dashboard.</p>
            <p style={{ marginTop: 26 }}>{pill("Preview")}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

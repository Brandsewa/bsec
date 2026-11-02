import { BoxIcon, BrushIcon, ChartIcon, CheckIcon, GridIcon, ReceiptIcon, TagIcon, TruckIcon, UsersIcon } from "./icons.tsx";

/** Flat product illustrations built from markup, so they follow the theme and stay sharp. All data is sample data. */

const ADMIN_NAV: Array<[string, typeof GridIcon]> = [
  ["Overview", GridIcon],
  ["Orders", ReceiptIcon],
  ["Products", TagIcon],
  ["Customers", UsersIcon],
  ["Themes", BrushIcon],
];

const STATS: Array<[string, string, string]> = [
  ["Orders", "38", "+6 today"],
  ["Sales", "₹1.28L", "+18%"],
  ["To ship", "12", "4 COD"],
];

const ORDERS: Array<[string, string, string, string]> = [
  ["#1042", "Wool throw, grey", "₹2,100", "COD"],
  ["#1041", "Darjeeling tea, 250 g", "₹640", "Paid"],
  ["#1040", "Linen shirt, M", "₹1,499", "Shipped"],
];

export function AdminWindow() {
  return (
    <div className="win" aria-hidden="true">
      <div className="win-bar">
        <span className="dots"><i /><i /><i /></span>
        <span className="win-url">admin.bcom.si</span>
        <span className="win-tag">Sample data</span>
      </div>
      <div className="win-body">
        <div className="win-side">
          {ADMIN_NAV.map(([label, Icon], i) => (
            <span key={label} className={i === 0 ? "on" : ""}><Icon size={15} />{label}</span>
          ))}
        </div>
        <div className="win-main">
          <p className="win-h">Overview</p>
          <div className="stats">
            {STATS.map(([k, v, d]) => (
              <div key={k}>
                <small>{k}</small>
                <strong>{v}</strong>
                <em>{d}</em>
              </div>
            ))}
          </div>
          <div className="spark">
            <small>Sales, last 14 days</small>
            <svg viewBox="0 0 300 64" preserveAspectRatio="none">
              <polyline vectorEffect="non-scaling-stroke" points="0,50 23,46 46,48 69,38 92,42 115,32 138,36 161,26 184,30 207,20 230,24 253,14 276,17 300,8" />
            </svg>
          </div>
          <div className="rows">
            {ORDERS.map(([id, name, price, state]) => (
              <div key={id}>
                <code>{id}</code>
                <span>{name}</span>
                <b>{price}</b>
                <small>{state}</small>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const PRODUCTS: Array<[string, string, string]> = [
  ["Wool throw", "3 variants", "₹2,000"],
  ["Linen shirt", "6 variants", "₹1,499"],
  ["Darjeeling tea", "2 variants", "₹640"],
];

export function CatalogMock() {
  return (
    <div className="mock" aria-hidden="true">
      <div className="mock-head"><span>Products</span><small>SEO on</small></div>
      {PRODUCTS.map(([name, variants, price]) => (
        <div className="prod" key={name}>
          <i><BoxIcon size={16} /></i>
          <span>{name}<small>{variants}</small></span>
          <b>{price}</b>
        </div>
      ))}
    </div>
  );
}

const INVOICE: Array<[string, string]> = [
  ["Taxable value", "₹2,000.00"],
  ["CGST 2.5%", "₹50.00"],
  ["SGST 2.5%", "₹50.00"],
];

export function InvoiceMock() {
  return (
    <div className="mock" aria-hidden="true">
      <div className="mock-head"><span>Tax invoice</span><small>HSN 6110</small></div>
      {INVOICE.map(([k, v]) => (
        <div className="kv" key={k}><span>{k}</span><b>{v}</b></div>
      ))}
      <div className="kv total"><span>Total</span><b>₹2,100.00</b></div>
    </div>
  );
}

export function SegmentMock() {
  return (
    <div className="mock tiny" aria-hidden="true">
      {["Repeat buyers", "New this month", "COD only"].map((s) => (
        <div className="kv" key={s}><span><UsersIcon size={14} />{s}</span></div>
      ))}
    </div>
  );
}

export function ShipMock() {
  return (
    <div className="mock tiny" aria-hidden="true">
      {["Confirmed", "Shipped"].map((s) => (
        <div className="kv" key={s}><span><CheckIcon size={14} />{s}</span></div>
      ))}
      <div className="kv faint"><span><TruckIcon size={14} />Delivered</span></div>
    </div>
  );
}

export function BarsMock() {
  return (
    <div className="mock tiny bars" aria-hidden="true">
      <ChartIcon size={15} />
      <div>
        {[34, 52, 44, 70, 58, 84, 100].map((h, i) => (
          <i key={i} style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  );
}

export function ThemeMock() {
  return (
    <div className="mock tiny blocks" aria-hidden="true">
      <i className="b1" />
      <div><i /><i /><i /></div>
    </div>
  );
}

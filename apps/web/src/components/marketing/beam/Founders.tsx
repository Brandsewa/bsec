/**
 * Two columns of floating founder cards drifting upward, faded at the top and bottom. The people and stores are made
 * up for illustration (the page footer says so; PRODUCT.md forbids invented proof), and the strip is hidden from
 * assistive tech because it carries no information.
 */
interface Founder {
  name: string;
  store: string;
  city: string;
  tint: string;
}

const COL_A: Founder[] = [
  { name: "Ananya Rao", store: "Kaveri Handlooms", city: "Bengaluru", tint: "#8f8dff" },
  { name: "Imran Shaikh", store: "Dhaaga Denim", city: "Mumbai", tint: "#6fb6ff" },
  { name: "Meera Nair", store: "Spice Route Pantry", city: "Kochi", tint: "#b48dff" },
  { name: "Rohan Bedi", store: "Bedi Leather Co.", city: "Kanpur", tint: "#7fd6c2" },
];
const COL_B: Founder[] = [
  { name: "Tanvi Kulkarni", store: "Mrida Ceramics", city: "Pune", tint: "#ff9bb0" },
  { name: "Harpreet Gill", store: "Gill Organics", city: "Ludhiana", tint: "#8f8dff" },
  { name: "Sana Qureshi", store: "Attar & Co.", city: "Lucknow", tint: "#ffc58d" },
  { name: "Vikram Joshi", store: "Joshi Tea Estate", city: "Darjeeling", tint: "#6fb6ff" },
];

function Card({ f }: { f: Founder }) {
  return (
    <div className="bm-founder">
      <span className="bm-founder-av" style={{ background: f.tint }}>{f.name.charAt(0)}</span>
      <span className="min-w-0">
        <span className="bm-founder-name">{f.name}</span>
        <span className="bm-founder-meta">{f.store} · {f.city}</span>
      </span>
    </div>
  );
}

function Column({ items, className }: { items: Founder[]; className: string }) {
  // The list is rendered twice so the -50% translate loops without a jump.
  return (
    <div className={`bm-founders-col ${className}`}>
      <div className="bm-founders-track">
        {[...items, ...items].map((f, i) => <Card key={`${f.name}-${i}`} f={f} />)}
      </div>
    </div>
  );
}

export function Founders() {
  return (
    <div className="bm-founders" aria-hidden="true">
      <Column items={COL_A} className="bm-founders-a" />
      <Column items={COL_B} className="bm-founders-b" />
    </div>
  );
}

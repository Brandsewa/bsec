/**
 * Landing page content. Every claim here is something a merchant can do today (verified against the repository on
 * 2026-10-04, see apps/web/PRODUCT.md). Anything not live is shown as "Coming soon" and never described as available.
 */

export interface LandingPlan {
  code: string;
  name: string;
  monthlyPaise: number;
  yearlyPaise: number;
  limits: Record<string, unknown>;
}

/** Used only when the plans table cannot be read (build time, outage). Mirrors migration 0012 and is replaced by live data. */
export const FALLBACK_PLANS: LandingPlan[] = [
  { code: "starter", name: "Starter", monthlyPaise: 99900, yearlyPaise: 999000, limits: { products: 500, staff_seats: 2, storage_mb: 5120, orders_month: 300, custom_domains: 1 } },
  { code: "growth", name: "Growth", monthlyPaise: 249900, yearlyPaise: 2499000, limits: { products: 5000, staff_seats: 5, storage_mb: 25600, orders_month: 3000, custom_domains: 3 } },
  { code: "pro", name: "Pro", monthlyPaise: 599900, yearlyPaise: 5999000, limits: { products: 25000, staff_seats: 15, storage_mb: 102400, orders_month: 20000, custom_domains: 10 } },
];

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const fmt = (n: number) => n.toLocaleString("en-IN");

/** Plan bullets come from the plan's own limits, so the page can never drift from what the plan enforces. */
export function planBullets(limits: Record<string, unknown>): string[] {
  const out: string[] = [];
  const products = num(limits.products);
  const staff = num(limits.staff_seats);
  const storageMb = num(limits.storage_mb);
  const orders = num(limits.orders_month);
  const domains = num(limits.custom_domains);
  if (products !== null) out.push(`Up to ${fmt(products)} products`);
  if (orders !== null) out.push(`${fmt(orders)} orders a month`);
  if (staff !== null) out.push(`${fmt(staff)} staff ${staff === 1 ? "account" : "accounts"}`);
  if (storageMb !== null) out.push(`${fmt(Math.round(storageMb / 1024))} GB media storage`);
  if (domains !== null) out.push(`${fmt(domains)} custom ${domains === 1 ? "domain" : "domains"} (coming soon)`);
  return out;
}

export const INCLUDED_IN_ALL = [
  "Cash on delivery checkout",
  "GST tax invoices",
  "Visual theme builder",
  "Returns and exchanges",
  "Customers and segments",
  "14-day free trial",
];

export const COMING_SOON = [
  { name: "Online payments", note: "UPI and cards through Razorpay" },
  { name: "Shiprocket", note: "Labels and live tracking" },
  { name: "WhatsApp and SMS", note: "Order and dispatch alerts" },
  { name: "Custom domains", note: "Your own .in or .com" },
  { name: "Invoice PDFs", note: "Download and share" },
];

export const THEMES = [
  {
    code: "starter-minimal",
    name: "Minimalist Essential",
    industry: "Handicrafts and general retail",
    line: "Quiet typography and fast product grids.",
    ground: "#e9dfca",
    ink: "#3a2a16",
    accent: "#a2602a",
    tile: "#d9c8a6",
  },
  {
    code: "fashion-editorial",
    name: "Fashion Editorial",
    industry: "Apparel and accessories",
    line: "Lookbook heroes and lifestyle collections.",
    ground: "#15171f",
    ink: "#f3ece4",
    accent: "#e9b9a6",
    tile: "#272a36",
  },
  {
    code: "gourmet-artisan",
    name: "Gourmet Artisan",
    industry: "Food, tea and organic goods",
    line: "A warm palette made for the pantry.",
    ground: "#113626",
    ink: "#f6ecd2",
    accent: "#f0a73a",
    tile: "#1d4c37",
  },
];

export const STEPS = [
  { title: "Pick a name", body: "Type your store name. We check name.bcom.si live and it is yours for the trial." },
  { title: "Choose a theme", body: "Start from a theme made for your niche. Change anything later in the block editor." },
  { title: "Add products and set your rates", body: "Create products and variants, set your shipping zones and rates, and choose your COD fee." },
  { title: "Share the link, take orders", body: "Customers order with cash on delivery. You confirm, ship and mark delivered from the admin." },
];

export const FAQS = [
  {
    q: "Can I use my own domain?",
    a: "Every store gets name.bcom.si straight away. Connecting your own domain is built but not switched on yet, so it is marked Coming soon until it works end to end.",
  },
  {
    q: "How do my customers pay?",
    a: "With cash on delivery today, with a fee you set. Online payments through Razorpay (UPI and cards) are Coming soon.",
  },
  {
    q: "What do you charge besides the plan?",
    a: "Today the plan fee is the only thing you pay us, plus GST. bcom.si does not process payments yet, so there are no payment fees. When online payments launch, the payment provider's own fees will apply and we will show them before you switch it on.",
  },
  {
    q: "How does shipping work?",
    a: "You set your own shipping zones, rates and a free-shipping threshold. Shiprocket labels and tracking are Coming soon; until then you ship with any courier and mark orders shipped in the admin.",
  },
  {
    q: "Are the invoices GST-ready?",
    a: "Tax invoices work out CGST and SGST or IGST from your state and your customer's state, with HSN on each line. Downloadable PDFs are Coming soon.",
  },
  {
    q: "Can I bring my store from another platform?",
    a: "There is no import tool yet. You add products in the admin, and we will say so here when importing is ready.",
  },
  {
    q: "Is there a free trial?",
    a: "Yes, 14 days on the plan you choose. You do not need a card to start.",
  },
];

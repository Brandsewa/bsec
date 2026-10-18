/**
 * Landing page content for the agent-first page (docs/MARKETING-AGENT-FIRST-PLAN.md). Owner decision 2026-10-18: this
 * page is not merged until the AI-commerce features it describes are built, so the copy describes the finished product.
 * The chat conversations, brands and dashboard on the page are illustrations and are labelled as such.
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
  if (domains !== null) out.push(`${fmt(domains)} custom ${domains === 1 ? "domain" : "domains"}`);
  return out;
}

export const INCLUDED_IN_ALL = [
  "AI-ready store layer",
  "Cash on delivery checkout",
  "GST tax invoices",
  "Visual theme builder",
  "Returns and exchanges",
  "Customers and segments",
  "14-day free trial",
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
  { title: "Pick a name", body: "We check it is free. It is yours for the trial." },
  { title: "Choose a theme", body: "Start from a look made for your niche." },
  { title: "Add your products", body: "Upload them. We make them readable by AI." },
  { title: "Get found", body: "Share the link and let assistants find you." },
];

export const FAQS = [
  {
    q: "What is an AI-ready store?",
    a: "A store whose products, prices, stock and delivery details are readable by AI assistants, so they can find, compare and recommend your products to shoppers who ask.",
  },
  {
    q: "Do I need to do anything technical?",
    a: "No. Add your products as usual. We handle making them readable and keep them up to date.",
  },
  {
    q: "Which assistants will this work with?",
    a: "We are built for ChatGPT, Gemini, Claude and Perplexity, and for the open standards behind them, so new assistants can be added as they arrive.",
  },
  {
    q: "When will in-chat checkout be available in India?",
    a: "We are built for it and will switch it on for Indian stores as soon as each assistant launches it here. Stores on Bs Commerce will be first in line.",
  },
  {
    q: "Is it safe? Can an AI invent a discount?",
    a: "No. Prices, GST and shipping are locked by your store for each cart. An assistant cannot change them, and any negotiation stays inside the limits you set.",
  },
  {
    q: "Can I use my own domain?",
    a: "Yes. Every store starts on name.bcom.si, and your plan includes custom domains.",
  },
  {
    q: "Is there a free trial?",
    a: "Yes, 14 days on the plan you choose. You do not need a card to start.",
  },
];

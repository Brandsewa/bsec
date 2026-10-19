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
  "Cash on delivery checkout",
  "GST tax invoices",
  "Visual theme builder",
  "Returns and exchanges",
  "Customers and segments",
  "14-day free trial",
];

export const FAQS = [
  {
    q: "What can I do on BCom today?",
    a: "Open a complete online store: add products and variants, pick a theme, set your shipping rates and COD fee, take cash on delivery orders and issue GST invoices, handle returns and exchanges, and manage customers and staff. Your store lives on yourname.bcom.si, so you can share it on Google, Instagram, WhatsApp or anywhere else.",
  },
  {
    q: "What does agent-first mean?",
    a: "It means the platform is designed so AI shopping assistants can find, compare and (as each assistant launches shopping) check out products from your store. The store itself works today; the AI features are marked Coming soon.",
  },
  {
    q: "Which AI assistants will this work with?",
    a: "We are building for ChatGPT, Gemini, Claude and Perplexity, and for the open standards behind them, so new assistants can be added as they arrive. We will switch each one on for Indian stores as it launches shopping here.",
  },
  {
    q: "Is it safe? Can an AI invent a discount?",
    a: "No. When AI selling launches, your store locks the price, GST and shipping for each cart and an assistant cannot change them. Any negotiation stays inside the limits you set.",
  },
  {
    q: "How does billing and the free trial work?",
    a: "Every plan starts with a 14-day free trial and no card is needed to start. Paid plans are billed through Razorpay subscriptions. See the refund and cancellation policy for how cancelling and refunds work.",
  },
  {
    q: "Can I use my own domain?",
    a: "Every store starts on yourname.bcom.si. Connecting your own domain is coming soon.",
  },
];

# Marketing site plan: agent-first home page, company pages and legal pages

Status: built on `feat/marketing-agent-first`, awaiting owner review (2026-10-19). Owner: Claude Code plans, builds and verifies. Supersedes the "do not merge until AI features are built" rule in `docs/MARKETING-AGENT-FIRST-PLAN.md`.

## 1. Why

Razorpay (the payment gateway the owner is applying for) checks the live website during activation and withholds live keys until it passes. It expects, at minimum, terms and conditions, a privacy policy, a refund or cancellation policy, a shipping or delivery policy and a contact page, and also looks for about-us and pricing details (source: Razorpay docs, Business Website Details). India's E-Commerce Rules 2020 also expect a platform to show its legal name, address, customer-care contact and a grievance officer.

## 2. Owner decisions (2026-10-19)

- The site is agent-first but **honest**: what a merchant can use today (a complete store with COD, GST invoices, themes, orders, returns, customers) is "Ready today"; AI-agent features are "Coming soon" or "Built for the future". Nothing is promised that is not built.
- bcom.si is a product of **Brand Sewa Digital Private Limited** (brandsewa.com); the footer, contact page, About page and legal pages say so, with CIN and GSTIN.
- The phone demo stays, with three tabs: **Google Search** and **Instagram** (ready today, ending in a cash-on-delivery order) and **AI agents** (coming soon).
- Billing: merchants pay plans through Razorpay subscriptions; for some stores the owner may set a plan up from the back end. Refunds: within 7 days of a payment, none after. Courts: West Bengal. No phone number published for now. Contact: info@bcom.si, support@bcom.si. Grievance officer: Veeplov Rai, legalteam@brandsewa.com.
- Product name on the site is **BCom** (not "Bs Commerce"). Online payments (UPI, cards, net banking) and intelligent analytics are described as available but are not built yet: **launch gate, merge only when both exist** (owner, 2026-10-19).
- The repo is public for now; the owner will make it private before launch.

## 3. Pages (marketing host only; any other host gets 404)

| Path | Page |
|---|---|
| `/` | Home: hero with phone demo, Ready today, AI shopping era (Coming soon), themes, pricing, FAQ, call to action |
| `/about` | Who we are, what it does today, why agent-first, company details |
| `/contact` | Support and general emails, registered business, grievance officer |
| `/pricing` | Live plans (database), GST note, trial, billing and cancellation |
| `/terms` | Terms of service (20 sections) |
| `/privacy` | Privacy policy (DPDP Act 2023 style; fiduciary and processor roles) |
| `/refund-policy` | Trial, renewal, cancelling, 7-day refund rule, 5 to 7 business days |
| `/shipping-policy` | Software delivered online; nothing is shipped |

## 4. Technical decisions

- Company details live in one file, `components/marketing/landing/site-info.ts`, used by the footer, contact, About, legal pages and the Organization JSON-LD.
- `PageFrame` wraps the plain pages (header, footer, readable document column) and calls `notFound()` on non-marketing hosts; `middleware.ts` lets these paths through on the marketing host; each page has a `loading.tsx` (`bs/route-pending`).
- `robots.txt` on the marketing host used to return `Disallow: /`; it now allows crawling (excluding `/api/` and `/preview/`) and points to the sitemap, which lists the pages above.
- Legal text is drafted from common best practice and the product's real behaviour. It is not legal advice; the owner or counsel reviews it before the Razorpay submission.

## 5. Before submitting to Razorpay

1. Owner (or counsel) reads the terms, privacy, refund and delivery pages.
2. Merge, deploy, and open each URL logged out on a phone.
3. Check the footer and contact details match Brand Sewa's registration.
4. Submit the home page URL and the policy page URLs in the Razorpay dashboard.

# Merchant journey plan: sign-up to first order

Status: plan, not yet executed (2026-10-18). Owner: Claude Code plans and verifies; tests run locally (never the live store without the owner's yes, AGENTS rule 14 and section 6).

## 0. Owner decision (2026-10-18): real environment, not a local mock

The owner wants the journey run on the real production stack with a real domain, Razorpay **test** keys (live keys exist and may be used for one final small real payment), and real ZeptoMail email. This supersedes the "local only, mail trap" approach below and relaxes AGENTS rule 14 for this plan only. Guardrails that still apply:

- Test on a **throwaway store** (clearly named, deleted after) and a **test domain** the owner names; never touch Taste of Hills data.
- Razorpay test keys first. Live keys are entered **by the owner in the admin UI** (never pasted into chat, code, env files, commits or logs); a live run is one small real order, refunded afterwards, and only after the test-mode run passes.
- ZeptoMail credentials are entered by the owner in Super Admin `/email`; SPF, DKIM and CNAME DNS records are added by the owner.
- Cloudflare, Coolify and DNS changes happen only with the owner's yes at that moment; Shiprocket and couriers stay out of scope.
- **New build work this creates:** online Razorpay checkout is not wired today (order creation, payment confirmation, webhook, refunds). It must be built and verified in test mode before J7 can pass. Rule 14 and `progress.md` "Decisions on record" are updated to say so once the owner confirms.

## 1. Goal

A new merchant, with no help from us, can go from "I found you" to "a shopper placed an order on my store and I can see it and fulfil it". Design polish and optional features wait until this works end to end.

Out of scope for now (owner decisions on record): live Razorpay/Stripe keys and online checkout, Shiprocket or any courier, SMS/WhatsApp. Cash on delivery (COD) is the payment path that must work; Razorpay test mode is a stretch check (J7).

## 2. What the docs say exists (read from `progress.md`, `docs/ARCHITECTURE.md`, change records; none of it re-run today)

| Stage | Built | Verified live | Known gap or risk |
|---|---|---|---|
| Sign-up form and store creation | `/signup` (multi-step: subdomain check, details, template, plan), `saas/signup.ts`, abuse protection (rate limit, disposable email, Turnstile) | M9 "done and verified live" (2026-10-01) | An earlier note says signup was unreachable until a marketing-page fix deployed; re-confirm. Owner invite or password at sign-up: confirm which. |
| Email (verify, invite, reset, order) | Platform mailer (ZeptoMail), templates, reset flows | Not verified: "awaiting credentials" | **Email delivery is not live.** Any step that needs an emailed link (invite, verification, reset, order mail) is a blocker in production. |
| Store admin first sign-in | Staff auth, onboarding checklist (`saas/onboarding.ts`: product added, payment configured, domain connected, first order) | Owner flow works for Taste of Hills (invite link shown once, not emailed) | Checklist never walked by a fresh merchant. |
| Store details, branding, policies, tax (GST) | Settings workspace (rebuilt, flag-gated "Update available" prompt) | Browser-tested by agents (Oct 5) | Polish round (M13) built, **not driven in a browser**; policies editor was replaced. |
| Products, variants, stock, images, categories | Full catalog (phases A to F), variant builder, media library (R2) | Image upload to R2 verified live; variant builder not | Product import is disabled; product-create stock field was a gap (re-check). |
| Shipping rates and zones | Per-store rates, zones and tiers (M13, new) | Not verified | Zones/tiers are brand new and unexercised. Rule 12: totals recomputed on the server. |
| Payments | COD works; Razorpay/Stripe config pages, test mode only | COD verified live (ORD-00001/2) | Online checkout not wired by decision. Payments page was restructured in M13. |
| Theme and storefront | Theme library, editor, Modern Commerce theme | Essential Commerce live; Modern Commerce **draft, not activated** | Which theme a new store gets at sign-up, and whether it renders with no content, is untested. |
| Domain | Subdomain `<slug>.bcom.si` works; custom domain backend coded | Never run live | Needs Cloudflare token, zone and CNAME target; DNS instructions and Verify button added in M13, unverified. |
| Go live | Storefront status (coming soon, live, password) | Verified live | New stores start `coming_soon`; merchant must know to switch. |
| Order to fulfilment | Checkout (COD), manual confirm/ship/deliver, returns, invoices (no PDF) | Placed and cancelled live; lifecycle read from code | Order emails are placeholders until mail is live; shipping labels manual. |
| Billing and plans | Plan tiers, quotas, trial expiry, promotions, billing coded | Never run live | Decide whether trial-to-paid matters for the first merchants. |

## 3. How we test

- **Where (superseded by section 0):** production with a throwaway store. A local stack remains for developing fixes before they deploy. Original idea: a local stack (docker compose or `pnpm dev` per `reference-local-dev-setup`): Postgres, web 3000, platform 4000, worker, admin 5173, superadmin 5174, with a mail trap standing in for ZeptoMail. Fresh database, so we exercise the real sign-up path, not seeded data.
- **Who:** Claude drives each stage in the built-in browser at desktop width and 375 px, reads console and network, and records evidence. Real-database tests cover anything touching tenancy, money, auth.
- **Pass rule:** a stage passes only when its steps complete with no console errors, no 4xx/5xx except expected ones, and the merchant never has to guess. Each failure is logged as a defect (severity, steps, expected, actual) in `docs/changes/` with type "test", then fixed in small commits, then the stage is re-run.
- **Run order matters:** stages J1 to J12 are sequential, because each uses the store created in J1.
- **Precondition:** the M13 polish branch (`fix/admin-polish-phase-1`) is unverified in a browser and holds the shipping, domains, payments and policies changes this journey depends on. Test on that branch, then commit and merge the result as one reviewed unit.

## 4. Task list (the journey)

Each task: steps, pass criteria. "Blocker" marks a dependency we cannot test without an owner decision.

### J0. Environment ready
- Fresh local stack up, mail trap capturing mail, all `/health` green, migrations applied.
- Pass: gate `pnpm typecheck`, `lint`, `build`, `docs:check` green on the branch first.

### J1. Discover and sign up
1. Open the marketing page `/`; reach `/signup` from the main call to action.
2. Check subdomain availability (taken, reserved, invalid, free).
3. Enter business and owner details, pick industry/template and plan, submit.
4. Negative cases: disposable email, duplicate email, duplicate subdomain, weak password, double submit.
- Pass: store row, owner user, membership, domain, default settings and default pages exist; lead record updated; clear error copy for each negative case; works at 375 px.
- Blocker check: does the owner set a password at sign-up, or wait for an emailed invite? If emailed, J2 depends on mail (see J2).

### J2. Verify email and first sign-in to admin
1. Receive the verification or invite message (mail trap); follow its link.
2. Set password, sign in at the admin, land on the dashboard.
3. Forgot password, reset, sign in again.
- Pass: link works once, expires, cannot be reused; wrong password and rate limiting behave; session persists on refresh.
- Blocker: real delivery needs ZeptoMail credentials and DNS (SPF, DKIM). Until then, record "tested with mail trap only". **Owner decision: when do we turn on ZeptoMail?**

### J3. First-run guidance
- Dashboard shows the onboarding checklist (add product, set up payment, connect domain, receive first order) with correct state and working links; dismiss works.
- Pass: each checklist item opens the right screen and ticks automatically when done.

### J4. Set up the store
1. Store details: legal name, address, support email, phone, currency, timezone.
2. GST: place of supply, GSTIN (optional), tax classes.
3. Branding: logo, colours, favicon.
4. Policies: refund, privacy, terms, shipping; publish; open them on the storefront.
- Pass: values save, survive refresh, appear on storefront, footer, checkout and invoice where relevant; policy pages return 200, not a blank page; unsaved-changes guard works.

### J5. Add products
1. Create a category and a collection.
2. Create a simple product with price, image upload (R2 path or local fallback), stock, SKU.
3. Create a product with variants (size and colour) via the variant builder; set per-variant price and stock.
4. Publish, then edit and archive one.
5. Check inventory screen and low-stock display.
- Pass: product visible on storefront with correct price, image, variant selector and stock; out-of-stock behaviour is correct; draft products stay hidden; CSV import is clearly disabled or works.

### J6. Shipping and tax at checkout
1. Create shipping zones and rates (flat, free above a threshold, tiered by weight or price), per rule 12.
2. Check a cart in and out of each zone; check GST lines (CGST+SGST vs IGST).
- Pass: totals on the server equal what the page shows; unsupported PIN/state is handled with a message; no hardcoded rates.

### J7. Payments
1. COD: enable, optional fee; confirm it is the checkout default.
2. Razorpay test mode (stretch, rule 14): save test keys, Test connection, Activate, confirm what checkout does and that keys are never shown back.
- Pass: COD order placeable; the payments screen never claims online payment works if it is not wired; secrets encrypted and masked.

### J8. Look and feel (minimum viable)
1. Choose a theme from the library, preview with own products, activate.
2. Edit the home page with the visual editor, publish; set header menu and footer links.
- Pass: a brand-new store with only 2 or 3 products still renders a complete, non-broken home, collection, product, cart and checkout; mobile layout intact. **Decision needed:** which theme new stores receive by default (Essential Commerce is live; Modern Commerce is an unpublished draft).

### J9. Domain
1. Default `<slug>.bcom.si` loads once live.
2. Custom domain: add, read the DNS instructions, set records, press Verify, SSL status.
- Pass: instructions show exact record type, host and value with copy buttons; status updates; wrong DNS yields a helpful message.
- Blocker: custom domains need `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, and the CNAME target (owner/infra). Locally we can test the UI and the verify logic against a fake provider only. Changing Cloudflare or Coolify needs the owner's yes.

### J10. Go live
- Switch storefront from `coming_soon` to live (and password mode as an option); test as an anonymous visitor in a clean browser.
- Pass: coming-soon page is clean and branded; live store resolves by host; a suspended or unknown host shows the right page (note: up to 60 s cache lag).

### J11. Shopper places an order
1. As a guest: browse, filter, search, add to cart, mini cart, checkout (address, shipping method, COD), thank-you page with real order number.
2. As a registered customer: sign up, verify, sign in, check out with a saved address, view account orders.
3. Edge cases: out of stock mid-checkout, coupon code, price tampering in the request, double-click on Place order, 375 px.
- Pass: order created once, stock reserved, totals recomputed on the server, idempotent submit, customer and merchant see the same order.

### J12. Merchant receives and fulfils the order
1. Order appears in admin with correct customer, items, totals, payment status; notification or email arrives (mail trap).
2. Confirm, mark shipped (manual tracking note), mark delivered with COD collected; print/open invoice.
3. Cancel a second order and confirm stock release; run a return and refund record.
4. Dashboard and customers pages reflect the order.
- Pass: every transition audited and visible on the order timeline; stock moves correctly; emails are sent through the mailer (mail trap) with the store's name.

### J13. Merchant account, plan and billing (check only)
- Plan and billing page shows trial and quota truthfully; trial expiry and a plan limit do not break an existing store; invite a staff member and sign in as them with limited permissions.
- Pass: no dead ends; anything not built says so plainly. Real payment for plans is out of scope.

## 5. Cross-cutting checks (run alongside every stage)
- Tenant isolation: a second store created in J1 must never see the first store's data (use the isolation suite plus a manual spot check in two browsers).
- Mobile at 375 px and desktop; light and dark in admin.
- No secrets in network responses or logs.
- Console and server logs clean of errors.
- Every admin route shows its skeleton, not a flash of empty content.

## 6. Order of work and exit criteria

1. J0 gate and stack. 2. J1 to J3 (signup to dashboard). 3. J4 to J6 (store content and rules). 4. J7 to J10 (selling setup and go live). 5. J11 to J12 (the order). 6. J13 and cross-cutting.

Exit: one fresh merchant account completes J1 to J12 in one sitting, unaided, on a clean local database, with the defect list empty of severity "blocks the journey". Then repeat J1 to J12 once on production with the owner's explicit yes, using a throwaway store that is deleted afterwards.

## 7. Decisions needed from the owner

1. Turn on real email (ZeptoMail) before launch? Without it, invites, verification, reset and order emails never reach anyone.
2. Default theme for new stores: Essential Commerce (live) or Modern Commerce (draft, needs review).
3. Is the first-merchant launch COD-only (current decision), or must Razorpay test-mode checkout also work?
4. Custom domains in the first release or after? It needs Cloudflare for SaaS setup.
5. Trial and billing at launch: free period only, or paid plans live?

## 8. Defect log (fill in while testing)

| ID | Stage | Severity | Steps | Expected | Actual | Evidence | Status |
|---|---|---|---|---|---|---|---|

## 9. Razorpay checkout: audit and build scope (2026-10-18, read from code, not run)

**Exists:** `RazorpayProvider` (create intent, capture, cancel, refund, webhook verify, reconcile) in `packages/payments`; `placeOrder` creates the provider order and a `payment_intents` row for `razorpay`; per-store encrypted credentials and an activate flow in `packages/domain/src/admin/payment-providers.ts`; webhook route `/api/webhooks/[provider]` with a handler for `payment.captured` and `order.paid` in `system/webhooks.ts`; checkout UI has an "online" option shown when the store has an active method.

**Gaps found:**
1. `placeOrder` returns a **hardcoded** `keyId: "rzp_test_key"` (`orders/checkout.ts` near line 759). It must return the store's real, non-secret key id.
2. The storefront never loads Razorpay Checkout (`checkout.js`) or opens the payment popup; no handler posts the payment id and signature back.
3. No server-side confirmation endpoint that verifies the signature and marks the order paid before the webhook arrives; no handling for popup closed, payment failed, or retry.
4. Webhook coverage: `payment.failed` and refund events need handling and idempotency; the webhook secret must be configurable per store and the URL shown with the real store domain.
5. Unpaid online orders: stock reservation expiry and the abandoned-pending order sweep need checking.
6. Admin refund of a Razorpay-paid order through the provider, and the order timeline and finance postings for it.
7. `/checkout/failed` exists; confirm what it shows and that "retry payment" works.

**Build order (small slices, real-database tests per slice):** (a) return the real key id and remove the hardcode; (b) storefront popup plus confirm endpoint with signature check; (c) webhook failure and refund events, idempotency; (d) admin refund; (e) failure and retry UX; (f) test-mode run on the owner's test domain with Razorpay test cards, then (g) one small live payment, refunded, only on the owner's go.

**Webhook note:** Razorpay must reach the test domain over HTTPS, so J9/J10 (domain and live) come before the end-to-end payment run.

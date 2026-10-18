# Merchant journey checklist (owner walk-through)

For the owner to follow step by step on production, with a throwaway store. Plan and reasoning: [`MERCHANT-JOURNEY-PLAN.md`](MERCHANT-JOURNEY-PLAN.md). Tick as you go; for any step that fails, note the step number, what you saw, and a screenshot, and send it to Claude.

**Read first**
- Keys (ZeptoMail, Razorpay) are typed by you into the admin screens only. Never paste them into chat.
- Use a throwaway store with an obviously fake name (for example "Journey Test Store"). Do not touch Taste of Hills.
- **Online Razorpay payment at checkout is not finished yet.** You can save keys, test the connection and activate the gateway (steps B and G), but the payment popup at checkout is still to be built (Plan section 9). Until then place orders with Cash on Delivery. Do not use live keys yet.
- The admin polish round (payments page, domains page, shipping zones, policies) is merged to `main` (9b1cc15) and the live admin bundle contains the new payments screen (checked 2026-10-18). `progress.md` still lists it as in flight; that is stale.

---

## A. Before the store: one-time platform setup (Super Admin)

Sign in at the Super Admin (superadmin.bcom.si).

- [ ] **A1. Encryption key is set.** Ask Claude to confirm `TENANT_SECRETS_KEY` is set on web, platform and worker in Coolify. Without it, saving any key fails.
- [ ] **A2. ZeptoMail.** Super Admin, Integrations, Notifications, Email (the old `/email` link redirects there).
  1. In Zoho ZeptoMail, create a Mail Agent and add the sending domain; add the CNAME, SPF and DKIM records it shows in Cloudflare DNS and wait until ZeptoMail says verified.
  2. In the Email page choose the India ZeptoMail preset, enter the SMTP username and password (or send-mail token) from ZeptoMail, set the from address (`no-reply@bcom.si`), save.
  3. Use "Send test email" to your own inbox. Check it arrives (not in spam) and the recent deliveries table shows it as sent.
  - Pass: test email received. If it fails, copy the error shown in the delivery log.
- [ ] **A3. Razorpay enabled for the platform.** Super Admin, Integrations, Payments. Turn **Enable** on for Razorpay (this is why stores could not see it before). Leave **Allow live mode** off for now.
- [ ] **A4. Plans and features.** Super Admin, Plans: confirm the plan you will pick at signup exists. Super Admin, Features: if the new Settings pages are behind flags, turn on `settings.update_offer` (stores then get an "Update available" prompt) and note which `settings.*` flags are on.

## B. Sign up as a merchant

Use a private/incognito window and a real email you can open.

- [ ] **B1.** Open bcom.si, click the sign-up button, reach `/signup`.
- [ ] **B2.** Pick a store address (subdomain). Try one that is taken and one that is invalid; see sensible messages. Choose a free one, for example `journeytest`.
- [ ] **B3.** Fill business name, your name, email, phone, industry. Try a disposable email once; it should be refused.
- [ ] **B4.** Choose a theme and a plan; review the summary; create the store.
- [ ] **B5.** Check your inbox: you should get a welcome, verification or invite email (A2 must be done). Note what arrived and how long it took.
- [ ] **B6.** Follow the link, set a password, sign in to the store admin (admin.bcom.si).
- [ ] **B7.** Sign out, use Forgot password, receive the reset email, set a new password, sign in again.
- [ ] **B8.** Refresh a few pages; you stay signed in. Try the same at phone width.

## C. First look at the store admin

- [ ] **C1.** The dashboard shows the getting-started checklist (add product, set up payment, connect domain, first order). Click each item; each opens the right page.
- [ ] **C2.** If an "Update available" prompt appears, accept it (Update now).

## D. Fill in the store details

- [ ] **D1.** Settings, Store details: legal name, address, phone, support email, currency, timezone. Save, refresh, values stay.
- [ ] **D2.** Settings, Taxes: place of supply (state), GSTIN if you have one, tax classes.
- [ ] **D3.** Settings, Branding: logo, favicon, brand colours.
- [ ] **D4.** Settings, Policies: write and publish Refund, Privacy, Terms and Shipping. Open each on the storefront.
- [ ] **D5.** Settings, Checkout and Customer accounts: review the options; leave defaults if unsure.

## E. Products

- [ ] **E1.** Create a category and a collection.
- [ ] **E2.** Create a simple product: title, price, image upload, SKU, stock.
- [ ] **E3.** Create a product with variants (size and colour), per-variant price and stock.
- [ ] **E4.** Publish both; edit one; archive one; confirm drafts do not show on the store.
- [ ] **E5.** Inventory page shows the stock; reduce one to zero and check "out of stock" on the storefront.

## F. Shipping

- [ ] **F1.** Settings, Shipping: create a zone and a flat rate; add a free-above-amount rate and a tiered rate.
- [ ] **F2.** Add to cart on the storefront and check the shipping line changes with the cart value and address.

## G. Payments

- [ ] **G1.** Settings, Payments: Cash on Delivery is on (set a fee if you want one).
- [ ] **G2.** Under **Online payment gateways**, choose **Add gateway**, pick **Razorpay** (it appears only after A3). If it is missing, tell Claude.
- [ ] **G3.** Click **Configure** on the Razorpay card. A side panel opens with Key ID, Key secret and Webhook signing secret. In the Razorpay dashboard use **Test mode**, generate test keys (`rzp_test_...`), enter them, press Save. The secret is then masked and never shown again.
- [ ] **G4.** Press **Test connection**; expect success.
- [ ] **G5.** Copy the **Webhook URL** shown in the panel. In Razorpay (test mode) Settings, Webhooks, add that URL, enable the payment and order events, set a secret, then paste the same secret into the Webhook signing secret field and save.
- [ ] **G6.** Press **Activate**.
  - Expected today: the keys, test and activation work. Paying online at checkout does not complete yet (to be built). Record what the checkout page shows when "online" is selected.

## H. Theme and storefront look

- [ ] **H1.** Online Store, Themes: preview with your products, activate one.
- [ ] **H2.** Edit the home page in the visual editor, publish. Set the header menu and footer links.
- [ ] **H3.** View home, collection, product, cart and checkout at desktop and 375 px width; note anything broken.

## I. Domain

- [ ] **I1.** Your store already works at `<store>.bcom.si`. Open it.
- [ ] **I2.** Settings, Domains: add your custom domain. Read the DNS instructions (record type, host, value); add them at your DNS provider; press **Verify / Check status**. Note the status and any message.
  - Custom domains need the Cloudflare for SaaS setup (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, CNAME target). If it errors with a configuration message, tell Claude; do not change Cloudflare or Coolify settings without Claude confirming.

## J. Go live

- [ ] **J1.** Settings, Storefront: new stores start "Coming soon". Open the store in a private window and see the coming-soon page.
- [ ] **J2.** Switch to **Live**; reload in the private window; the store is public. (A change can take up to a minute to appear.)

## K. Place an order as a shopper (private window)

- [ ] **K1.** Browse, use filters and search, add two items to the cart, open the mini cart.
- [ ] **K2.** Checkout as guest: address, shipping method, **Cash on Delivery**, place order. Note the order number and the thank-you page.
- [ ] **K3.** Check your inbox for the order confirmation.
- [ ] **K4.** Repeat as a registered customer: create an account, verify by email, sign in, check out with a saved address; see the order under Account.
- [ ] **K5.** Try: an out-of-stock item, a discount code (create one in Discounts first), pressing Place order twice quickly.

## L. Fulfil as the merchant

- [ ] **L1.** The order appears under Orders with the right customer, items, totals and payment status.
- [ ] **L2.** Confirm, mark shipped (add a tracking note), mark delivered (COD collected). Check the order timeline and the invoice.
- [ ] **L3.** Place a second order and cancel it; stock is released.
- [ ] **L4.** As the shopper, request a return on the delivered order; as the merchant approve it, receive it, record a refund.
- [ ] **L5.** Dashboard and Customers pages show the order and customer.

## M. Team, plan and cleanup

- [ ] **M1.** Settings, Users: invite a second person (needs email); accept; confirm limited permissions.
- [ ] **M2.** Settings, Plan and billing: trial and limits are shown honestly.
- [ ] **M3.** When finished, ask Claude to delete the throwaway store (Super Admin, tenant, delete) so no test data stays.

## Reporting a problem

Send Claude: the step number (for example G4), what you expected, what happened, a screenshot, and the time. Claude will check the logs, fix, and you repeat that step.

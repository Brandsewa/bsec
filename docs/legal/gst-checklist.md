# Indian Goods & Services Tax (GST) Cases Requiring Chartered Accountant Review

> **STATUS:** `[PENDING CHARTERED ACCOUNTANT REVIEW - NOT YET REVIEWED BY A CERTIFIED CA]`  
> **Applicable Act:** Central Goods and Services Tax Act, 2017 (CGST Act) & Integrated Goods and Services Tax Act, 2017 (IGST Act)  
> **Platform:** Brand Sewa E-Commerce Platform (`bsec`)  
> **Date:** September 2026

---

The following specific tax scenarios and statutory obligations must be formally reviewed, validated, and signed off by a certified Indian Chartered Accountant (FCA / ACA) prior to enabling live billing and merchant payouts:

### 1. Section 52 Tax Collection at Source (TCS) for E-Commerce Operators
- **Issue:** Under Section 52 of the CGST Act, e-commerce operators who facilitate the supply of goods through their digital portal and collect consideration from customers must collect TCS at 1% (0.5% CGST + 0.5% SGST or 1% IGST) on net taxable supplies.
- **Accountant Review Required:** Determine whether Brand Sewa acts as a pure software provider (where payments flow directly to Merchant's own Razorpay account) vs an aggregator collecting customer consideration. If pure SaaS, Section 52 TCS does not apply to the platform.

### 2. SaaS Subscription Billing: Place of Supply & Tax Categorization
- **Issue:** Platform SaaS subscriptions (Starter, Growth, Pro) billed to Indian merchants.
- **Tax Rate:** SAC Code 997331 (Licensing services for the right to use computer software) or 998314 (Information technology design and development services) at **18% GST**.
- **Place of Supply (Section 12 IGST Act):**
  - If Merchant GSTIN is registered in Delhi (same state as Brand Sewa): **CGST (9%) + SGST (9%)**.
  - If Merchant GSTIN is outside Delhi (inter-state): **IGST (18%)**.
  - B2C (unregistered merchants): Place of supply defaults to location of recipient based on billing address.
- **Accountant Review Required:** Confirm exact HSN/SAC code classification and input tax credit (ITC) eligibility for merchant subscribers.

### 3. Cross-Border Subscriptions (Export of Services under LUT)
- **Issue:** Merchants subscribing from outside India (e.g. Nepal, UAE, US).
- **Rule:** Qualifies as Zero-Rated Supply (Export of Services) under Section 16 of the IGST Act, provided consideration is received in convertible foreign exchange and a Letter of Undertaking (LUT) is filed under Rule 96A.
- **Accountant Review Required:** Verify filing of LUT on GST portal (Form GST RFD-11) and FIRC (Foreign Inward Remittance Certificate) compliance.

### 4. Merchant Storefront Invoicing: HSN & Tax Rate Matrix
- **Issue:** The platform generates automated GST tax invoices for store orders (`orders_invoices` table).
- **Cases:**
  - Multiple GST rates in a single cart (e.g. apparel at 5% or 12%, electronics at 18%, accessories at 28%).
  - Tax inclusive vs Tax exclusive catalog pricing.
  - Delivery and shipping fee tax rate (composite supply where shipping takes principal supply rate vs separate supply).
  - Cash on Delivery (COD) convenience fee taxation.
- **Accountant Review Required:** Confirm logic for apportioning shipping/COD fees and sequential tax invoice numbering format complying with Rule 46 of CGST Rules (maximum 16 alphanumeric characters, unique per financial year).

### 5. Return, Cancellation & Credit Note Adjustments (Section 34)
- **Issue:** When a customer cancels or returns an order, or when a merchant issues a refund.
- **Rule:** Issuance of Credit Notes under Section 34 of CGST Act. Credit notes must be reported in GSTR-1 by the merchant within the statutory deadline (by 30th November following the end of the financial year).
- **Accountant Review Required:** Validate credit note schema, GST credit reversal calculation, and linkage to original invoice number.

### 6. Reverse Charge Mechanism (RCM) on Imported Foreign Subprocessors
- **Issue:** Brand Sewa pays foreign infrastructure providers (e.g. Hetzner Germany, Cloudflare US, Resend US).
- **Rule:** Import of services under Section 5(3) of IGST Act attracts GST under Reverse Charge Mechanism (RCM). Brand Sewa must pay 18% IGST in cash on these purchases and claim ITC in the same month.
- **Accountant Review Required:** Set up monthly RCM payment and ITC reconciliation workflow.

---
*DO NOT TREAT THIS CHECKLIST AS LEGAL OR TAX ADVICE. A FORMAL CA OPINION MUST BE FILED IN COMPANY RECORDS BEFORE PRODUCTION ONBOARDING.*

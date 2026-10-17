# ADR-035: Promotions and free periods for store subscriptions

- **Status:** Accepted
- **Date:** 2026-10-17
- **Plan reference:** `docs/ADMIN-SUPERADMIN-POLISH-PLAN.md` (SA-05), ADR-014 (platform billing is separate from store checkout)

## Context
To onboard early customers the platform needs discounts and free stores for a limited time. Platform billing is not live yet (no platform provider credentials), so the design must work without a provider and still make later billing correct.

## Decision (owner decisions, 2026-10-17)
1. **Promotions** are platform-level rows (`promotions`, migration 0067): a code, a kind (`percent_off` or `free_months`), a duration of **1 to 12 months** (hard cap, also a database CHECK), optional plan restriction, redemption limit and validity window. Terms never change after creation; only the owner can create or change promotions.
2. **Grants** (`tenant_promotions`): a store receives a promotion by **promo code at signup** (redeemed inside the provisioning transaction, so a bad code creates nothing) or by the **platform owner** from the store's Billing tab (an existing promotion or custom terms, for example a free year). **One active promotion per store** (unique index). A store **keeps its promotion if it changes plan**.
3. **Prepaid terms:** a subscription is prepaid for 6, 12 or 36 months. A promotion discounts **only the first 12 months** of the term (never more months than the term); every other month is list price. `quoteTerm` (`packages/domain/src/saas/promotion-math.ts`) is pure and tested, and the Super Admin grant dialog shows the quote. **No GST for now**: quotes carry `taxPaise: 0` so tax can be added later.
4. **End of a free period:** a timer in the platform service (`endDuePromotions`, hourly, `PROMOTION_SWEEP_INTERVAL_MS`) ends due grants. A free period that ends while the store has not started paying (no provider subscription) **suspends the store with the reason "Free period ended. Choose a plan to continue."**; a discount simply returns to list price. Every grant, cancel, redeem and end writes `platform_audit_logs`.
5. **Roles:** create, change, grant and cancel require `platform_owner` (enforced in the domain service and the route); staff can read promotions and quotes.

## Consequences
- Billing code (later) reads the active grant and `quoteTerm`; it must not re-derive discounts.
- Reminder emails 30 and 7 days before a free period ends are not built (email delivery is not live); the end-of-period suspension is.
- A store that is suspended by this rule is restored by choosing a plan or by staff restoring it.

## Alternatives considered
- **Coupon codes inside the provider (Razorpay offers):** billing is not live and the provider is not the source of truth. Rejected for now.
- **A "comped" subscription state only:** cannot express a time-limited free period or a discount. Rejected.

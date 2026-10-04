# Store Admin Settings — remaining delivery plan

## 0. Purpose

This is the delivery plan for the Settings features that follow the Phase 0/1 foundation described in [the builder prompt](prompts/settings-rebuild-phase-0-1.md). It expands the remaining product scope into buildable, verifiable slices.

**Do not start a phase until the prior phase is verified and merged.** Each phase has one owner, one branch/worktree, a change record, its own browser walkthrough and required real-database coverage. The canonical product direction and schema remain [SETTINGS-REBUILD-PLAN.md](SETTINGS-REBUILD-PLAN.md) and [SETTINGS-SCHEMA.md](SETTINGS-SCHEMA.md).

## 1. Current state and sequencing gate

At the time this plan was written, the repository contains the plan, schema and Phase 0/1 builder prompt, but no visible implementation record for `/settings/store-details` or the Settings Overview. Before Phase 2 begins, the verifier must confirm that Phase 0/1 delivered:

- grouped Settings navigation and mobile navigation;
- `/settings` Overview with real tenant-scoped data;
- canonical `/settings/store-details` editor and safe legacy-route handling;
- audit, cache, RLS/isolation, UI and browser verification described in the Phase 0/1 prompt.

If the Phase 0/1 branch exists outside this checkout, merge or rebase it first and update this section/change records with the resulting commit. Do not rebuild its work in a later phase.

## 2. Delivery map

| Phase | Settings/features | Primary dependencies | Owner decision required? |
|---|---|---|---|
| 2 | Permission model, Users & Accounts, owner safeguards, Activity | Phase 0/1; ADR for granular permissions | Yes — delegation model |
| 3 | Branding, Storefront status, Domains status | Phase 0/1; theme/domain lifecycle | No for status/read model; yes for new domain policy |
| 4 | Checkout, Customer Accounts, Orders & Returns settings | Phase 0/1; ADR-019; existing Orders plan | Yes — account creation default/cancellation policy |
| 5 | Payments and Plan & Billing | Phase 0/1; ADR-014 | Yes — gateway/provider work and billing self-service |
| 6 | Shipping & Delivery, Taxes & Duties | Phase 0/1; checkout pricing | Yes — shipping complexity and tax scope |
| 7 | Notifications, Policies, Customer Privacy | Phase 0/1; platform mailer; consent/export/deletion lifecycle | Yes — legal templates/channel scope |
| 8 | Storage usage, Maintenance operations, hardening/rollout | prior phases; store status lifecycle | Yes — maintenance ownership/scheduling policy |

## 3. Phase 2 — permissions, users and settings activity

### Goal

Replace the broad settings authorization model with narrowly granted capabilities, without breaking existing staff access, then rebuild Team as **Users & Accounts** and expose a safe Settings activity history.

### Scope

1. Write and accept an ADR for the permission migration:
   - capability families from `SETTINGS-SCHEMA.md` section 3;
   - mapping from existing roles and `settings.write`/`staff.manage`;
   - grandfathering and rollout strategy;
   - owner-only operations; and
   - how direct-route/API denial behaves.
2. Add permissions through expand/migrate/contract. Existing roles retain only documented, least-privilege equivalents until the owner approves delegation.
3. Rename/rework Team into `/settings/users` (legacy route redirects only after compatibility tests):
   - staff list with role, invite status, last active if available and access warnings;
   - invite, revoke invitation, change role and remove member;
   - read-only Store Owner identity;
   - no owner transfer implementation unless separately specified and re-authenticated.
4. Add `/settings/activity`:
   - read-only, tenant-scoped projection of `audit_logs` for settings mutations;
   - filters for setting area, actor and date;
   - no secrets/ciphertext/raw authentication metadata; and
   - export is out of scope unless the existing export authorization supports it.

### Non-negotiables

- Every newly restricted mutation checks the new permission in its domain service; UI filtering is never the control.
- A support session never receives users, payment, export, refund or configuration capability.
- Never remove the last owner or let a role update grant a capability the actor cannot administer.
- Every role/invitation mutation remains audited and real-DB tenant-isolation tested.

### Acceptance criteria

- [ ] Approved ADR and a role/capability migration matrix are committed before permission enforcement.
- [ ] Allowed/denied/cross-tenant paths are covered by real Postgres tests for every changed procedure.
- [ ] Users, invitations and roles work in the new route; legacy link behavior is tested.
- [ ] Settings Activity contains only the current tenant's safe audit projection.
- [ ] Browser verification covers Owner, Manager/Operations and a denied staff role.

## 4. Phase 3 — brand, storefront and domains

### Goal

Make merchant-facing store identity, storefront availability and domain state coherent, without merging theme editing into general Settings or exposing Cloudflare controls.

### Scope

#### Branding

- Retain/upgrade `/settings/branding` as the home for light/dark logo, favicon, app icon, social image, primary/secondary/accent colours and approved typography.
- Ensure all media references use tenant-safe media records and are deleted/replaced safely.
- Establish the exact draft/save/publish relationship with the existing theme editor: branding owns reusable defaults; theme pages own theme-specific overrides and version history.
- Do not introduce arbitrary fonts, raw CSS or custom brand code.

#### Storefront

- Retain `/settings/storefront` for `live`, `coming_soon`, `password` and current supported `maintenance` state.
- Clearly state whether a change is saved, published or immediately live.
- Preserve hashed password/bypass-token behaviour; never return values to the browser after save.
- Add a safe, audited maintenance control only if the existing lifecycle/server rendering already honours the mode. Scheduling is Phase 8.

#### Domains

- Add `/settings/domains` only as a safe merchant projection of the existing domain lifecycle:
  platform subdomain, custom hostname, status, DNS instructions, verification progress/failure, primary-domain selection and removal request.
- Follow ADR-017 exactly; provider API token, zone ID and hostname identifier remain internal.
- A primary domain cannot be set until status is `active`.

### Acceptance criteria

- [ ] Brand asset mutation is authorized, audited, tenant-isolated and uses existing media safety checks.
- [ ] Theme/Branding has one documented owner for every visual setting; no competing color/font editor.
- [ ] Storefront state response/status matches server behaviour; password or bypass values never leak.
- [ ] Domains UI reflects the real state machine and cannot manufacture an active/verified status.
- [ ] Desktop, tablet, 375px and dark/light browser paths pass.

## 5. Phase 4 — checkout, customer accounts, orders and returns

### Goal

Give merchants real checkout and account controls while preserving low-friction guest purchase and enforcing every displayed setting on the server. Consolidate operational order/return preferences without duplicating payment, shipping or tax fields.

### Scope

#### Checkout (`/settings/checkout`)

- Guest checkout default: enabled for standard D2C purchase, unless owner decides otherwise.
- Account creation: `none`, `optional`, or `after_completed_order`. The last option must use ADR-019 verified identity; no silent password/account creation.
- Contact and address field rules, only where checkout/server validation actually supports them.
- Terms policy acceptance, tied to a published policy version after Phase 7. Until then, do not display a non-enforced setting.
- Marketing consent for email/SMS/WhatsApp: off by default, immutable event history, no transactional-message suppression.
- Abandoned checkout settings (detection and up to three recovery steps) are present only after the background recovery and email-delivery features work; until then, display a non-editable “not available” explanation or omit.

#### Customer Accounts (`/settings/customer-accounts`)

- Header/checkout sign-in visibility.
- Current supported identity methods: email/password and phone OTP.
- Google/Facebook remain absent/deferred until an approved provider adapter, callback security, account-linking and deletion design exist.
- Self-service returns/cancellations link to/enforce existing lifecycle policy; no client-side eligibility toggle.

#### Orders and Returns

- Implement the remaining sections of `ORDERS-SETTINGS-PLAN.md` only as each related feature exists: stock hold, minimum order value, staff alerts, pre-orders and recovery preferences.
- Keep number sequences in the existing dedicated mechanism and Returns settings in `return_settings`.
- Do not duplicate COD, shipping or GST configuration; use related-settings links.
- Refund automation is deferred until a real provider/refund lifecycle exists.

### Acceptance criteria

- [ ] Every option changes checkout/account/order domain behaviour and has a test proving it.
- [ ] Guest checkout, consent and account creation remain tenant-scoped and secure under ADR-019.
- [ ] Field rules cannot suppress information required by shipping, payment or tax calculation.
- [ ] All consent is unselected by default and has immutable server history.
- [ ] Real-DB tests cover permission, isolation, account claim and order/return behaviour.

## 6. Phase 5 — payments and plan & billing

### Goal

Separate merchant customer-payment configuration from merchant SaaS subscription visibility, and make every status truthful.

### Scope

#### Payments (`/settings/payments`)

- Gateway catalogue with **Active**, **Available**, **Unavailable**, **Coming soon** and **Manual methods** states.
- Preserve currently working COD with fee/range configuration and server-side checkout enforcement.
- Add payment method ordering only after checkout consumes it.
- Provider setup drawer is allowed only for an implemented provider: write-only secrets, test/live mode, safe validation status, encryption, audit events with no secret fields, disconnect confirmation, historical data preserved.
- Razorpay only with explicit owner authorization; Stripe/PayPal require a provider plan, adapter, webhook, end-to-end checkout and tests before any usable UI.
- Bank transfer/money order require order-state/reconciliation/instruction design before activation.

#### Plan & Billing (`/settings/plan-and-billing`)

- Two tabs: Plan & usage; Invoices.
- Read platform plan, subscription, invoice and quota data through a safe platform-authorized projection, not tenant database copies.
- Merchant can view plan/invoice status and request a plan change. Plan catalog edits, charges, refunds and final changes stay in Super Admin until self-service SaaS billing ships.
- Do not reuse tenant payment secrets or checkout webhooks; follow ADR-014.

### Acceptance criteria

- [ ] Payment provider secrets never occur in logs, audit diffs, API response, query cache or browser state.
- [ ] No method is marked active unless checkout can actually take it.
- [ ] COD values are recomputed server-side at checkout.
- [ ] Billing page never has access to customer-payment credentials/data.
- [ ] Provider activation/disconnect and plan read projection are authorized/audited/isolated.

## 7. Phase 6 — shipping, delivery, taxes and duties

### Goal

Evolve the simplified current configuration into reliable shipping and GST controls without hardcoding money/shipping rules or pretending international tax support exists.

### Scope

#### Shipping (`/settings/shipping`)

Build incrementally in this order:

1. Preserve and test existing default zone, standard/express rates and free-shipping threshold.
2. Add shipping profiles and product/profile mappings.
3. Add zones with country/state/pincode coverage and deterministic matching.
4. Add flat-per-order, per-item, weight-tier, percentage and free rate types with server-side condition evaluation.
5. Add shipping classes and package dimensions/empty weight for future carrier calculation.

Do not add carrier configuration, pickup, local delivery or Shiprocket in this phase without owner authorization and dedicated plans.

#### Taxes & Duties (`/settings/taxes`)

V1 is India/GST-specific:

- enable/disable tax collection;
- seller legal address and GSTIN validation;
- inclusive/exclusive price behaviour;
- place-of-supply rules and CGST/SGST vs IGST;
- product tax class/HSN linkage;
- shipping tax treatment;
- invoice and later credit-note requirements.

International taxes, duties, VAT reverse-charge, multicurrency and markets are deferred. Do not label the page “Duties” until the calculation engine supports them.

### Acceptance criteria

- [ ] Every shipping/tax configuration is tenant-isolated and recomputed from server-owned order/cart/product data.
- [ ] Money remains integer paise; percentage is integer basis points; weights/dimensions have documented canonical units.
- [ ] Rate/zone selection is deterministic, tested and explained in an admin preview.
- [ ] GST calculations and invoice data are verified against unit and real-DB checkout tests.
- [ ] No provider integration or hard-coded store rate is introduced.

## 8. Phase 7 — notifications, policies and customer privacy

### Goal

Give merchants controlled customer communication and compliance tooling, while preserving consent, platform mailer controls and the no-merchant-code rule.

### Scope

#### Notifications (`/settings/notifications`)

- Sender display name and safe support reply-to identity, using the platform mailer; no merchant SMTP/API key configuration.
- Customer events: order/payment/shipping/delivery/cancellation/refund/returns/account-security.
- Staff events: new order, payment exception, fulfilment request and return/dispute updates.
- Event enablement plus approved template selection/preview. Templates use enumerated variables/validated blocks—not arbitrary HTML or scripting.
- Email first; SMS/WhatsApp hidden or visibly unavailable until provider, consent, cost and delivery work exists.
- Every send is queued after commit and checks latest preferences at execution.

#### Policies (`/settings/policies`)

- Versioned draft/publish editor for Refund, Privacy, Terms, Shipping and Legal Notice.
- Validated content blocks only, immutable published snapshots, published date/actor and checkout/storefront links to published content.
- Seed templates require owner/legal approval; bsec does not give legal advice.

#### Customer privacy (`/settings/customer-privacy`)

- Cookie categories: necessary always on; analytics/marketing opt-in only, false by default.
- Data-sharing opt-out page and published privacy-policy link.
- Marketing consent preferences/revocation and customer privacy contact.
- Safe status/entry points for existing export/deletion workflows; never expose archives or platform data to unauthorized staff.

### Acceptance criteria

- [ ] Transactional and marketing communication are separate; marketing consent cannot suppress transactional/security events.
- [ ] Every consent/withdrawal is immutable, tenant-scoped and linked to text/policy version.
- [ ] Policy drafts never appear to shoppers/checkout; only published versions do.
- [ ] No merchant code/raw HTML/template scripting is accepted or executed.
- [ ] Privacy/export/deletion access control and audit trails have real-DB tests.

## 9. Phase 8 — storage visibility, maintenance scheduling and release hardening

### Goal

Complete the safe operational controls and prove the whole workspace across roles, devices and tenant boundaries.

### Scope

#### Storage (`/settings/storage`)

- Show usage, quota, media count, public-media status and retention explanation only.
- Never reveal bucket/endpoint/access key/secret, change provider, configure backups or manage private return-photo storage.

#### Maintenance

- Add schedule/start/end only after the owner decides authority and customer communication policy.
- Store times in UTC, present in store timezone; job changes status after commit through pg-boss.
- Maintenance response is server-enforced (503 + Retry-After) and audited. Staff preview/bypass remains scoped and hash/token safe.

#### Cross-cutting hardening

- Feature-flag per section and roll out tenant-by-tenant according to ADR-011.
- Verify legacy-route redirects, cache invalidation, domain readiness, permission migration, audit history and no duplicate editors.
- Conduct browser walkthroughs: 375px, tablet, desktop; light/dark; allowed/denied roles; network loading/error; dirty form; keyboard/focus; screen-reader labels where applicable.
- Run all required targeted tests one package at a time and the full gate before merge.

### Acceptance criteria

- [ ] Storage screen has no infrastructure mutation path.
- [ ] Scheduled maintenance can neither strand a store nor produce an unlogged status transition.
- [ ] Feature flags have documented fallback/rollback behaviour.
- [ ] All Settings routes comply with pending/loading/error/authorization requirements.
- [ ] No cross-tenant setting, audit entry, credential status or readiness signal is observable.

## 10. Cross-phase implementation checklist

Every builder and verifier must check these before a phase can be called complete:

- [ ] Contract changed first in `packages/contracts`; apps contain no business logic or direct DB access.
- [ ] Domain mutation contains `assertPermission`, tenant transaction, audit log and post-commit cache invalidation.
- [ ] Every tenant table/migration follows `tenantTable()`, `forceRlsSql`, composite foreign keys, append-only migration and grants.
- [ ] A setting has one canonical editor and live behaviour, or is absent/unavailable with a reason.
- [ ] Secrets are write-only, encrypted and absent from errors/logs/audit/query cache/client state.
- [ ] Side effects run post-commit via pg-boss.
- [ ] UI uses existing Admin standards: Settings frame, shared controls, `SimpleSelect`, `ConfirmDialog`, loading/error states and `pendingComponent`.
- [ ] New/changed procedure is mapped in the isolation suite; security/money/auth behaviour includes real-DB evidence.
- [ ] A change record reports exact test counts, browser verification and skipped work honestly.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check`, impacted fast suites and required heavy suites pass.

## 11. Owner decisions still required

The following decisions block the named phases. A builder must ask rather than choose:

1. Can Manager/Operations/Technical Support receive payment, tax, privacy, domain, staff-management or support-consent authority? (Phase 2.)
2. Is V1 intentionally India-only: INR, English and GST only? (Phases 4 and 6.)
3. Which account-creation mode is the default: guest-only, optional account, or account after verified completed order? (Phase 4.)
4. Which manual payment methods beyond COD are required, and how are they reconciled? (Phase 5.)
5. Is Razorpay the first online payment provider and when is provider work authorized? (Phase 5.)
6. Is merchant plan change request-only, or should self-service platform billing be built now? (Phase 5.)
7. What is the required shipping depth for V1: default zones/rates only, or profiles + pincode + weight + packages? (Phase 6.)
8. Who approves policy templates and DPDP/cookie wording? (Phase 7.)
9. Are email notifications the only near-term channel, or should SMS/WhatsApp be scheduled? (Phase 7.)
10. Who can enter/schedule maintenance, and must it notify customers automatically? (Phase 8.)

## 12. Suggested assignment order

Do not parallelize phases that edit the same data/permission/navigation files. A safe sequence is:

1. Verifier validates and merges Phase 0/1.
2. Builder A: Phase 2.
3. Builder B: Phase 3 after Phase 2 navigation/permission changes merge.
4. Builder C: Phase 4 after the owner answers account choices.
5. Builder D: Phase 5 only after explicit payment/billing authorization.
6. Builder E: Phase 6 only after shipping/tax scope decision.
7. Builder F: Phase 7 after legal/channel decisions.
8. Independent verifier: Phase 8 hardening plus full Settings walkthrough.

The primary coding agent verifies each external builder's output against the relevant phase acceptance criteria and the full repository gate before the next dependent phase begins.

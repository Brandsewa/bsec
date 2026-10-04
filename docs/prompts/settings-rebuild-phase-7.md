# Store Admin Settings rebuild — Phase 7 builder prompt (notifications, policies, customer privacy)

Paste this whole file as the first message of a new coding session in the `bsec` repo. You are the builder for **Phase 7 only**. Claude verifies against section 10 before Phase 8; you never merge your own PR.

Read first, in order: `AGENTS.md`; `docs/SETTINGS-PHASES-3-8-HANDOFF.md` (owner decisions §1, standards §3.2 point 9 on privacy); `docs/ARCHITECTURE.md`; newest `docs/changes/`; `docs/SETTINGS-REBUILD-REMAINING-PHASES.md` §8 and §10; `docs/SETTINGS-SCHEMA.md` §9 and §12; `docs/adr/010-no-merchant-code.md`; `docs/adr/019-customer-auth-and-platform-mailer.md`; `docs/adr/020-settings-capability-families.md`; `docs/admin-ui-standards.md`; `docs/migrations.md`.

## 0. Gate and state
- **Phase 6 must be merged.** If not, stop and tell the owner.
- Own worktree `../bsec-settings-p7`, branch `feat/settings-rebuild-phase-7`; claim in `progress.md`.
- bsec gives **no legal advice**. Every legal text you ship is a clearly labelled **starter draft that is never auto-published**; the owner (with their own counsel) approves the wording (owner decision 8). Do not claim legal compliance anywhere in the UI or docs; say "built to support" and list what the merchant must still do.

## 1. Objective
Give merchants controlled customer communication and compliance tooling: per-event email preferences enforced at send time, versioned store policies shown to shoppers only once published, and honest customer-privacy tooling (data-subject requests, consent evidence, contact point) aligned with India's DPDP Act 2023, while keeping transactional and marketing communication strictly separate. **Email is the only channel** (decision 9).

## 2. Audit (verified 2026-10-04; re-verify before relying on it)

| Area | Where | Today |
|---|---|---|
| Notification prefs | `store_settings.notifications` jsonb | **Read by nothing.** Emails send unconditionally. |
| Email events | `packages/domain/src/jobs.ts` (order confirmation ~91, shipped ~142, pre-order reminders/date change, abandoned recovery, returns, customer auth, staff invites), `system/email.ts` (`sendTransactionalEmail`), `system/email-templates.ts` (pure HTML+text builders, all text escaped), `system/platform-mailer.ts` | Idempotent per event via `email_log`; sender is the platform address with the store name as display name and the store support email as reply-to. |
| Delivery history | `email_log` (tenant table): `template`, `to_email` (plain), `subject`, `provider_id`, `status` queued/sent/failed, `event_ref`, `error`, timestamps | No event key, no channel, no `skipped` status, **no retention** (plain addresses kept forever). |
| Platform mailer state | `packages/domain/src/platform/email-settings.ts`, `platform_email_settings` | Configured by Super Admin; credentials are still pending (Zoho ZeptoMail). |
| Unsubscribe | `/unsubscribe/[token]`, `customers/unsubscribe.ts`, `mintUnsubscribeToken` | Page works; **emails do not link to it**; no `List-Unsubscribe` header. |
| Policies | `apps/web/src/app/policies/[type]/page.tsx` | **Hard-coded generic Privacy, Terms, Refund and Shipping text, dated 2026-09-01, served for every store.** Footer links to them. `return_settings.policyText` (≤1000 chars) is separate. No merchant editor exists. |
| Consent | `customer_consent_events` (channel, state, source, actor, **raw `ip`**, `at`); single writer `customers/consent.ts` | Email channel only. No text/policy version recorded. |
| Cookies | none | The storefront sets only **strictly necessary** cookies (cart token, customer session); **no analytics or marketing scripts exist**. |
| Data-subject tooling | `customers.delete` (hard delete or anonymise), `exports` (merchant CSV exports) | **No customer data export, no request intake or tracker.** |

### Defects to fix first (failing test first)
1. Every store publishes the same boilerplate legal text: stop presenting it as that store's policy (see 7B: it becomes an explicit fallback only until the store publishes, labelled in the admin as not yet set).
2. Emails ignore all preferences; transactional/marketing classes are not distinguished (a marketing-class send must check consent).
3. Raw IPs stored as consent evidence (hash going forward, see 7C).
4. `email_log` keeps plain recipient addresses forever (retention job, 7A).

## 3. Slice 7A: Notifications (`/settings/notifications`)
Contract `admin.notificationSettings.{get,update}`; `notifications.manage` in route **and** service (read `settings.read`); stale-write protection; audit.

`store_settings.notifications` becomes `v: 1` with a parser whose **defaults equal today's behaviour** (everything that sends today stays on):
```ts
type NotificationPreferencesV1 = {
  v: 1;
  sender: { displayName?: string /* 1..60, plain */; replyToEmail?: string /* valid email */ };
  customer: {            // only events that actually exist; add a key only when its send path exists
    orderConfirmation: boolean; shipment: boolean; delivery: boolean; cancellation: boolean;
    refund: boolean; returnUpdates: boolean; preorderReminders: boolean;
    accountSecurity: true;   // locked on: password reset, email verification; shown but not switchable
  };
  staff: { newOrder: { enabled: boolean; recipients: string[] /* 0..5 valid emails; default: support email or owner */ } };
  footerNote?: string;      // plain text 0..300, escaped when rendered; no HTML, no variables
  channels: { email: true };  // sms/whatsapp: not present in the parser at all
};
```
- **Enforcement:** every email job loads the store's preferences **at execution time** (after dequeue), not at enqueue time. A disabled event is **not sent and is logged** as `skipped` with `suppressed_reason = 'preference_off'` (so history stays truthful). Security and verification emails ignore the preferences entirely.
- **Classes (code constant `EMAIL_CLASS`):** `transactional` (order confirmation, shipment, delivery, cancellation, refund, returns, pre-order date change), `security` (auth), `marketing` (abandoned-cart recovery, newsletter, any promotional). Marketing sends require current **subscribed** consent in `customer_consent_events` for that email (single writer's current state) and include an unsubscribe link and the `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers (RFC 8058) if the platform mailer can set headers; if it cannot, add the support in the mailer. Preferences can never suppress `security`; marketing consent can never suppress `transactional`.
- **Staff new-order alert:** a new job on `order.created` (after commit, idempotent per order and recipient) emails the configured recipients a short summary link to the admin order (no customer PII beyond name and order number). Recipients are validated, deduplicated, rate-capped.
- **Sender:** `displayName` and `replyToEmail` apply to customer mail only; the **From address stays the platform's verified address** (never a merchant-chosen From: SPF/DKIM/DMARC alignment and anti-spoofing). Reject display names that contain an address-like string.
- **Platform status banner:** read the platform mailer state and show "Email delivery is not enabled on this platform yet; your settings are saved and will apply once it is" when unconfigured. Never claim "sent".
- **Delivery history table** (read-only, `notifications.manage`): last 100 from `email_log` with template, recipient masked (`a***@example.com`), status, time; filters by status and template; no raw error text beyond a safe code.
- Preview: a "Preview" of the approved template with sample data, rendered server-side through the existing pure builders (escaped); no template editing, no HTML upload (ADR-010).
- **Schema (expand-only):** `email_log` gets `event_key text null`, `channel text not null default 'email'`, `suppressed_reason text null`, a `check (channel = 'email')`, and status `skipped` is allowed (status is free text today: add the value to the documented set and to every status switch/filter). A pg-boss maintenance pass **prunes `email_log` rows older than 180 days** (configurable constant, documented); platform mail log already prunes at 90 days.

## 4. Slice 7B: Policies (`/settings/policies`)
Contract `admin.policies.{list,get,saveDraft,publish,versions,restoreDraft}`; `policies.manage` in route and service; audit on every save and publish.

**Schema (new tenant tables, `tenantTable()` + `forceRlsSql`):**
```
store_policies:
  id uuid pk; tenant_id; handle text not null check (handle in ('refund','privacy','terms','shipping','legal_notice'))
  title text not null check (char_length(title) between 1 and 120)
  draft_content jsonb not null  -- validated blocks v:1
  published_version_id uuid null   -- composite FK to store_policy_versions (tenantForeignKey)
  draft_updated_at, created_at, updated_at timestamptz
  unique (tenant_id, handle); unique (tenant_id, id)
store_policy_versions:     -- append-only
  id uuid pk; tenant_id; policy_id uuid not null (tenantForeignKey -> store_policies)
  version integer not null check (version >= 1); title text; content jsonb not null
  content_sha256 text not null; published_by uuid; published_at timestamptz not null default now()
  unique (policy_id, version); unique (tenant_id, id)
```
- **Append-only by grants:** grant `app_rw` only `SELECT, INSERT` on `store_policy_versions` (no UPDATE/DELETE); a real-DB test proves an UPDATE/DELETE is refused. (Extend the grants test suite pattern in `b2-grants.int.test.ts`.)
- **Content = validated blocks only** (ADR-010): `heading` (levels 2-3), `paragraph` (plain text with inline `bold`/`italic`/`link` marks), `list` (ordered/unordered), `divider`; links must be `https:` or `mailto:`/`tel:` after URL parsing (reject `javascript:`, `data:`); limits: ≤ 80 blocks, ≤ 30,000 characters total, ≤ 2,000 per paragraph; unknown block types or props are rejected, not stripped silently. No raw HTML, CSS or script is ever accepted or rendered. One shared validator in `@bs/blocks` or `packages/contracts` used by service and renderer.
- **Publish** is explicit: it snapshots the draft into a new immutable version (version = previous + 1, SHA-256 of the canonical JSON), sets `published_version_id`, invalidates the tenant cache after commit. Drafts never reach shoppers. "Restore as draft" copies an old version into the draft; history is never rewritten.
- **Starter drafts:** code constants (`policy-starters.ts`) for the four existing handles plus legal notice, each flagged `starter: true`, containing placeholders in `[square brackets]` and a visible banner "Starter draft, not legal advice. Review with your own advisor." They are offered via "Start from template" into the **draft** only; the publish action is disabled while placeholder markers remain or the starter banner block is present (server-checked).
- **Storefront:** `/policies/[type]` renders the published version (with its version and published date); footer links show only published policies. **Legacy fallback (flag `settings.policies`, ADR-011, default off = today):** while the flag is off or a store has published nothing, the existing boilerplate stays as is (so nothing disappears from live stores); the admin page says "Your storefront still shows the platform's generic text until you publish." With the flag on for a tenant, an unpublished handle returns **404 and is not linked**. Update `policyContent` consumers and `sitemap`/footer accordingly.
- **Terms consent at checkout (finishes Phase 4's reserved key):** extend the checkout parser with `termsConsent { enabled }`; allowed to enable only when `terms` is published. When on, checkout shows an **unticked, required** checkbox linking to the **published version**; `placeOrder` refuses without it. Evidence: expand `orders` with `terms_policy_version_id uuid null`, `terms_accepted_at timestamptz null` (composite FK; set from the server's current published version, never from the client). The return portal links to the published refund policy; `return_settings.policyText` stays readable for now (contract step later).

## 5. Slice 7C: Customer privacy (`/settings/customer-privacy`)
`privacy.manage` in route and service (read `settings.read`). **Honest scope:** the storefront uses only strictly necessary cookies and runs no analytics or marketing scripts, and merchants cannot add scripts (ADR-010). Therefore **do not build a cookie banner or analytics/marketing toggles** (rule: no setting without an enforcing consumer). The page shows the declared cookie inventory (cart token, customer session, store password gate; purpose, duration, necessary) as a static, test-locked table and says "No analytics or marketing cookies are used". A guard test fails if a new non-necessary cookie is introduced without updating this inventory.

**Schema (new tenant table):**
```
privacy_settings: id; tenant_id unique; privacy_contact_email citext null; grievance_officer_name text null (1..120);
  request_sla_days integer not null default 30 check (request_sla_days between 7 and 90);
  version integer not null default 1; updated_at, created_at
privacy_requests:   -- data principal requests (DPDP: access, correction, erasure, grievance; consent withdrawal)
  id uuid pk; tenant_id; customer_id uuid null (tenantForeignKey, set null when verified customer found)
  requester_email citext not null; kind text not null check (kind in ('access','correction','erasure','grievance','withdraw_consent'))
  details text null check (char_length(details) <= 2000)
  status text not null default 'pending_verification' check (status in ('pending_verification','open','in_progress','completed','rejected'))
  verified_at timestamptz null; due_at timestamptz not null; handled_by uuid null; handled_at timestamptz null; resolution_note text null (<=1000)
  created_at, updated_at; unique (tenant_id, id); index (tenant_id, status, due_at)
```
- **Intake** `POST /api/storefront/privacy-requests` + page `/privacy-request` linked from the footer and the published privacy policy: rate-limited per IP and email, `sameOrigin`, **email verification before anything is actioned** (single-use `action_tokens`, purpose `privacy_request_verify`, 24 h): this stops a third party requesting someone else's erasure. Anti-enumeration: the same response whether or not the email belongs to a customer.
- **Merchant queue** in the page (and a count on the Overview): status filters, due-date highlighting against `request_sla_days`, notes, mark in progress/completed/rejected with a reason; every transition audited; a daily job flags overdue requests to the merchant (staff email, preference-aware) and the page.
- **Actions** (merchant-triggered, `privacy.manage`): **Export**: build a JSON bundle (profile, addresses, orders summary lines, returns, consent history, reviews; **excluding** internal staff notes and other customers' data) into the existing private export storage with an expiring signed link emailed to the **verified** address; the file is deleted after 7 days by a job. **Erasure**: reuses `customers.delete` (anonymise when orders exist, hard delete otherwise); the UI states that orders and invoices are retained as tax law requires. **Withdraw consent**: writes an `unsubscribed` event through the single consent writer. Correction: staff edit via the existing customer editor, then mark completed.
- **Consent evidence:** `customer_consent_events` gains `text_version text null` and `ip_hash text null` (HMAC-SHA-256 of the IP with a per-tenant pepper stored as an encrypted tenant secret or derived from `TENANT_SECRETS_KEY` with a domain-separation label; never the raw IP). The writer stops writing raw `ip` going forward (old rows untouched; dropping the column is a later contract step). Record the checkout/newsletter label text version.
- **Retention note** documented in ARCHITECTURE per table (email_log 180 days; privacy_requests kept 3 years then purged by job unless open; export files 7 days; consent events kept for the life of the relationship plus the proof period).
- Data-sharing opt-out page: **omit** (the platform does not sell or share data with third parties; a switch would imply behaviour that does not exist). State that in the page.

## 6. Navigation, UI, permissions
Nav (**Operations** or **Compliance and advanced**, your call, documented): `Notifications` (`notifications.manage`), `Policies` (`policies.manage`), `Customer privacy` (`privacy.manage`). Pages follow the standard frame, (i) hover hints, dirty guard, `pendingComponent`, honest states (unavailable, queued, platform mail disabled). Policy editor: block list editor on the shared kit (add/move/delete block, preview as shopper would see it), draft vs published status chips, version history table with "Restore as draft", publish `ConfirmDialog` showing version number and what shoppers see. Update the Settings Overview "next steps" read model to link to these pages where relevant.

## 7. Tests
- **Unit:** preferences parser (defaults equal today, locked `accountSecurity`), class map, masking, block validator (every rejection path, URL schemes, limits, canonical hashing), starter-placeholder detection, consent text-version, IP hash determinism per tenant and difference across tenants, unsubscribe header builder, cookie inventory guard.
- **Real Postgres:** per procedure allowed / denied (`analytics.read`-only and a support session) / cross-tenant; stale-write conflicts; audit rows without secrets; **emails:** preference off → `skipped` row and no send, preference read at execution time (flip between enqueue and run), security mail unaffected, marketing mail refused without subscribed consent and sent with the headers when consented, staff new-order alert idempotent; **policies:** publish creates an immutable version, `UPDATE/DELETE` on versions refused by grants, draft never served, unpublished handle 404 only with the flag on and legacy text otherwise, terms checkbox required when enabled and the accepted version id recorded server-side; **privacy requests:** verification token single-use and expiring, anti-enumeration, rate limits, SLA due date, export bundle excludes staff notes and other tenants/customers, erasure keeps orders, withdraw writes an event, overdue job; `email_log` retention prune; consent writer stores hash not raw IP.
- **Isolation suite:** map every new `admin.*` procedure. **UI:** each page's states, policy editor interactions, permission-denied views. **Storefront:** policy pages, footer links, privacy request page, terms checkbox. **e2e:** keep green; prefix match.

## 8. Do not build
SMS, WhatsApp, push; merchant SMTP or API keys; template HTML/CSS/JS editing; custom From addresses; cookie banner, analytics or marketing integrations; data-sharing toggles; auto-publish of legal text; legal-compliance claims; policy translation. Do not touch Razorpay or Shiprocket.

## 9. Owner decisions already made
Email only; owner approves legal wording (starter drafts, never auto-published); India-only. **Raise, do not decide:** retention periods (email log 180 days, privacy requests 3 years, export files 7 days, SLA default 30 days) and the legal basis for abandoned-cart recovery email; who the grievance officer is for the platform itself versus each store.

## 10. Acceptance criteria
- [ ] Preferences are read at send time; skipped sends are logged truthfully; security email can never be disabled; marketing needs consent; transactional is never blocked by marketing consent.
- [ ] Policy drafts never reach shoppers; published versions are immutable (grants test); starter text is never auto-published and cannot be published with placeholders; no raw HTML/CSS/script anywhere; legacy fallback behaviour documented and flag-controlled.
- [ ] Checkout terms consent unticked, required when enabled, evidence stored from the server's published version.
- [ ] Privacy requests are email-verified, anti-enumerating, rate-limited, SLA-tracked, audited; export excludes staff notes and foreign data; erasure retains orders and says so; consent evidence stores hashes, not raw IPs.
- [ ] No cookie banner or analytics toggle exists; the cookie inventory table is test-locked.
- [ ] `notifications.manage`, `policies.manage`, `privacy.manage` enforced in route and service with denial tests; ADR-020 enforcement section updated; support sessions get none.
- [ ] Migrations append-only, RLS forced, grants test updated, journal increasing; retention jobs tested.
- [ ] Browser check at 375 px, tablet, desktop, light and dark, Owner/Manager/denied role, including a real policy publish and a privacy request round trip on a local stack (state what you drove). Gate: `typecheck`, `lint`, `build`, `docs:check`, fast suites, `@bs/domain` heavy (counts pasted).

## 11. Commit plan
1. `feat(notifications): preferences parser, execution-time enforcement, email classes, skipped logging, retention` 2. `feat(notifications): staff new-order alert and delivery history` 3. `feat(settings): notifications page` 4. `feat(policies): schema, validator, publish, immutable versions, grants` 5. `feat(storefront): published policies, flag-controlled fallback, terms consent` 6. `feat(settings): policies editor page` 7. `feat(privacy): privacy_settings, requests intake, verification, queue, export, erasure` 8. `feat(settings): customer privacy page and cookie inventory guard` 9. `docs: ARCHITECTURE, retention table, ADR-020 status, change record`.

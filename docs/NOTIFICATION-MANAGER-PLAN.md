# Notification Manager plan

Status: plan, owner decisions recorded 2026-10-27. Nothing built yet. Needs an ADR before phase 1 (changes the email architecture, ADR-006 and ADR-010 apply).

## 1. Owner decisions (2026-10-27)

| # | Decision |
|---|---|
| 1 | **Nobody but Super Admin edits notification text.** Stores and customers never edit wording. Stores customise **branding only**: logo, colours (template colour theme), footer details. |
| 2 | **Security emails are locked.** Only Super Admin can change them. Billing and lifecycle events are Super Admin controlled too. |
| 3 | **Super Admin alert routing is configurable per event by role, and also by individual email addresses.** |
| 4 | In-app delivery: **polling** first. |
| 5 | Retention: in-app notifications kept **30 days** for now (owner said 90, then 30; 30 is the last word, so the value is a platform setting, default 30). |
| 6 | **SMS and WhatsApp adapters are built now**, behind a disabled switch, so they go live when Zoho CPaaS credentials and DLT template approvals arrive. |
| 7 | First build covers all three together so the owner can see it: **dispatcher, Super Admin matrix UI, store admin settings.** |
| 8 | **Store admins can add extra recipient emails per notification** (not role based), in addition to the default owner/staff recipients. |

## 2. What exists today (summary)

- Email is the only live channel (platform mailer, ZeptoMail/SMTP). No in-app. SMS/WhatsApp are UI cards only.
- Customer emails: order confirmation, shipped, delivered, RTO, return requested, refund, pre-order changed and reminder, abandoned cart, password reset and changed, account setup, privacy verify. `customer_welcome` template exists but nothing sends it.
- Store staff: optional new-order email to up to 5 emails (`notification_preferences.staff.newOrder`), dunning (failed, reminder, limited) to store owners, password reset and changed.
- Super Admin: channel config and platform email log only. No event alerts.
- Known defects to fix in phase 1: staff alert skipped when the customer has no email; staff email has no items and a relative admin link; `staff_new_order` vs `staff_order_created` naming mismatch in `email-classes.ts` and `email.ts`; dunning has its own HTML outside the template system; email sending is spread over about 8 call sites.

## 3. Event catalog (the unit everything hangs on)

Code-defined registry in `packages/domain/src/notifications/catalog.ts`, synced to a table. Each event: `key`, `audience` (platform | store | customer), `category`, `channels allowed`, `locked` (cannot be disabled), `variables`, `defaultRecipients`.

**Platform (Super Admin / staff):** store signed up, store provisioned, trial converted, payment failed, store limited, subscription cancelled, deletion requested, webhook failures, domain verification failed, mailer failing, support request.

**Store admin:** welcome and store details, trial ending (7/3/1 days), trial expired, plan changed, payment succeeded with invoice, dunning (failed, reminder, limited), new order, Razorpay payment captured or failed, COD pending confirmation, return requested, low stock, out of stock, quota 80% and 100%, custom domain live or failed, staff invited or accepted.

**Customer:** welcome, order confirmation, shipped, delivered, RTO, cancelled, payment received (online), payment failed, return requested, return approved or rejected, refund, pre-order date changed, pre-order reminder, abandoned cart, back in stock (later), password reset and changed, account setup, privacy verify. Security ones are locked.

## 4. Data model (append-only migrations, expand/migrate/contract)

- `notification_events`: registry mirror (key, audience, category, locked, channels).
- `notification_rules` (platform defaults): per event and channel: `enabled`, `role_recipients[]`, `extra_emails[]`. Platform tables, `app_platform` writes.
- `notification_templates`: per event and channel: subject, body, version, draft or published. Super Admin only. Body is allow-listed variables (`{{order.number}}`) with escaping; no raw HTML or custom code (ADR-010).
- `notification_tenant_rules` (`tenantTable()` + `forceRlsSql`): per event and channel: `enabled` where the event is not locked, `extra_emails[]`. This is the store admin's "send this notification also to these emails".
- `platform_email_branding` (single row, Super Admin only): the BCom brand for platform to store emails: logo, primary and accent colours, background and text colours, button background and text colours, link colour, font family (from an allow-list of email-safe stacks), base font size and a heading scale (heading sizes derived from the base), footer details, support email. Replaces today's hardcoded `ACCENT` and the hand-written "Brand Sewa" dunning HTML.
- `store_email_branding` (tenant table with RLS; or extend `store_settings`): logo media id, accent colour, button background and text colours, link colour, template colour theme (enumerated presets plus accent, no free CSS), footer details (text, address, support email, social links as validated fields). Used only for store to customer emails.
- `notifications` (in-app inbox): tenant-scoped rows for store users, platform rows for Super Admin staff; recipient user, event key, `tab` (orders | system for store; stores | billing | system for platform), title, body, link, `read_at`, `archived_at`, `created_at`. Purged after the retention setting (default 30 days) by the existing retention sweep.
- `notification_deliveries`: one row per channel send (event, channel, recipient masked, status, suppressed reason, provider id). Generalises `email_log` and `platform_email_log`; old tables stay until contract phase.
- `platform_notification_settings`: in-app retention days, SMS and WhatsApp global enable switches.

## 5. Dispatcher

`packages/domain/src/notifications/`:

1. `emit(tx, eventKey, context)` called inside the business transaction; enqueues one pg-boss job `notification.dispatch` (ADR-006).
2. Consumer resolves, in order: event locked? platform rule enabled? store rule enabled (if allowed)? recipients = default (customer, or store owner and staff) + platform role recipients + platform extra emails + store extra emails; dedupe.
3. Fans out to channel adapters: **in-app** (insert row), **email** (existing platform mailer, keeps kill switch, preference, marketing-consent and List-Unsubscribe logic), **SMS and WhatsApp** (Zoho CPaaS adapter, gated by the disabled switch and by an approved DLT template id per event; skipped with reason `channel_disabled` or `template_not_approved`).
4. Idempotent through an event reference, as today. Failures retry via pg-boss; permanent config errors log and do not retry.
5. Rendering: one shared layout reading store branding (logo, colours, footer). Platform emails use the platform brand. Existing templates move onto the catalog with identical output first (snapshot tests), then change.

## 6. Super Admin UI ("Notifications" section)

1. **Events matrix**: rows grouped by audience and category; columns In-app, Email, SMS, WhatsApp; locked rows show a lock; SMS and WhatsApp columns show "Not connected" until enabled. Click a row for the detail drawer (about 40% wide, per admin UI standards).
2. **Recipients (platform events)**: choose roles and add individual emails per event.
3. **Template editor**: per event and channel, variable picker, preview with sample data, test send, version history, reset to default. SMS shows the DLT template id and character count.
4. **Delivery log**: unified, filterable by event, channel, status, store; retry for failed.
5. **Settings**: in-app retention, global channel switches, link to Integrations for provider credentials.
6. Every mutation writes `platform_audit_logs`.

## 6b. In-app notification drawer (owner reference design, 2026-10-27)

Right-side drawer opened from a bell in the header (about 40% wide on desktop, full width on mobile, per admin UI standards; border tokens only). Layout from the owner's reference: title with unread count badge and a settings gear, close button, tab row with a count per tab, a card list, and a footer with **Mark all read** and **Clear all**. Cards show an icon, title, one-line body, relative time (then date), a left accent or dot when unread, and click through to the linked page (marks read). Empty state per tab. Polling every 30 to 60 seconds while the tab is visible; unread count comes from a cheap count endpoint.

**Store admin tabs**
1. **Orders**: new orders, payment captured or failed, COD pending, returns and refunds, low stock and out of stock. Actionable items first.
2. **Activity**: the staff activity log (who changed what: settings, products, staff, access), sourced from `audit_logs`. Read-only feed; it is not a notification row, so no unread state and no clear-all; it shares the drawer and styling.
3. **System**: platform messages to the store: new features and upgrades, billing (trial ending, payment failed, invoice ready, plan changed), quota alerts, domain status.

**Super Admin tabs**
1. **Stores**: signups, provisioning, trial conversions, deletion requests.
2. **Billing**: payment failures, limited stores, cancellations, webhook failures.
3. **System**: mailer failing, domain verification failures, support requests, jobs health.
4. Optional **Activity** tab fed from `platform_audit_logs` (staff actions).

Each catalog event gets a `drawerTab` so grouping is data, not code. The gear opens the user's own preferences (mute categories, email digest later). "Clear all" archives for that user only (soft delete), never deletes other users' rows. Unread and read state is per recipient user.

## 6c. Two branding layers (owner decision 2026-10-27)

| Layer | Who sets it | Applies to | Controls |
|---|---|---|---|
| **Platform (BCom)** | Super Admin, global default | Every email and in-app message from the platform to store admins and staff: billing, dunning, welcome, trial, quota, admin security mail, Super Admin alerts | Logo, colours, font family, font size, footer |
| **Store** | Each store admin, Settings, Notifications | Every email from the store to its customers: orders, shipping, returns, refunds, account, abandoned cart | **Logo, colours, footer details only.** Font and size stay the platform defaults (email-safe) |

Rules:
- The renderer picks the layer from the event audience: `customer` events use the store brand; `store` and `platform` events always use the platform brand, even when about one store. A store never changes how platform emails look.
- Before a store sets branding, customer emails use defaults (store name as text logo, platform default colours).
- Colours are explicit tokens on both layers: background, text, **button background, button text, link colour**, plus accent and header. Button and link colours default to the accent. Both layers (platform and store) get them; the renderer uses them for every button and link, including the footer and unsubscribe links, replacing the hardcoded `ACCENT`.
- Branding is validated data, not code (ADR-010): hex colours with a contrast check, logo is an uploaded media asset with size and type limits, footer fields are plain text and validated links, all escaped. Fonts come from an allow-list of email-safe stacks.
- Store Settings, Notifications gets an **Email branding** card with live preview and test send to the admin's own address. Super Admin gets a **Platform email branding** page in the Notifications section. Changes write an audit row.
- The in-app drawer follows each app's own theme tokens, not email branding.

## 7. Store admin UI (Settings, Notifications)


- Per-event list for customer and store events: on/off (locked ones greyed), and **"also send to"** extra emails (validated, capped, e.g. 5 per event). Default recipients stay: owner and staff.
- **Email branding**: logo, colour theme and accent, footer details, with live preview. Sender display name and reply-to stay.
- In-app **bell and inbox** in the admin header (polling, unread count, mark read).
- Delivery log stays, now unified.
- No text editing of notification wording anywhere in store admin.

## 8. Phases and acceptance

1. **Foundation, no visible behaviour change**: ADR, catalog, tables, dispatcher, email adapter; move existing customer and staff emails onto it with snapshot-identical output; fix the defects in section 2. *Accept:* old emails byte-identical in tests; staff alert works without a customer email; real-DB tests for RLS on tenant tables and idempotency.
2. **In-app + Super Admin matrix + store settings (the visible slice)**: inbox table, bell with polling in admin and Super Admin, events matrix, role and email recipients, store "also send to", branding (logo, colours, footer). Wire new-order and signup alerts. *Accept:* signup creates a Super Admin in-app and email alert to the configured roles and emails; new order alerts store owner in-app and email plus extra emails; matrix toggles take effect; isolation suite maps new `admin.*` procedures.
3. **Templates**: Super Admin template editor, versions, preview, test send.
4. **Billing and lifecycle**: welcome and store details, trial reminders, payment success with invoice, dunning onto templates, quota, domain events.
5. **Gap fillers**: low stock, return decisions, cancelled, back in stock.
6. **SMS and WhatsApp live**: provider adapter is built in phase 2 or 3 behind the switch; this phase is credentials, DLT template ids and switching on. Needs owner go-ahead (rule 14 covers shipping and payments only, but this adds a paid provider).

Each phase: tests (real DB for tenancy, permissions, money), `docs/ARCHITECTURE.md` update, change record in `docs/changes/`, `progress.md` in-flight entry, gate from AGENTS.md section 4.

## 9. Open questions

- Which roles exist for Super Admin routing (owner/admin/staff roles in `packages/auth/src/permissions.ts`)? Confirm the list when building the recipients picker.
- Cap on extra emails per event (proposed 5) and whether extra recipients receive the same content as the owner (proposed yes).
- Branding colour presets: how many themes, and whether the accent may be any hex (proposed: any hex with a contrast check).
- Resolved 2026-10-27: store-facing billing mail uses the platform brand; customer mail uses the store brand (section 6c).
- Resolved 2026-10-27: platform font size is a base size plus a heading scale (owner confirmed).

# ADR-039: Notification manager (event catalog, dispatcher, in-app inbox, branded email)

- **Status:** Accepted
- **Date:** 2026-10-27
- **Plan reference:** `docs/NOTIFICATION-MANAGER-PLAN.md`

## Context
Emails were sent from about eight places, each with its own wording and styling, the only controls were seven customer toggles and an optional staff list, there was no in-app channel and no Super Admin alerts, and nobody could see or change what was sent without a deploy. The owner wants one place to enable, disable and route every notification for Super Admin staff, store admins and customers, across in-app, email and (later) SMS and WhatsApp, with branded, responsive emails.

## Decision
1. **The event catalog is code** (`packages/domain/src/notifications/catalog.ts`): key, audience, category, offered channels and defaults, drawer tab, locked flag, default recipients. The database stores only overrides.
2. **Rules** (`notification_rules`, platform, written by Super Admin; `notification_tenant_rules`, per store with RLS) decide which channels are on and who else receives it. Precedence: catalog default, then Super Admin, then the store, except locked events (security and billing) which a store can never switch off. Stores add "also send to" addresses for store events only, never for customer emails.
3. **One dispatcher** (`dispatchNotification`) runs in the `notification.dispatch` job, enqueued after commit (ADR-006). It resolves recipients, writes in-app rows (idempotent on user and event reference) and sends email through the platform mailer. Customer emails keep `sendTransactionalEmail`, which now consults the same rules.
4. **Wording is platform-owned.** Stores and customers cannot edit text (owner decision 2026-10-27). Stores set only logo, colours and footer.
5. **Two branding layers** (`platform_email_branding`, `store_email_branding`) of validated tokens (hex colours, https logo, allow-listed fonts, escaped footer text and links), never code or CSS (ADR-010). Fonts and sizes come only from the platform. A contrast check replaces unreadable button, text and link colours.
6. **In-app inbox** rows live in `notifications` (tenant, RLS) and `platform_notifications` (staff). The drawer polls; retention is 30 days (`notification.retention_sweep`, daily).
7. **SMS and WhatsApp** have a final adapter contract (`notifications/sms.ts`) that returns `disabled` until a provider and DLT-approved templates exist. Nothing is sent and no provider key is added.
8. **Platform staff stay unreadable to the tenant runtime.** The worker (`app_rw`) resolves Super Admin recipients through one `SECURITY DEFINER` function, `notification_platform_recipients(roles)`, which returns only user id, email and role of active staff. `platform_notifications` gives `app_rw` INSERT, DELETE and `SELECT(id, created_at)` only (the same shape as `platform_email_log`); rules and branding are read-only to `app_rw`.

## Consequences
- Adding an event is one catalog entry plus an `emit`/`dispatch` call. The Super Admin matrix and the store list render from the catalog.
- `store_new_order` now notifies the store's owner and admins by default (in-app and email), where the older staff list was opt-in. The old list still works and is merged in. The alert no longer depends on the shopper having left an email address.
- Dunning (failed, reminder, limited) now goes through the dispatcher: an in-app card plus an email in the BCom brand, once per store and kind.
- Tests: `notifications.int.test.ts` (real Postgres), `email-branding.test.ts`, the isolation, RBAC, audit-coverage and read-endpoint suites, and the `b2-grants` write-surface list now include these tables.
- Duplicate emails are possible on a retry for Super Admin extra addresses when in-app is switched off, because platform emails have no per-recipient log. Acceptable for alerts; revisit if it matters.

## Alternatives considered
- **Database-defined events and templates now:** more flexible, but wording and routing would be editable before the owner has decided what Super Admin should be able to change; the catalog in code keeps the surface reviewable. A template editor can be added on top.
- **Granting `app_rw` read access to `platform_staff`:** simpler, but breaks the rule that the tenant runtime cannot read platform staff (b2-grants).
- **A separate service for notifications:** unnecessary at this scale; pg-boss already provides durable fan-out.

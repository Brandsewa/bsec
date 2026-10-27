# Notification manager: event catalog, dispatcher, in-app drawer, branded responsive emails

- **Date:** 2026-10-27
- **Agent:** claude
- **Branch:** `feat/notification-manager` (not merged yet)
- **Area:** db, domain, contracts, web, platform, admin, superadmin, ui, docs
- **Type:** feature
- **Supersedes:** none

## Summary
First build of `docs/NOTIFICATION-MANAGER-PLAN.md` (phases 1 and the visible part of 2): a code-defined event catalog, a dispatcher, an in-app inbox with a bell and tabbed drawer in the store admin and Super Admin, a Super Admin events matrix and email-branding editor, store-side team alerts (with "also send to" emails) and email branding, and a modern responsive email layout driven by branding tokens. SMS and WhatsApp have a final adapter that stays disabled. Nothing was pushed or deployed.

## What changed
- Migration `0082_notification_manager`: `notification_rules`, `notification_tenant_rules`, `platform_email_branding`, `store_email_branding`, `notifications`, `platform_notifications`, function `notification_platform_recipients`. Queues `notification.dispatch` and `notification.retention_sweep` (daily 03:30, 30 days).
- `packages/domain/src/notifications/` (catalog, rules, dispatcher, service, sms adapter, branding loader) and `system/email-branding.ts`. `system/email-templates.ts` has a new table-based responsive layout (mobile breakpoint, full-width buttons on phones, bulletproof button, preheader, logo, token colours, fonts, footer) plus a general `notice` template. `sendTransactionalEmail` now consults the rules and applies store branding.
- Order created: the store alert runs through the dispatcher, also when the shopper has no email (it was skipped before) and now links to the admin. Dunning and `platform_store_signup` use the dispatcher.
- Contracts `admin.notifications.*` and `notifications.*` (platform). UI: `NotificationDrawer`, `NotificationBell`, `EmailBrandingEditor` in `@bs/ui`; Super Admin `/notifications` (Events, Email branding) and header bell; store admin Settings: Team alerts and Email branding, header bell (needs `orders.read`).

## Decisions and trade-offs
See ADR-039. Notably: wording is platform-owned; stores edit only logo, colours, footer; locked security and billing events; the inbox needs `orders.read` (the isolation suite requires a permission on every admin procedure); the logo is an https image address for now (a media picker can follow); in-app retention is a constant (30 days), not yet a Super Admin setting.

## Verification
- Ran (local, Docker Postgres on port 55432): `@bs/db` 41 pass (b2-grants write-surface list updated); `@bs/platform` int suites 135 pass (RBAC, audit coverage, read endpoints include the new procedures); `@bs/domain` `notifications.int.test.ts` 13 pass, `email-branding.test.ts` 16 pass, fast suite 473 pass, queue-consumers, dunning, provisioning, signup and settings-audit suites pass; `isolation.int.test.ts` 1544 pass, 6 fail.
- The 6 failures are `admin.products.attachMedia/detachMedia/reorderMedia/updateMedia` and `admin.media.create/replace` ("Uploaded file not found in storage"). I reproduced the same failure on an unmodified `origin/main` checkout in this environment, so they are not from this change.
- Typecheck passes for domain, contracts, ui, web, platform, superadmin, admin. ESLint clean on the changed packages.
- Exercised by hand: rendered the order, shipped and notice emails to HTML and looked at them in the built-in browser at desktop and 375 px width (stacked layout, brand colours, full-width mobile button).
- NOT verified: the app screens in a browser (drawer, events matrix, branding editors, team alerts) because that needs the full dev stack and logins; a real email in Gmail, Outlook or Apple Mail; no SMTP was configured. Full `pnpm build`, `pnpm test:heavy` for every package and CI have not been run.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (migration 0082, queues, tables, Super Admin and admin pages)
- [x] ADR-039
- [ ] `DEPLOYMENT.md` / RUNBOOK: no new env vars; `SUPERADMIN_ORIGINS` and `ADMIN_HOST` are used to build links
- [x] `progress.md` (in flight)

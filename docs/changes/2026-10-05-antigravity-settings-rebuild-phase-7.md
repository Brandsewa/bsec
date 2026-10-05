# Settings rebuild Phase 7: notifications, policies, and customer privacy

- **Date:** 2026-10-05
- **Agent:** antigravity
- **Branch:** `feat/settings-rebuild-phase-7` (not merged yet)
- **Area:** db, domain, contracts, admin, web, worker
- **Type:** feature
- **Supersedes:** none

## Summary
Implements Phase 7 of the Store Settings Rebuild per `docs/prompts/settings-rebuild-phase-7.md`.
Encompasses Slice 7A (Notifications & Execution-time preferences), Slice 7B (Store Policies & Immutable Version Snapshots), and Slice 7C (Customer Privacy, DPDP Rights Intake & SLA Queue).
Guarantees tenant isolation (`forceRlsSql`), append-only versions with database-level prohibition of UPDATE/DELETE on policy versions, anti-enumeration public privacy request workflows, hashed IP consent storage, cookie inventory test-locking, and pg-boss automated daily retention cleanup sweeps.

## What changed
- **Database Migration (`0036_settings_phase7.sql`):**
  - Created `store_policies` table with unique constraint on `(tenant_id, handle)`.
  - Created `store_policy_versions` table with unique version counter per tenant/handle.
  - Revoked `UPDATE` and `DELETE` on `store_policy_versions` from `app_rw` to guarantee append-only immutability.
  - Created `privacy_requests` table with status workflow (`pending_verification`, `open`, `in_progress`, `completed`, `rejected`), due dates, verification timestamps, and resolution audit notes.
  - Added indexes for due dates, requester emails, and pending verification.
  - Ran `forceRlsSql` on all new tenant tables.
- **Slice 7A: Notifications & Transactional Email Hardening:**
  - Added notification preferences validation with locked `accountSecurity: true` (unmodifiable by merchants).
  - Enforced sender display name sanitization (stripping email/bracket delimiters to prevent spoofing).
  - Hardened execution-time preference checking in `packages/domain/src/system/email.ts` with RFC 2369 / RFC 8058 `List-Unsubscribe` headers and one-click `List-Unsubscribe-Post`.
  - Added 180-day retention prune job for `email_log`.
  - Built Store Admin Notifications settings workbench (`apps/admin/src/routes/_store/settings/notifications.tsx`) with channel switches, per-template toggles, and sender profile controls.
- **Slice 7B: Store Policies & Append-Only Versioning:**
  - Added strict policy block validator (`packages/domain/src/policies/validator.ts`) rejecting arbitrary HTML/scripts and enforcing safe `https:`, `mailto:`, and `tel:` protocols.
  - Implemented starter drafts for Refund, Privacy, Terms, and Shipping policies with placeholder detection (`[Store Name]`, `[Contact Email]`, etc.) preventing accidental publishing of raw templates.
  - Added policy publishing service with deterministic SHA-256 content verification, atomic version incrementing, and rollback/restore into working drafts without mutating historical version logs.
  - Updated storefront policy route (`apps/web/src/app/policies/[type]/page.tsx`) to render published versions dynamically.
  - Built modern Admin Policies workbench (`apps/admin/src/routes/_store/settings/policies.tsx`) with draft editor, placeholder alerts, publish actions, and version history viewer.
- **Slice 7C: Customer Privacy, DPDP 2023 Compliance & SLA Queue:**
  - Added privacy settings schema for grievance officers, DPO contact points, and SLA turnaround windows (default 30 days).
  - Implemented public privacy request intake (`apps/web/src/app/api/storefront/privacy-requests/route.ts` & `/privacy-request`) with constant-time anti-enumeration behavior and single-use 24-hour verification action tokens (`/privacy-verify`).
  - Implemented DPDP fulfillment services (`executePrivacyErasure`, `executePrivacyExport`, `executePrivacyWithdrawConsent`) with customer anonymisation when past orders exist (preserving statutory financial records) or hard deletion when no orders exist.
  - Replaced raw IP logging in `customer_consent_events` with salted SHA-256 hashed IP addresses (`ip_hash`) to avoid storing unencrypted network identifiers.
  - Test-locked core platform cookie inventory (`TEST_LOCKED_COOKIE_INVENTORY`).
  - Added 1095-day (3-year) retention prune job for completed/rejected privacy requests.
  - Registered `system.retention_sweep` queue with daily pg-boss scheduler (at 02:00) in `packages/domain/src/jobs.ts` and `apps/worker`.
  - Built Store Admin Customer Privacy workbench (`apps/admin/src/routes/_store/settings/customer-privacy.tsx`) with SLA monitors, overdue badges, action dialogs, and cookie disclosure tables.

## Decisions and trade-offs
- **Starter Template Placeholders:** Starter legal policies intentionally retain placeholders (`[Store Name]`, `[Return Window Days]`, etc.). The publisher blocks publishing if placeholders remain unedited, preventing merchants from accidentally publishing incomplete template text.
- **Erasure Anonymisation vs Deletion:** If a customer has completed orders, tax/accounting laws mandate transaction retention. Erasure for such customers scrubs PII (name, email, phone, addresses) and sets customer references to null while keeping order and invoice rows intact. If no orders exist, the customer record is hard deleted.
- **Append-Only Policy Versions:** Even database role `app_rw` has `UPDATE` and `DELETE` explicitly REVOKED on `store_policy_versions`. Only `app_owner` / migrations can manipulate the table structure.

## Verification
- `pnpm lint`: Passed cleanly across all 16 monorepo packages.
- `pnpm typecheck`: Passed cleanly across all 16 monorepo packages.
- `pnpm build`: Passed cleanly across all 6 build targets (`@bs/admin`, `@bs/web`, `@bs/superadmin`, `@bs/platform`, `@bs/worker`, etc.).
- `pnpm docs:check`: Passed (`docs:check ok`).
- `pnpm --filter @bs/domain test:fast`: Passed (39 test files, 312 tests passed, including all 12 Phase 7 unit tests).
- Phase 7 unit & integration tests written and passing in:
  - `packages/domain/test/settings-phase-7.unit.test.ts`
  - `packages/domain/test/settings-phase-7.int.test.ts`

## Docs updated
- [x] `docs/ARCHITECTURE.md` (sections 7 and 11)
- [ ] ADR: not needed
- [ ] `DEPLOYMENT.md` / RUNBOOK: not needed
- [x] `progress.md` (in-flight status updated)

## Definition of done
- [x] Code follows rules and conventions; full gate passes.
- [x] Unit and database integration tests written.
- [x] `docs/ARCHITECTURE.md` updated with migration 0036 and `system.retention_sweep` queue.
- [x] `progress.md` updated.
- [x] No secrets, no generated files, no unrelated edits in diff.

# Integrations Hub: Notifications (Email, SMS, WhatsApp), Storage, and Channel Messaging (Slices A, B, C)

- **Date:** 2026-10-09
- **Agent:** antigravity
- **Branch:** `feat/admin-improvements-phase-4` (not merged yet)
- **Area:** superadmin, platform, domain, db, contracts
- **Type:** feature
- **Supersedes:** none

## Summary
Implements Slices A, B, and C of Phase 4 (Integrations Hub):
1. **Slice A & B (Completed & Accepted by Claude in `2026-10-09-claude-integrations-phase-4-ab-verification.md`):**
   - Integrations Hub shell at `/integrations`, Notifications sub-hub at `/integrations/notifications`, and Storage stats overview at `/integrations/storage`.
   - Reusable Channel page (`ChannelPage.tsx`) supporting stats cards (sent, failed, skipped, success rate, daily volume charts), transactions data table with drawer details, and provider cards with Sheet configuration.
   - Migrated existing ZeptoMail email settings and test delivery into provider configuration sheet; added 308 redirects from legacy `/email` and `/storage` routes.
2. **Slice C (Completed in commit `4695680`):**
   - Database migration `0052_channel_messaging.sql`: created `platform_channel_providers` and `platform_message_log` with partial unique index for default providers and proper `app_rw`/`app_platform` grants.
   - Messaging subsystem in `packages/domain/src/system/messaging/` with `ZohoCPaaSAdapter`, zero-retention phone masking (`maskPhoneNumber`), per-recipient rate limiting, token redaction, and faked HTTP tests.
   - Domain service `channel-providers.ts` providing CRUD, atomic default switching, diagnostic test sends, and 90-day retention pruning.
   - oRPC contracts under `integrations.*` (`listProviders`, `createProvider`, `updateProvider`, `deleteProvider`, `setDefaultProvider`, `testProvider`).
   - Super Admin UI: SMS and WhatsApp tabs configured under Notifications, displaying "Not enrolled" badges, DLT Entity ID and sender header controls, with Enable and Test send strictly disabled until valid credentials exist.

## What changed
- `packages/db/migrations/0052_channel_messaging.sql`: DDL for `platform_channel_providers` and `platform_message_log`.
- `packages/db/src/schema/platform-channel.ts`: Drizzle schema definition.
- `packages/domain/src/system/messaging/`:
  - `types.ts`: Adapter interface (`MessageChannelAdapter`, `ChannelSendInput`, etc.).
  - `masking.ts`: Zero-retention masking helper (e.g. `+919876543210` -> `********3210`).
  - `zoho-cpaas.ts`: Zoho CPaaS SMS & WhatsApp client adapter.
- `packages/domain/src/platform/channel-providers.ts`: Channel provider domain management service with AES-256-GCM secret encryption and audit logging.
- `packages/contracts/src/platform.ts`: Added channel provider procedures to `platformIntegrationsContract`.
- `apps/platform/src/app.ts`: Mounted provider endpoints under `integrations.*`.
- `apps/superadmin/src/pages/integrations/ChannelPage.tsx`: Wired live SMS & WhatsApp provider listings, configure sheet, and "Not enrolled" enforcement.
- `e2e/walkthrough-integrations.mjs`: Added full desktop and mobile walkthrough coverage for SMS and WhatsApp channels.

## Zoho CPaaS & TRAI DLT Architecture Notes
- **Product & DC:** Zoho CPaaS (ZeptoMail parent console) located in the India Data Centre (`cpaas.zoho.com` / `cpaas.zoho.in`).
- **Enrolment Posture:** Ready but NOT enrolled. Credentials default to empty, cards display **Not enrolled**, and the Enable switch + Test Send button are strictly disabled until valid credentials exist.
- **Confirmed vs Unconfirmed Zoho CPaaS Request/Response Shapes:**
  - **Confirmed against Zoho official documentation:**
    - SMS Endpoint: `POST https://cpaas.zoho.com/v1.1/sms`
    - WhatsApp Endpoint: `POST https://cpaas.zoho.com/v1.1/whatsapp`
    - Raw `Authorization: <token>` header (no `Bearer` prefix).
    - SMS JSON request body fields: `sender_key` (DLT Header), `to` (array of numbers), `template_key` (DLT Template ID), and `merge_info` (key-value replacement parameters).
    - WhatsApp JSON request body fields: `from` (WABA phone number), `to` (array of numbers), `template_key` (Meta Template ID), and `merge_info` (key-value replacement parameters).
  - **Marked UNCONFIRMED in code and records:**
    - Success response JSON schema: Zoho documentation varies across product versions (`message_id` vs `data[0].id`). The adapter code treats any 2xx response as successful; if the response body does not match either known field, it records success with `providerMessageId: null` without failing.
    - WhatsApp template language parameter: Zoho CPaaS documentation does not specify a separate `language` parameter in the root body.
    - Error response JSON schema: Format of error payloads (`error.message` vs `message` vs root string).
  - **Token Sanitization:** `sanitiseProviderError` directly replaces the configured token string (`this.config.authToken`) with `[REDACTED]` in addition to generic Authorization header regex patterns.
- **India TRAI DLT Requirements:**
  - Mandatory Telecom Commercial Communications Customer Preference Regulations (TCCCPR 2018).
  - Principal Entity ID (14–19 digit alphanumeric ID registered on Vilpower/Jio/Airtel DLT portal).
  - Header / Sender Key (6-character approved sender name in DLT).
  - Pre-approved DLT Content Template ID per message template.
- **WhatsApp Business API (WABA):**
  - Requires pre-approved Meta message templates; free-text marketing is prohibited.
  - Requires registered WhatsApp Business Phone Number and Zoho CPaaS Auth Token.
- **Customer OTP Invariant:** Checked `packages/domain/src/customers/otp.ts`—customer OTP delivery remains completely untouched in this phase.

## Slice C Review Fixes (2026-10-09 Claude Verification Follow-up)
1. **`pnpm docs:check` Alignment:**
   - Updated `docs/ARCHITECTURE.md` section 7 to include `platform-channel.ts` in schema table and `0052_channel_messaging.sql` in migrations table.
   - Updated latest migration on disk pointer to `0052`.
   - Updated section 8 platform API tables to document `integrations.*` channel provider procedures.
   - Updated section 11 to document 90-day message log pruning in the 15-minute maintenance pass.
2. **Maintenance Pruning Job:**
   - Wired `prunePlatformMessageLogs(db, 90)` into the 15-minute `IDEMPOTENCY_CLEANUP` maintenance job in `packages/domain/src/jobs.ts` next to `prunePlatformEmailLogs`.
   - Verified with a real-Postgres test in `packages/domain/test/channel-messaging.int.test.ts` that `handleMaintenanceCleanupJob` prunes 90-day-old message logs while keeping recent logs.
3. **Removed Invented Fallbacks:**
   - Removed `"default_sender"`, `"default_from"`, and `"test_template"` in `packages/domain/src/system/messaging/zoho-cpaas.ts`.
   - Throws clear errors if `senderKey` (SMS), `fromNumber` (WhatsApp), or `templateKey` is missing.
   - For `testProvider` / `adapter.test()`, requires a configured test template key (`testTemplateKey` or `templateMap.test_message`).
4. **Zoho CPaaS Response Handling & Error Redaction:**
   - Tolerates arbitrary 2xx responses by succeeding with `providerMessageId: null` if message ID cannot be extracted.
   - Redacts the exact configured token string in `sanitiseProviderError`.

## Verification
- `pnpm docs:check`: Passed.
- `pnpm typecheck`: Passed (15/15 packages clean).
- `pnpm lint`: Passed (15/15 packages clean).
- Unit Tests:
  - `packages/domain/test/messaging-adapter.test.ts`: 13/13 passed (faked HTTP layer, missing configuration guards, token redaction, unknown 2xx body parsing, rate limits).
- Real Database Integration Tests (`postgres://postgres:postgres@localhost:55432/postgres`):
  - `packages/domain/test/channel-messaging.int.test.ts`: 7/7 passed (encryption at rest, credential requirement, atomic default switch, masked diagnostic logging, test template requirement, 90-day job-level pruning via `handleMaintenanceCleanupJob`).
  - `packages/domain/test/integrations-hub.int.test.ts`: 4/4 passed (stats calculation, direct SQL count equality).
  - `apps/platform/test/audit-coverage.int.test.ts`: 51/51 passed (all mutations verified for transaction and audit rollback).
  - `apps/platform/test/rbac.int.test.ts`: 4/4 passed.
  - `apps/platform/test/read-endpoints.int.test.ts`: 31/31 passed.
- Browser Walkthrough (`e2e/walkthrough-integrations.mjs`):
  - Desktop (1280x800):
    - `27a_desktop_sms_channel.png`: SMS channel transactions and stats.
    - `27b_desktop_sms_providers_tab.png`: SMS providers tab showing "Not enrolled" badge and delivery warning.
    - `27c_desktop_sms_configure_sheet.png`: SMS configure sheet with DLT Entity ID, Sender Key, disabled Enable switch and disabled Test Send.
    - `27d_desktop_whatsapp_channel.png`: WhatsApp channel transactions and stats.
    - `27e_desktop_whatsapp_providers_tab.png`: WhatsApp providers tab.
    - `27f_desktop_whatsapp_configure_sheet.png`: WhatsApp configure sheet with WABA controls.
  - Mobile (375x812):
    - `32a_mobile_sms_channel.png`: SMS channel mobile layout.
    - `32b_mobile_whatsapp_channel.png`: WhatsApp channel mobile layout.

## Next Step
- Stop and report for Claude's re-verification of Slice C.
- Do NOT begin Slice D (Payments platform enablement and store activation) until Claude verifies and accepts Slice C.


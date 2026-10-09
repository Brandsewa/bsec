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
- **India TRAI DLT Requirements:**
  - Mandatory Telecom Commercial Communications Customer Preference Regulations (TCCCPR 2018).
  - Principal Entity ID (14–19 digit alphanumeric ID registered on Vilpower/Jio/Airtel DLT portal).
  - Header / Sender Key (6-character approved sender name in DLT).
  - Pre-approved DLT Content Template ID per message template.
- **WhatsApp Business API (WABA):**
  - Requires pre-approved Meta message templates; free-text marketing is prohibited.
  - Requires registered WhatsApp Business Phone Number and Zoho CPaaS Auth Token.
- **Customer OTP Invariant:** Checked `packages/domain/src/customers/otp.ts`—customer OTP delivery remains completely untouched in this phase.

## Verification
- `pnpm typecheck`: Passed (15/15 packages clean).
- `pnpm lint`: Passed (15/15 packages clean).
- Unit Tests:
  - `packages/domain/test/messaging-adapter.test.ts`: 8/8 passed (faked HTTP layer, request shapes, token redaction, rate limits).
- Real Database Integration Tests (`postgres://postgres:postgres@localhost:55432/postgres`):
  - `packages/domain/test/channel-messaging.int.test.ts`: 6/6 passed (encryption at rest, credential requirement, atomic default switch, masked diagnostic logging, 90-day pruning).
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
- Stop and report for Claude's verification of Slice C.
- Upon Claude's approval, proceed to Slice D (Payments platform enablement and store activation).

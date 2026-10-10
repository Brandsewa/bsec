# Verification of Phase 4 slice C (Zoho CPaaS SMS and WhatsApp, not enrolled): changes requested

- **Date:** 2026-10-09
- **Agent:** claude
- **Branch:** `docs/admin-improvements-plan` (verifies `feat/admin-improvements-phase-4` at `e65805c`)
- **Area:** domain, db, platform, superadmin
- **Type:** test
- **Supersedes:** none

## Summary
Not accepted yet: the docs gate fails and three code items need fixing. The design is right.

## Verification
- `pnpm docs:check`: **fails** ("docs/ARCHITECTURE.md migration table is missing 0052_channel_messaging.sql").
- Typecheck and lint pass (all cached).
- `channel-messaging.int.test.ts`, `messaging-adapter.test.ts`, `integrations-hub.int.test.ts` (real Postgres): 18 of 18 pass. `apps/platform` rbac + read-endpoints + audit-coverage: 86 of 86 pass.
- Fetched Zoho's own pages for the SMS and WhatsApp APIs and compared them with the adapter.
- Not re-run by me: whole heavy suite, build, the browser walkthrough.

## Matches Zoho's published docs
`POST https://cpaas.zoho.com/v1.1/sms` with `Authorization` holding the raw token (no "Bearer"), body `sender_key`, `template_key`, `to: [{ mobile_no }]`, `merge_info`; `POST .../v1.1/whatsapp` with `from`, `to`, `template_key`, `merge_info`. Zoho's pages mention no DLT request fields, so the unused `entityId` config is only a stored note. Zoho's pages do not document the response body or the WhatsApp language field.

## Must fix
1. **`pnpm docs:check` fails.** Add migration 0052 and the two new tables (`platform_channel_providers`, `platform_message_log`) to `docs/ARCHITECTURE.md` section 7; check sections 3, 8 and 11 for the messaging module, the new `integrations.*` procedures and the retention prune.
2. **The 90-day retention prune is never run.** `prunePlatformMessageLogs` exists but nothing calls it except the test. Call it from the existing 15-minute maintenance pass in `packages/domain/src/jobs.ts` next to `prunePlatformEmailLogs`, with a test that the job path prunes.
3. **Invented fallback values can reach the provider.** The adapter falls back to `"default_sender"`, `"default_from"` and, for the test message, `"test_template"` when `senderKey`, `fromNumber` or a template key are not configured. A configured-looking but fake key must never be sent. Return a clear "not configured: sender key / from number / template key" error instead, and make Test send require a real mapped test template.
4. **Unconfirmed items must be labelled.** The change record does not say the API shapes were checked against Zoho's docs, and the success handler reads `data[0].message_id`, which Zoho does not document. Record which parts are confirmed (above) and mark the response parsing, the WhatsApp language field and error format as UNCONFIRMED in the record and in a code comment; treat an unknown success body as success without an id rather than failing.

## Smaller notes
- `sanitiseProviderError` redacts the ZeptoMail-style `Zoho-enczapikey` token pattern; also redact the actual configured token value wherever it appears.
- The per-recipient rate limit is an in-memory map, so it is per process. Fine for now; note it in the record.

## Docs updated
- [ ] none needed for this record

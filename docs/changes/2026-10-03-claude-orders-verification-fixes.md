# Verification of the Orders work and fixes found on top of it

- **Date:** 2026-10-03
- **Agent:** claude
- **Branch:** `fix/orders-verification`
- **Area:** domain, web, docs, infra
- **Type:** fix
- **Supersedes:** none

## Summary
Claude verified the Orders stack (`7a7f49f`) and then Antigravity's fix branch (`6ce29ca`). The fix branch resolved the journal bug, the open photo upload, the unmapped isolation procedures and the failing web test (see `2026-10-02-antigravity-orders-fixes.md`). Claude found and fixed three more defects in the photo work and one it created.

## What changed
- `orders/return-photos.ts`: the daily cleanup job queried `media` and `returns` with no tenant context. Those tables have row level security and the worker runs as `app_rw`, so in production it would have matched nothing (the test ran as the bypass role, which hid it). It now runs per tenant inside `withTenant`, deletes the stored file first and **keeps the record when the file cannot be deleted**, so the next run retries.
- The presign key used the client's filename extension (default `jpg`) while the descriptor defaulted to `bin`: a filename without a dot produced a key that never matched finalize. The extension now comes from the validated content type and the returned key is the one actually signed.
- **Private storage.** `media.bcom.si` is the public address of the whole media bucket, so return photos stored there were readable by anyone holding a key. Photos now require a separate private bucket (`R2_PRIVATE_BUCKET_NAME`) that must differ from the public one; without it uploads are refused, the portal stops asking for photos, and the "photo required" rule is not enforced. Signed admin links, finalize, cleanup and store deletion all use that bucket (`platform/deletion-steps.ts` now deletes a store's photos from both buckets).
- Tests added: cleanup under `app_rw`, cleanup keeps the record on delete failure, dotless filename, unconfigured and same-as-public bucket refused, photo requirement relaxed when storage is not configured, bucket split for store deletion. The first three fail on the previous code.
- `DEPLOYMENT.md` documents `R2_PRIVATE_BUCKET_NAME`, its CORS rule and a lifecycle rule; `docs/ARCHITECTURE.md` documents the photo flow.

## Decisions and trade-offs
- Fail closed, not open: with no private bucket there is no photo upload, rather than writing evidence into a public bucket.
- Objects uploaded but never finalized are invisible to the cleanup job (no database row). A bucket lifecycle rule is the right tool; it is a Cloudflare setting, documented, not done here.

## Verification
- Ran, on the final tree: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check`, contracts, domain test:fast, admin, web, and `@bs/domain test:heavy` (results in the hand-off message).
- NOT verified: no screen was opened in a browser; the private bucket and CORS were not exercised against real Cloudflare R2; the storefront photo flow was tested at the domain level with a fake storage client.

## Docs updated
- [x] `docs/ARCHITECTURE.md`, `DEPLOYMENT.md`
- [ ] ADR: not needed

## Follow-ups and open questions
- Owner: create the private R2 bucket and set `R2_PRIVATE_BUCKET_NAME` before enabling photo returns; add the lifecycle rule.
- Owner: GST credit notes on refunds remain an open compliance question.

## Definition of done
Gate and tests listed above; no secrets, no generated files.

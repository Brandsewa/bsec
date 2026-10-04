# Settings Phase 2 verification and fixes

- **Date:** 2026-10-04
- **Agent:** claude
- **Branch:** `verify/settings-phase-2` (Antigravity's `feat/settings-rebuild-phase-2` + `origin/main`, never pushed by its author)
- **Area:** auth, domain, admin, web api, tests, docs
- **Type:** fix | test
- **Supersedes:** none (adds to `2026-10-04-antigravity-settings-rebuild-phase-2.md`)

## Summary
Verified Antigravity's Phase 2 against `SETTINGS-REBUILD-REMAINING-PHASES.md` §3 and ADR-020, merged current `main`, and fixed what failed.

## Defects found and fixed
1. **Typecheck failed** (`apps/admin/test/settings-shell.test.tsx:205`, redirect test cast). Fixed with a `never` cast. The builder's record said typecheck passed; it did not on the merged tree.
2. **`payments.manage` was defined but enforced nowhere**, so ADR-020's "store_admin cannot configure payment gateway secrets" was false: the Razorpay save/clear procedures still required only `settings.write`, which `store_admin` holds. Now `saveRazorpay` and `clearRazorpay` require `payments.manage` in the route and in the domain service, and the Payments page shows a read-only Razorpay status without it. `payments.get` stays on `settings.write` (status only; create-order reads it). Tests: new real-DB case in `store-settings.int.test.ts`; the isolation suite now proves the denial before running the owner-level success path.
3. ADR-020 gained an "Enforcement status" section stating exactly which families are enforced today and that COD is still `settings.write` (Phase 5).

## Verification
- `pnpm docs:check`, `pnpm typecheck` (15/15), `pnpm lint` (15/15), `pnpm build` (6/6): pass.
- `@bs/auth` 6, `@bs/contracts` 17, `@bs/admin` 42, `@bs/domain test:fast` 252, `@bs/web test:fast` 163: pass.
- `@bs/domain` heavy (Testcontainers Postgres 18): 63/64 files, 1318/1320 first run; the 2 failures were the isolation cases above (expected after item 2). Isolation suite after the fix: **852/852**. Remaining 63 files passed in the same run.
- Not done: browser walkthrough of Owner / Manager / denied role (ZCode round to follow); the roles table assigns browser testing to ZCode.

## Definition of done
- [x] Gate passes. [x] Real-DB tests added. [x] ADR updated. [x] No secrets, no generated files. [ ] Browser walkthrough pending.

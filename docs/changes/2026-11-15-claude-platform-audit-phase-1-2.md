# Platform audit, phases 1 and 2: tenant isolation, auth, checkout, payments (first pass)

- **Date:** 2026-11-15
- **Agent:** claude
- **Branch:** `test/platform-audit-phase-1-2` (not merged yet; stacked on `fix/security-alerts-2026-11-15`, PR #274)
- **Area:** docs/audit, scripts, domain tests
- **Type:** test
- **Supersedes:** none

## Summary
The owner approved `docs/PLATFORM-AUDIT-PLAN.md` and asked to start with phases 1 and 2. This is the first pass over sections A1 to A4. It found no cross-store data access and no way to forge a payment. It found one High and four Medium defects in checkout and payments, two of them confirmed by new real-database tests, plus 14 Low items and two that need a live check. No product code was changed: fixes come as separate change sets.

## What changed
- `docs/audit/2026-11-A1-tenant-isolation.md`, `-A2-auth-permissions.md`, `-A3-checkout-money.md`, `-A4-payments-webhooks.md`: findings, the checks that passed, and what was not checked.
- `docs/audit/2026-11-SUMMARY.md`: all findings by severity, counts, suggested fix order, owner decisions.
- `scripts/audit-api-guards.mjs`: lists every store or platform API procedure with its route guards and whether the domain functions it calls assert a permission or role (source-text heuristic, no database).
- `scripts/audit-rls.sql`: eight read-only catalogue queries for row-level security coverage, foreign keys, unique indexes, role attributes and grants.
- `packages/domain/test/audit-checkout-probes.int.test.ts`: three `it.fails` probes for A3-01 and A3-02 and one control test.
- `docs/PLATFORM-AUDIT-PLAN.md`: status line; the script names in the acceptance criteria.
- `progress.md`: in-flight line.

## Decisions and trade-offs
- **Coverage is partial and said so.** Four sections in one pass could not read every query and flow. Each findings file ends with a "not checked" list; the summary calls the sections "partly covered". A second pass is needed before anyone treats A1 to A4 as done.
- **Probes are `it.fails`.** They pass in CI while the defect is open and turn red when it is fixed, which tells the fixer to convert them. Because `it.fails` also passes on a broken setup, each probe was run once as a plain test to see its own assertion fail, and a control test using the same helpers stays green.
- **The RLS check is a `.sql` file, not a `.mjs`.** A root script may not import `pg` (rule 2). `psql -f` needs nothing from the monorepo.
- **Findings from reading are labelled.** Only A3-01 and A3-02 are reproduced by test. A3-03, A3-04, A4-01 and the Low items are from code, with paths; A1-02 and A2-05 are marked unconfirmed because they depend on proxy and environment settings that are not in the repo.
- **Existing tests were relied on, not re-run**, for discount concurrency, idempotent order placement, Razorpay settle, amount mismatch and cross-store settle. The findings files say "existing test, not re-run" on those rows.
- The audit plan asked for one PR per phase; phases 1 and 2 share this one because they were audited together.

## Verification
- Ran, in the `bsec-audit` worktree:
  - `scripts/audit-rls.sql` through `psql` against the local migrated test template (migrations to 0113): 8 blocks, no SQL error.
  - `node scripts/audit-api-guards.mjs`: 371 store procedures parsed (the file has 374 `.handler(` calls; 3 are not matched by the pattern and were not identified).
  - `node scripts/audit-api-guards.mjs --platform`: 196 procedures parsed.
  - `vitest run test/audit-checkout-probes.int.test.ts` (real Postgres): 1 passed, 3 expected fail.
  - The same file with `it.fails` replaced by `it`, once: 3 failed on their assertions ("expected 2000 to be 200000", "expected null not to be null" twice), 1 passed.
  - Gate results for this branch are listed in the PR description.
- Exercised by hand: nothing in a browser.
- NOT verified: everything in the "not checked" lists; A3-03 in a running store; A4-01 by test; A1-02 and A2-05 against the real proxy; nothing in production.

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: not needed, no structure changed
- [ ] ADR: not needed
- [ ] `DEPLOYMENT.md` / RUNBOOK: not needed (A2-05 proposes documenting `TRUST_CLOUDFLARE`; that is a fix, not part of this record)
- [x] `progress.md` (in-flight)

## Follow-ups and open questions
- Fix order and owner decisions: `docs/audit/2026-11-SUMMARY.md`.
- The three unmatched handlers in `audit-api-guards.mjs` should be identified in the second pass.
- Go-live hardening plan (not merged yet): A3-04 repeats its item 1.7; A4-02 adds a retention question for `webhook_inbox`.

## Definition of done
- [x] No product code changed; rules in section 2 and 3 followed for the new files.
- [x] Tests added: real-database probes for the two confirmed findings.
- [x] `docs/ARCHITECTURE.md`: no trigger applies.
- [x] ADR: none needed.
- [x] `DEPLOYMENT.md` / RUNBOOK: no change.
- [x] Change record and `progress.md` in-flight.
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Honest status: see Verification and the "not checked" lists.
- [ ] After merge: record updated, in-flight line removed, branch and worktree removed.

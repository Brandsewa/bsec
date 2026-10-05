# Fix the tax-settings e2e after the Settings merge

- **Date:** 2026-10-05
- **Agent:** claude
- **Branch:** `fix/e2e-tax-gstin`
- **Area:** e2e, domain (demo seed), admin copy
- **Type:** fix
- **Supersedes:** none

## Summary
After PR #38 merged, the `main` run built the images but the staging smoke test failed on one spec (`tax settings persist across a reload`, 12 of 13 e2e passed), so the production deploy was skipped. Cause: the demo store's GSTIN (`29ABCDE1234F1Z5`, state Karnataka) does not pass the checksum rule added in Settings phase 6, and a GSTIN's state code must match the chosen state, so saving "Maharashtra" was refused and the success toast never appeared. This is the validation working as designed; the old spec and seed predate it. (CI runs e2e only on `main`, which is why the PR run was green.)

## What changed
- `e2e/admin.spec.ts`: the spec clears the GSTIN to change state, then restores a valid Karnataka GSTIN.
- Demo seed (`demo-store.ts`): GSTIN replaced with `29AAFCD5862R1ZR`, which passes the checksum (checked with `validateGstin`; the old value does not).
- Taxes form: the example GSTIN in the error message was the invalid one; now the valid one.

## Verification
`validateGstin` accepts the new value and rejects the old. Typecheck, lint, admin tests and `docs:check` run (see PR). The e2e itself runs only on `main` and cannot be run locally; the first run after merge is the check. Nothing deployed to production yet: the deploy job is skipped until the smoke test passes.

## Docs updated
- [x] This record.

## Definition of done
- [x] No secrets, no generated files, no unrelated edits.
- [ ] `main` smoke test green after merge (then the production deploy runs).

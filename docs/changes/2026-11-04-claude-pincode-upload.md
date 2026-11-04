# Load the pincode directory from Super Admin Marketplace

- **Date:** 2026-11-04
- **Agent:** claude
- **Branch:** `feat/pincode-upload` (not merged yet)
- **Area:** domain, contracts, platform, superadmin
- **Type:** feature
- **Supersedes:** none

## Summary
The `import:pincodes` CLI added in #213 is not bundled into the deployed platform image and the 1.4 MB India Post file cannot be pasted into the Coolify terminal. The owner chose an audited upload in Super Admin instead.

## What changed
- `marketplace.pincodeStatus` (read, any staff) and `marketplace.importPincodes` (`platform_admin`): contract in `packages/contracts/src/apps.ts`, service in `packages/domain/src/apps/platform.ts`, handlers in `apps/platform/src/app.ts`.
- Super Admin > Marketplace > "Pincode directory": shows the loaded count and a JSON file picker.
- The import reuses `parsePincodeJson`, so the ten pinned pincodes apply and rows without a state are skipped and reported. Refuses a file that is not JSON, not keyed by pincode, or has fewer than 100 usable rows. Writes `platform_audit_logs` action `marketplace.pincodes.import`. Re-running updates existing rows.
- Tests: `packages/domain/test/pincode-upload.int.test.ts`; platform audit, rbac and read-endpoint mappings.

## Decisions and trade-offs
Upload over a committed data migration: the file's licence for publishing in this public repo is unknown, and an upload also works on staging. The CLI stays for local use only.

## Verification
- Ran: typecheck for contracts, domain, platform and Super Admin; lint; the pre-push `gate:quick`.
- NOT run locally: the new real-database test and the platform integration suites (Docker was not responding); CI runs them.
- NOT done: no browser walk-through of the upload; production load.

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: not needed (no new table, route or env var; extends section 20 behaviour)
- [ ] ADR: not needed (ADR-044 covers the directory)
- [ ] `DEPLOYMENT.md`: not needed
- [ ] `progress.md`: not needed

## Follow-ups and open questions
- After deploy the owner loads `pincode_state_map.json` in Super Admin > Marketplace on production.

## Definition of done
Gate and CI outstanding; no secrets or generated files in the diff.

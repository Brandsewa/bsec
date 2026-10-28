# Bare custom domains: prove ownership first, add the A records after

- **Date:** 2026-10-28
- **Agent:** claude
- **Branch:** `fix/domain-ownership-before-a-records` (not merged yet)
- **Area:** domain, contracts, admin, docs
- **Type:** fix
- **Supersedes:** none

## Summary
tasteofhills.com was set up exactly as the new Domains page said (both TXT records plus the A and AAAA records) and stayed Pending in Cloudflare with "custom hostname does not CNAME to this zone ... hostname is using Cloudflare and cannot be activated with a TXT or HTTP validation token". Cloudflare calls an A record to the SaaS target an unsupported setup; it only worked for darjeelinghoney.com because that hostname was verified by TXT before its A records were added. The page now enforces that order.

## What changed
- `service.ts`: a bare domain always uses TXT pre-validation (`isApexHostname` in `routing.ts`); `verification.ownershipVerified` records whether the provider verified ownership; pending domains trigger a provider re-check (`refreshCustomHostname`, a PATCH on the custom hostname, best effort) before the status read.
- `provider.ts`: `refreshCustomHostname` for Cloudflare.
- Contract: `verification.ownershipVerified` (optional).
- Admin Domains page: for a bare domain the TXT checkbox is forced on and disabled; step 2 (A records) is hidden until ownership is verified; if A/AAAA records already exist it says to remove them for now; the guide explains the order.

## Decisions and trade-offs
- A `www` CNAME to `stores.bcom.si` stays the recommended, supported path. A records for a bare domain are not officially supported by Cloudflare without apex proxying (Enterprise), so they carry some renewal and re-validation risk. The page keeps offering them because they worked for darjeelinghoney.com.
- Existing rows without `ownershipVerified` keep the old behaviour (records shown) until their next check.

## Verification
- Ran: `custom-domains.int.test.ts` and `domain-routing.test.ts` (35 pass, real Postgres, 3 new tests: bare domain forced to TXT and locked until verified, refresh only for pending domains, failing refresh never blocks); admin `domains-settings.test.tsx` and `domain-hosts.test.ts` (12 pass, 1 new).
- NOT verified: the Cloudflare PATCH against the real API (shape taken from Cloudflare's docs, wrapped so a failure cannot break the check); the page in a browser.

## Docs updated
- [x] ADR-017 update note
- [x] `progress.md` (in flight)

## Follow-ups and open questions
- tasteofhills.com itself needs the manual steps: remove the A and AAAA records, wait until Cloudflare shows the hostname Active, then add them back.

## Definition of done
Gate status is recorded in the PR description. No secrets or generated files in the diff.

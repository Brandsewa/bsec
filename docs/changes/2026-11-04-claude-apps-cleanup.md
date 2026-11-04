# Record the Apps and State Pricing merges, clear the in-flight lines

- **Date:** 2026-11-04
- **Agent:** claude
- **Branch:** `docs/apps-cleanup`
- **Area:** docs
- **Type:** docs
- **Supersedes:** none

## Summary
Post-merge cleanup for #213 (Apps framework and State Pricing), #214 (pincode upload in Marketplace) and #215 (Apps home, pinning, bulk grid): the three change records now name their PR and commit, and the in-flight lines are removed from `progress.md`. The main run for 5973b2f passed, including the production deploy job.

## What changed
- `Branch` lines of the three change records; two `progress.md` in-flight lines removed.

## Verification
- Ran: `gh run view` on the main run for 5973b2f (all jobs, including deploy production, succeeded).
- NOT done: no live check of production screens; the pincode directory still has to be loaded in Super Admin > Marketplace and the customer's store allowed there.

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: not needed
- [ ] ADR: not needed
- [ ] `DEPLOYMENT.md`: not needed
- [x] `progress.md` (in-flight lines)

## Follow-ups and open questions
- Owner: load `pincode_state_map.json` in production, switch on the Cloudflare visitor location headers for the customer's domain, allow their store in Marketplace.
- Excel `.xlsx` import; reuse the grid for the products bulk editor.

## Definition of done
Docs only; no code, secrets or generated files in the diff.

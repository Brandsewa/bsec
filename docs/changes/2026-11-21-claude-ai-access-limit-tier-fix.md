# AI access: limits no longer resolve to zero for some Growth stores

- **Date:** 2026-11-21
- **Agent:** claude
- **Branch:** `fix/ai-access-limits-tier` (not merged yet)
- **Area:** domain
- **Type:** fix
- **Supersedes:** none

## Summary
The first real connection (Claude chat, a store called Taste of Hills) authenticated, but every tool call came back "This AI app is sending requests too fast. Try again in 60 seconds", even a single `get_store_overview`. The AI limits live in `quota_definitions` per size tier and the AI keys carry 0 for tiers XS and S (not entitled). The store passed the plan check (its plan includes AI access) but its `tenant_size_tiers` row was missing or XS or S, so every AI limit resolved to 0, and a limit of 0 was reported as a rate limit.

## What changed
- `packages/domain/src/ai/limits.ts`: new `resolveAiQuota`. Order: Super Admin override for the store (a deliberate 0 still pauses it), then the store's tier if M or L, then the tier its plan maps to (Growth M, Pro L), then M. Used by the call limits and the usage meter.
- A limit of 0 now answers "AI access is paused for this store by Brand Sewa. Contact support to turn it back on." with a one hour wait, not "sending requests too fast".
- Tests (`ai-access.int.test.ts`): tier XS, S and a missing row all resolve to the Growth limits; a Pro store with a stale S row resolves to the Pro limits; a zero override says "paused".
- `docs/ARCHITECTURE.md` section 24: how limits resolve.

## Decisions and trade-offs
Entitlement (plan feature) is the gate; the size tier only chooses how generous the limits are. The previous design let a tier row, which is not what grants AI access, silently switch it off.

## Verification
- Ran: `tsc` and eslint on the domain package (clean); `ai-access.int.test.ts` 24 pass against the local test database.
- NOT verified: the production store itself (not reachable from here). After deploy, reconnect or retry in Claude chat: `get_store_overview` should answer. Super Admin > the store's size tier can be checked, but is no longer needed.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (section 24)
- [x] ADR not needed (implementation of ADR-050 decision 8)
- [x] `progress.md` (in flight)

## Follow-ups and open questions
- Why this store's tier row was missing or XS/S is not known (older store, or plan changed without the tier following). Worth checking in Super Admin; the AI feature no longer depends on it.

## Definition of done
Gate steps listed under Verification run; no secrets or generated files.

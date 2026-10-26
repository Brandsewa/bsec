# Custom domains: "connected" now means reachable

- **Date:** 2026-10-26
- **Agent:** claude
- **Branch:** `feat/custom-domain-routing` (not merged yet)
- **Area:** db, domain, contracts, web, admin, docs
- **Type:** fix
- **Supersedes:** none

## Summary
darjeelinghoney.com showed Active and SSL active, but did not open: the merchant used the TXT ownership option, Cloudflare reported the hostname active, and the platform trusted that. The bare domain had no A or CNAME record at all. Now a domain is Active only when its real DNS points at us and a real request to it is answered by this platform. The Domains page tells the merchant exactly which record is missing and shows A records (read live, not hardcoded) for bare domains.

## What changed
- `packages/domain/src/domains/routing.ts` (new): public-resolver DNS check (CNAME to the fallback origin, A/AAAA equal to the fallback origin's live addresses, or any Cloudflare proxy range), HTTP probe of `/.well-known/bsec-domain` (no redirects, 5 s timeout, 2 KB cap, runs only after DNS passes), live `getRoutingTargets()` with a 10-minute cache and optional `CUSTOM_DOMAIN_A_TARGETS` pin.
- `service.ts`: `verifyDomainWithDb` runs the routing check; Cloudflare active without reachable keeps the domain pending; an active domain that fails 3 re-checks becomes `degraded` (audited `domain.degraded` / `domain.recovered`, actor `system`); the sweep also covers `degraded` and re-checks `active` domains daily; `lookupDomainIdForProbe`.
- `provider.ts`: also returns Cloudflare's certificate TXT (`ssl.validation_records`) so it can be shown (it was a known gap).
- `host-resolver.ts`: `degraded` domains still resolve.
- Migration `0081_domain_routing_checks` (expand only): `domains.routing_status`, `routing_detail`, `routing_checked_at`.
- `apps/web/src/app/.well-known/bsec-domain/route.ts`: public probe, returns only the opaque domain id (any status except removed). The dot in the path means the middleware storefront gate skips it.
- Contract: `CustomDomainItem.routing`, `verification.dcv`, `CustomDomainVerifyResult.routing`. No new procedure.
- Admin Domains page: `www` recommended; TXT shown as "Step 1: prove ownership" with both TXT records and "Step 2: point your domain to us (required)"; bare domains get A records, subdomains a CNAME; one plain sentence of live status (no record / points elsewhere / waiting for certificate / reachable); "Needs attention" banner for degraded.

## Decisions and trade-offs
- Owner decision (this session): shared Cloudflare IPs read live from `stores.bcom.si` are the answer to "the exact IP"; a fixed IP needs Cloudflare Enterprise/BYOIP. Admin banner only for degraded domains (email delivery is not live). `www` is the recommended default, the bare domain the advanced option.
- Any Cloudflare proxy address counts as "DNS ok" because Cloudflare routes by Host/SNI; the HTTP probe is what proves it is really us (a merchant's own proxied Cloudflare zone also resolves to Cloudflare IPs).
- SSRF: the worker only fetches the merchant's own validated hostname, after DNS showed Cloudflare or our addresses, without following redirects, and only compares the body to a UUID.

## Verification
- Ran: `domain-routing.test.ts` 13 pass; `custom-domains.int.test.ts` 19 pass on real Postgres (6 new: no record, parking address, DNS ok but probe failing, reachable then 3 failures degrade with audit rows and recover, daily re-check, probe lookup for non-active/unknown/removed hosts); admin `domains-settings.test.tsx` + `domain-hosts.test.ts` 11 pass; domain, contracts and web typecheck clean.
- NOT verified: against real Cloudflare, real DNS or the real Traefik routing; the admin page in a browser at 375 px; the worker running the daily re-check live. See gate results in the PR.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (migration, route, sweep)
- [x] ADR-017 update note
- [x] `DEPLOYMENT.md` (env var, merchant instructions)
- [x] `progress.md` (in flight)

## Follow-ups and open questions
- Deploy order: web first (it serves the probe), then worker. Until web has the route, existing active custom domains fail the probe; they only turn "Needs attention" after 3 daily failures, so there is time.
- After merge, open Domains for darjeelinghoney.com and press Check status; it should show Reachable. Existing domains get a first routing check at the next sweep.
- Email to merchants for a degraded domain once email delivery is live.

## Definition of done
Gate status is recorded in the PR description. No secrets or generated files in the diff.

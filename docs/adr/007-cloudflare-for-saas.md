# ADR-007: Cloudflare for SaaS for custom domains

- **Status:** Accepted
- **Date:** 2026-09-28
- **Plan reference:** PLAN §2, §8 (domain flow), §14

## Context
Every store needs HTTPS on `{slug}.bscommerce.in` and optionally on its own domain, including domains already live elsewhere (bcom.si during migration) with zero downtime. Issuing and renewing certificates on the VPS does not scale and exposes the origin.

## Decision
Cloudflare for SaaS custom hostnames. Merchants CNAME to `stores.bscommerce.in`; Cloudflare verifies ownership and issues SSL. Domains already live use the **TXT pre-validation** path so SSL is ready before DNS moves. The `domains` table tracks the state machine (`requested → awaiting_dns → verifying → ssl_pending → active`, plus `failed`, `removing`, `removed`); a domain becomes primary only when `active`, and the old primary 301-redirects. The worker polls every 5 min for 48 h.

## Consequences
- Origin stays behind Cloudflare (CDN, WAF, rate limits at the edge).
- Per-hostname fees are part of per-store unit economics.
- Vendor dependency on Cloudflare; Cloudflare API has a kill switch + fallback (PLAN §11.7).

## Alternatives considered
- **Caddy/Traefik on-demand TLS on the VPS:** origin exposed, rate limits from ACME, no pre-validation for live domains.

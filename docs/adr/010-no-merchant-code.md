# ADR-010: No merchant code execution

- **Status:** Accepted
- **Date:** 2026-09-28
- **Plan reference:** PLAN §2 (Rejected), §6.2, §4 (security checklist)

## Context
Many platforms let merchants edit templates or upload scripts. On shared infrastructure with RLS-based isolation, any merchant-controlled code on our servers could read other stores' data, exhaust the CPU, or break the performance budget.

## Decision
Merchants never run code on our servers. Customization is limited to: theme **tokens** (colors, fonts, radius, button style), branding assets, block props validated by the registry (ADR-009), and sanitized rich text. No Liquid, no JSX, no custom scripts in V1. "Apps" in V1 are platform feature flags; the later app library is **first-party code only**. A partner ecosystem, if any, uses the public API, webhooks and OAuth with partner code running on the partner's servers.

## Consequences
- Isolation and performance remain under our control; CSP on the storefront stays strict.
- Some merchant requests ("add this snippet") will be refused or turned into first-party features, e.g. a curated analytics/pixel integration.

## Alternatives considered
- **Sandboxed templates (Liquid):** large security and support surface for a 1–2 person team.
- **Custom script tags:** breaks CSP and the performance budget; enables data exfiltration from customers.

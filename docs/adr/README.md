# Architecture Decision Records

New decisions get an ADR **before** code (PLAN §15). Copy `template.md`, take the next number, open it as `Proposed`, merge as `Accepted`. Superseding an ADR: new ADR + set the old one's status to `Superseded by ADR-NNN`.

| ADR | Title | Status |
|---|---|---|
| [001](001-modular-monolith.md) | Modular monolith | Accepted |
| [002](002-tenant-isolation-rls.md) | Tenant isolation via Postgres RLS | Accepted |
| [003](003-postgres-source-of-truth.md) | PostgreSQL as the source of truth | Accepted |
| [004](004-nextjs-cache-components.md) | Next.js Cache Components for the storefront | Accepted |
| [005](005-orpc-over-trpc.md) | oRPC instead of tRPC | Accepted |
| [006](006-pg-boss-jobs.md) | pg-boss instead of a workflow engine | Accepted |
| [007](007-cloudflare-for-saas.md) | Cloudflare for SaaS for custom domains | Accepted |
| [008](008-payment-provider-adapter.md) | Payment provider adapter | Accepted |
| [009](009-versioned-block-registry.md) | Versioned block registry | Accepted |
| [010](010-no-merchant-code.md) | No merchant code execution | Accepted |
| [011](011-feature-flagged-rollout-and-fallbacks.md) | Feature-flagged rollout and per-tenant dynamic fallbacks | Accepted |
| [012](012-customer-session-architecture.md) | Customer session architecture and documented authentication gap | Accepted (documented gap and planned design) |
| [013](013-quota-and-rate-limit-architecture.md) | Platform-scoped quota and rate limit architecture | Accepted |
| [014](014-admin-auth-and-api-access.md) | Admin sign-in and how the admin SPA reaches the API | Accepted |
| [014](014-platform-billing-separation.md) | Platform billing separation from merchant customer billing | Accepted (number clash with the row above; kept so existing links work) |
| [015](015-quota-resolution-hierarchy.md) | Quota resolution hierarchy and immutable checkout invariant | Accepted |
| [016](016-tenant-provisioning-atomicity.md) | Tenant provisioning atomicity, idempotency and unified service architecture | Accepted |
| [017](017-custom-domain-provider-adapter.md) | Custom domain provider adapter and verification state machine | Accepted |
| [018](018-visual-theme-editor.md) | Visual theme editor on the block registry | Accepted |
| [019](019-customer-auth-and-platform-mailer.md) | Customer authentication and platform transactional mailer | Accepted |
| [020](020-settings-capability-families.md) | Settings capability families and granular authorization | Accepted |

**Next number: 021.**

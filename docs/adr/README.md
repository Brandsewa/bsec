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
| [018](018-visual-theme-editor.md) | Visual theme editor on the block registry | Accepted |

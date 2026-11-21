# ADR-043: Apps framework: first-party apps, installed per store, managed from a Super Admin marketplace

- **Status:** Accepted
- **Date:** 2026-11-03
- **Plan reference:** `docs/STATE-PRICING-PLAN.md` (extends ADR-001, ADR-002, ADR-004; consistent with rule 8)

## Context
A customer needs a feature (state pricing) that most stores do not. A one-off per-tenant flag would have to be redone for every later optional feature, and an open third-party app platform would break the rule that no merchant-controlled code runs on our servers.

## Decision
- **Apps are our own code.** `packages/domain/src/apps/registry.ts` holds each app's manifest (key and settings schema). Behaviour lives in `packages/domain`, behind named extension points; there is no loading of external code.
- **Catalog is platform data.** `platform_apps` (no tenant column, no RLS; `app_platform` writes, `app_rw` reads) holds name, description, `visibility` (`public` or `private` with `allowed_tenant_ids`) and a global `enabled` switch.
- **Installs are tenant data.** `tenant_apps` (`tenantTable`, forced RLS) holds status, validated `settings` (versioned) and `platform_suspended`.
- **An app is active only when** the catalog enables it, the install is `installed`, and Super Admin has not suspended the store. One function, `readActiveApp`, decides this.
- **Permission** `apps.manage` (part of the settings capability families, denied to support sessions). Store changes write `audit_logs`; marketplace changes write `platform_audit_logs`. Changes invalidate the tenant's storefront cache through the existing `markets_changed` tags.
- **Super Admin Marketplace** lists apps, sets visibility and the allowed stores, switches an app on or off everywhere, and suspends it for one store (the store cannot undo that). Roles: `platform_admin` or above to change, any staff to read.
- Uninstall removes the install row but keeps data the app wrote (inert until reinstalled).

## Consequences
- Easier: the next optional feature is a manifest, a settings schema and a domain module; visibility and rollout are Super Admin switches.
- Harder: every app must be inert when inactive, and its storefront effect must be keyed in the cache.
- Not supported: third-party developers, app billing (apps are free for now), webhooks. A future third-party platform needs its own ADR and a sandbox.

## Alternatives considered
- **Feature flag per tenant:** platform-only, no merchant install or settings, redone per feature.
- **Open third-party app platform:** rule 8 and isolation; large security surface; deferred.

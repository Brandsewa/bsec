# ADR-021: Settings Rebuild Deprecation and Contract Schedule

- **Status:** Accepted
- **Date:** 2026-10-05
- **Deciders:** Owner, Antigravity (builder)
- **Plan reference:** `docs/prompts/settings-rebuild-phase-8.md` §7, `docs/SETTINGS-PHASES-3-8-HANDOFF.md`, ADR-002, ADR-011, ADR-020

---

## Context

Throughout the store settings rebuild (Phases 3–8), our core architectural policy has strictly followed **Expand / Migrate / Contract** (`AGENTS.md` Rule 10, ADR-002). To guarantee zero downtime, non-breaking API contracts, and seamless backward compatibility for running stores, newly partitioned tables and granular capability permissions were deployed alongside legacy fields and fallback paths.

At Phase 8 completion, all modern services, storefront routes, and admin interfaces have migrated to the new schema and capability families. However, legacy dual-writes, fallback parsers, and deprecated columns remain in place.

Per engineering standards, **no deprecated columns or aggregate fallbacks are removed in the same release that introduces or finalizes their replacements**. This ADR defines the formal cleanup schedule, removal preconditions, target milestone releases, and rollback paths for each deprecated artifact.

---

## Deprecation & Contract Schedule Matrix

| Deprecated Item | Location | Removal Precondition | Earliest Removal Release | Rollback Procedure |
|---|---|---|---|---|
| **`settings.write` Aggregate Fallback** | `packages/auth/src/index.ts` (`hasPermission` check-time expansion) | Zero custom role definitions in database containing legacy `settings.write`; 100% of staff roles migrated to granular capability families. Zero `settings.write` occurrences in access telemetry over 30 days. | **v1.2.0** (Contract Phase) | Re-add `settings.write` aggregate expansion list in `packages/auth/src/index.ts`. |
| **`store_settings.checkout.cod` & `.tax` Dual-Writes** | `packages/domain/src/admin/settings.ts`, `packages/db/src/schema/settings.ts` | All active checkouts evaluate rates from `taxes.manage` and `payments.manage` tables. Zero telemetry callers requesting `cod` or `tax` through `admin.settings.get/update`. | **v1.2.0** | Restore JSONB write mapping in `updateSettings` domain service. |
| **`cod` and `tax` Keys in `admin.settings.update`** | `packages/contracts/src/admin.ts`, `apps/web/src/server/api.ts` | Admin SPA and public API clients migrated exclusively to `admin.paymentMethods.*` and `admin.taxSettings.*`. Contract validation passes zero legacy fields. | **v1.2.0** | Revert Zod schema in `packages/contracts/src/admin.ts` to allow optional `cod` and `tax` keys. |
| **`customer_consent_events.ip`** | `packages/db/src/schema/customers.ts`, `packages/domain/src/privacy/` | Privacy regulation verification; client hash token verification replaces IP requirement in audit verification suite. | **v1.3.0** | Re-add nullable `ip` column via forward migration. |
| **`return_settings.policyText`** | `packages/db/src/schema/returns.ts`, `packages/domain/src/returns/` | 100% of stores with return policies have an active row in `store_policies` where `type = 'refund'`. Return portal renders exclusively from published policy version. | **v1.2.0** | Drop migration and restore column read in return portal domain service. |
| **Legacy Policy Boilerplate Fallback** | `apps/web/src/app/policies/[type]/page.tsx` | All live stores have published custom policy versions under `store_policies`, or flag `settings.policies` is enabled globally (`default_on = true`) with merchant acknowledgement. | **v1.2.0** | Restore generic 2026-09-01 fallback component in Next.js policy route. |
| **`customers.note` Column** | `packages/db/src/schema/customers.ts` | One-time data backfill migration moves all non-null notes into `customer_timeline_events` or customer tags. | **v1.3.0** | Restore `note` column in schema definition. |
| **Old Payment-Method Synthesis** | `packages/domain/src/payments/methods.ts` | All payment selection and capture logic in `apps/web` and `packages/domain/src/orders/checkout.ts` reads directly from partitioned `payment_methods` table. | **v1.2.0** | Re-enable fallback synthesis function from `store_settings.payment`. |

---

## Execution Principles for Contract Phases

1. **Precondition Verification**: An automated database validation script must run before any contract migration is scheduled. If any store has unmigrated data, the contract script aborts.
2. **Schema Separation**: Column drops in Postgres must occur in dedicated contract migrations (`DROP COLUMN`) only after all application code across web, platform, admin, and worker has stopped referencing the fields for at least one full production release cycle.
3. **Telemetry Confirmation**: Sentry and audit logs must demonstrate 0 hits on deprecated oRPC procedures for 14 continuous days prior to deletion.

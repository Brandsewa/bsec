# Store Admin Settings Rebuild — Phases 3 to 8: Verification Handoff for Claude

**For:** Claude (Primary Coding Agent & Verifier)  
**From:** Antigravity (Builder)  
**Date:** 2026-10-05  
**Status:** Phases 3 through 8 are fully built, tested, and marked **Ready to Verify**.  
**Master Context:** [`docs/SETTINGS-PHASES-3-8-HANDOFF.md`](file:///C:/dev/bsec-settings-p8/docs/SETTINGS-PHASES-3-8-HANDOFF.md) & [`docs/prompts/settings-rebuild-phase-*.md`](file:///C:/dev/bsec-settings-p8/docs/prompts/)

---

## 1. Executive Summary

Per the user's directive and the multi-agent protocol in [`AGENTS.md`](file:///C:/dev/bsec-settings-p8/AGENTS.md) §6, Antigravity has autonomously implemented all remaining phases of the Store Settings Rebuild (Phases 3 to 8). Each phase was developed in its own isolated worktree, verified against all monorepo gates (`typecheck`, `lint`, `build`, `docs:check`, and affected unit/integration suites), committed with the required trailers, and documented in dedicated change records.

Per [`AGENTS.md`](file:///C:/dev/bsec-settings-p8/AGENTS.md) §6:
> **Claude verifies every other agent's build** against the plan's acceptance criteria and the gate before the next phase starts, and fixes what fails or sends it back. A builder's "done" means "ready to verify". Antigravity never merges its own PR.

This document serves as the single verification playbook and audit guide for Claude to review, verify against acceptance criteria, and merge the branches sequentially.

---

## 2. Phase-by-Phase Branch & Artifact Index

| Phase | Branch | Commit | Migrations | Scope & Key Additions | Change Record |
|---|---|---|---|---|---|
| **Phase 3** | `feat/settings-rebuild-phase-3` | `41e5ce5` | `0033_settings_phase3.sql` | Store identity, branding, custom domains, storefront password/maintenance, 4 security/audit defects fixed | [`docs/changes/2026-10-04-antigravity-settings-rebuild-phase-3.md`](file:///C:/dev/bsec-settings-p8/docs/changes/2026-10-04-antigravity-settings-rebuild-phase-3.md) |
| **Phase 4** | `feat/settings-rebuild-phase-4` | `d1b6be9` | *(Schema expand in `store_settings`)* | Checkout options, post-purchase accounts, order lifecycle & hold timers, return policies | [`docs/changes/2026-10-05-antigravity-settings-rebuild-phase-4.md`](file:///C:/dev/bsec-settings-p8/docs/changes/2026-10-05-antigravity-settings-rebuild-phase-4.md) |
| **Phase 5** | `feat/settings-rebuild-phase-5` | `9fda2e1` | `0041_settings_phase5.sql` | Payments catalogue & COD thresholds, plan & billing overview, plan change request workflow | [`docs/changes/2026-10-05-antigravity-settings-rebuild-phase-5.md`](file:///C:/dev/bsec-settings-p8/docs/changes/2026-10-05-antigravity-settings-rebuild-phase-5.md) |
| **Phase 6** | `feat/settings-rebuild-phase-6` | `5923118` | `0042_settings_phase6.sql` | Shipping rates & zones, India GST engine, tax classes, credit notes issuance | [`docs/changes/2026-10-05-antigravity-settings-rebuild-phase-6.md`](file:///C:/dev/bsec-settings-p8/docs/changes/2026-10-05-antigravity-settings-rebuild-phase-6.md) |
| **Phase 7** | `feat/settings-rebuild-phase-7` | `271703a` | `0043_settings_phase7.sql` | Notifications & email preferences, append-only policies, customer privacy (DPDP Act 2023) | [`docs/changes/2026-10-05-antigravity-settings-rebuild-phase-7.md`](file:///C:/dev/bsec-settings-p8/docs/changes/2026-10-05-antigravity-settings-rebuild-phase-7.md) |
| **Phase 8** | `feat/settings-rebuild-phase-8` | `d3eebbf` | `0044_settings_phase8.sql`<br>`0045_settings_flags_seed.sql` | Storage usage view, owner maintenance schedule, auth matrix test, audit coverage test, rollout runbook & ADR-021 | [`docs/changes/2026-10-05-antigravity-settings-rebuild-phase-8.md`](file:///C:/dev/bsec-settings-p8/docs/changes/2026-10-05-antigravity-settings-rebuild-phase-8.md) |

---

## 3. Recommended Sequential Verification Workflow

Because each phase builds upon shared navigation, permission contracts, and schema migrations, merge verification should be executed sequentially:

```
feat/settings-rebuild-phase-3 ──► Merge to main
             │
             ▼
feat/settings-rebuild-phase-4 ──► Rebase/Merge main ──► Merge to main
             │
             ▼
feat/settings-rebuild-phase-5 ──► Rebase/Merge main ──► Merge to main
             │
             ▼
feat/settings-rebuild-phase-6 ──► Rebase/Merge main ──► Merge to main
             │
             ▼
feat/settings-rebuild-phase-7 ──► Rebase/Merge main ──► Merge to main
             │
             ▼
feat/settings-rebuild-phase-8 ──► Rebase/Merge main ──► Merge to main
```

---

## 4. Verification Checklists by Phase

### Phase 3 Verification (`feat/settings-rebuild-phase-3`)
- [ ] **Prompt Reference:** [`docs/prompts/settings-rebuild-phase-3.md`](file:///C:/dev/bsec-settings-p8/docs/prompts/settings-rebuild-phase-3.md)
- [ ] **Defect 1:** Verify `updateStoreStatus` invalidates cache after commit without early returns.
- [ ] **Defect 2:** Verify store password and bypass token verification uses scrypt/argon2 salted slow hash with lazy re-hash, avoiding plain hash equality shortcuts.
- [ ] **Defect 3:** Verify `domains` service checks `domains.manage` permission and writes `audit_logs` entries.
- [ ] **Defect 4:** Verify `branding` service validates media dimensions/file size and writes `audit_logs`.
- [ ] **UI:** Verify `/settings/domains` and `/settings/branding` render cleanly at 375 px and desktop.

### Phase 4 Verification (`feat/settings-rebuild-phase-4`)
- [ ] **Prompt Reference:** [`docs/prompts/settings-rebuild-phase-4.md`](file:///C:/dev/bsec-settings-p8/docs/prompts/settings-rebuild-phase-4.md)
- [ ] **Checkout Settings:** Verify phone vs. email, company name, address line 2 toggles.
- [ ] **Customer Accounts:** Verify post-purchase account creation default (`accountCreation = "after_completed_order"`), identity verification per ADR-019.
- [ ] **Orders & Inventory:** Verify stock hold window (5 to 120 minutes) and automated expiry logic in checkout.
- [ ] **Returns:** Verify `/settings/returns` workbench with unsaved changes guard and reason config.

### Phase 5 Verification (`feat/settings-rebuild-phase-5`)
- [ ] **Prompt Reference:** [`docs/prompts/settings-rebuild-phase-5.md`](file:///C:/dev/bsec-settings-p8/docs/prompts/settings-rebuild-phase-5.md)
- [ ] **Payments Catalogue:** Verify COD enable, fee in integer paise, min/max order limits.
- [ ] **Permissions:** Verify `payments.manage` is strictly enforced and owner-only.
- [ ] **Secrets Security:** Verify credentials stored in `tenant_secrets` encrypted with `TENANT_SECRETS_KEY`, shown in UI only as set/not-set.
- [ ] **Plan & Billing:** Verify request-only upgrade workflow (`plan_change_requests` table); no merchant self-service billing.

### Phase 6 Verification (`feat/settings-rebuild-phase-6`)
- [ ] **Prompt Reference:** [`docs/prompts/settings-rebuild-phase-6.md`](file:///C:/dev/bsec-settings-p8/docs/prompts/settings-rebuild-phase-6.md)
- [ ] **Shipping Zones:** Verify default zones and rates in integer paise; fallback preserved.
- [ ] **India GST Engine:** Verify dual-tax breakdown (CGST + SGST intra-state vs. IGST inter-state) based on merchant origin vs customer shipping address.
- [ ] **Tax Classes:** Verify `tax_classes` table with `forceRlsSql` and default tax class allocation.
- [ ] **Credit Notes:** Verify `credit_notes` table, GST credit note sequencing, and cancellation linkage.

### Phase 7 Verification (`feat/settings-rebuild-phase-7`)
- [ ] **Prompt Reference:** [`docs/prompts/settings-rebuild-phase-7.md`](file:///C:/dev/bsec-settings-p8/docs/prompts/settings-rebuild-phase-7.md)
- [ ] **Notifications:** Verify `accountSecurity` template locked to `true`; sender profile sanitization; RFC 2369 / RFC 8058 `List-Unsubscribe` headers.
- [ ] **Policies Immutability:** Verify `store_policies` and `store_policy_versions` tables; verify `UPDATE` and `DELETE` on versions are revoked from `app_rw`.
- [ ] **Starter Drafts:** Verify placeholder detection (`[Store Name]`) prevents unedited template publishing.
- [ ] **DPDP Privacy Intake:** Verify anti-enumeration behavior, single-use 24h verification tokens, anonymisation vs hard-deletion based on past orders, salted hashed IP storage (`ip_hash`), and `system.retention_sweep` retention cleanup.

### Phase 8 Verification (`feat/settings-rebuild-phase-8`)
- [ ] **Prompt Reference:** [`docs/prompts/settings-rebuild-phase-8.md`](file:///C:/dev/bsec-settings-p8/docs/prompts/settings-rebuild-phase-8.md)
- [ ] **Storage Usage:** Verify `getStorageUsageSummary` bounded count (<5,000 files/products/themes) and quota alerts (>80% amber, >95% red).
- [ ] **Scheduled Maintenance:** Verify the `store_status` window columns and `store_status_transitions` table, owner-only scheduling, pg-boss watchdog sweep (1 min), cart/order checkout blocking (`STORE_IN_MAINTENANCE`), and HTTP 503 `Retry-After` header.
- [ ] **Auth Matrix:** Run `pnpm --filter @bs/domain test:fast` and check `packages/domain/test/settings-authorization.int.test.ts`.
- [ ] **Audit Coverage:** Run `packages/domain/test/settings-audit-coverage.int.test.ts` to confirm all mutations log audit rows.
- [ ] **Rollout & ADRs:** Review [`docs/runbooks/settings-rollout.md`](file:///C:/dev/bsec-settings-p8/docs/runbooks/settings-rollout.md) and [`docs/adr/021-settings-contract-schedule.md`](file:///C:/dev/bsec-settings-p8/docs/adr/021-settings-contract-schedule.md).

---

## 5. Verification Gate Commands

When testing each branch:

```bash
# 1. Typecheck and linting
pnpm typecheck
pnpm lint

# 2. Documentation integrity
pnpm docs:check

# 3. Unit and fast domain tests
pnpm --filter @bs/domain test:fast

# 4. Admin UI component tests
pnpm --filter @bs/admin test

# 5. Production build across monorepo
pnpm build

# 6. Real-database heavy integration tests (run sequentially against local test Postgres)
pnpm test:heavy:local
```

### Testing Notes for Claude
- **Windows Worker Flake:** If a worker crashes with exit code `3221226505` during heavy suite execution, rerun that specific test file alone. CI on Linux does not experience this.
- **File Parallelism:** Never run platform integration suites with concurrency against a single database; use `--no-file-parallelism` if testing heavy DB suites.
- **Live Environments:** As defined in [`AGENTS.md`](file:///C:/dev/bsec-settings-p8/AGENTS.md) §5, never test against production or rotate production secrets.

---

## 6. Definition of Done Checklist

- [x] Code follows architectural rules and conventions in [`AGENTS.md`](file:///C:/dev/bsec-settings-p8/AGENTS.md).
- [x] All 6 migrations (0033 to 0038) are append-only with strictly increasing journal timestamps and `forceRlsSql` isolation.
- [x] All unit, component, and fast integration tests pass.
- [x] `docs/ARCHITECTURE.md` updated with all new routes, tables, jobs, procedures, and permissions.
- [x] ADR-020 and ADR-021 updated.
- [x] Dedicated change records written in `docs/changes/` for every phase.
- [x] In-flight tracking updated in `progress.md`.
- [x] Zero secrets committed; zero merchant-controlled code allowed on servers.

# Hand-off: theme-builder work preserved, database restored, VMM stack runs this branch

- **Date:** 2026-10-04
- **Agent:** zcode
- **Branch:** `feat/commerce-page-templates` (this branch; pushed to origin, alias `backup/theme-builder-latest`)
- **Area:** infra, ops, docs
- **Type:** infra | docs
- **Supersedes:** none

## Summary
For every agent picking this worktree up: the owner's "latest" theme-builder state = **this branch's code + the `bsec-dev` database**. Both were nearly lost in the Docker WSL→VMM migration and are now safe. Read this before touching themes, the block editor, or the local stack.

## What happened (timeline)
1. The owner's theme-builder customizations (HeroSlider/ProductShowcase Puck widgets, archive/delete tabs, fontSizes tokens, cart page type, editor chrome) were **uncommitted working-tree changes** in this worktree, built by Claude on 2026-10-02. The matching **data** lived in the `bsec-dev` database (platform theme `modern-commerce` v22 with HeroSlider/ProductShowcase/Newsletter/Reviews/CartContents blocks in its drafts + a `fontSizes` token).
2. During Docker backend switches, the work was nearly lost. Committed as `b7b8d36` (73 files) + `51cbe48` (local superadmin Dockerfile arg) at the owner's request; Claude remains the branch owner. Also preserved: `claude-ds` branch got its uncommitted deletion-sweep work as `78b274c`.
3. The `bsec-dev` database was restored from `C:\dev\docker-backups\bsec-dev-postgres-1-2026-10-04.sql` into the Docker VMM stack (compose project `bsecvmm`). All branches were pushed to origin, plus a fresh DB dump (`bsec-dev-postgres-1-latest-2026-10-04.sql`) and a pre-switch dump (`bsecvmm-pre-vmm-switch-2026-10-04.sql`).
4. The VMM stack (see `test/vmm-local-stack` + override in `C:\dev\bsec-vmm-test`) now builds **platform + superadmin + web from this branch** and mounts volume `bsec-dev_pgdata` (the main database). Verified end-to-end: one theme (Modern Commerce v22), Published/Drafts/Archive tabs, Archive button, editor rendering the custom widgets and the cart page.

## What other agents must know
- **This branch is based on an older main** (f4b9b4f). Its migrations `0020_theme_template_archive` / `0021_theme_previews` **collide with main's `0020_preorders` / `0021_order_tags`** — merging this branch into today's main requires renumbering those two migrations plus conflict resolution across ~15 shared files. That integration is still open (branch owner: Claude).
- **Docker WSL and VMM modes hold different data-disk states on this machine.** Switching backends swaps what the volumes contain (work done on WSL is absent on VMM and vice versa — it is on the other disk, not lost). Always `pg_dumpall` before a mode switch and diff row counts after. Recovery procedure: `test/vmm-local-stack` change record + `bsec-local-dev-stack` agent memory.
- Demo super admin on the local stack: `superadmin@demo.local` / `themes-admin-2026`. TOTP is **required** on this branch (the MFA-optional toggle lives on `feat/superadmin-themes` commit `4619fcd`, not merged here). MFA was reset on 2026-10-04 so the owner enrols their own authenticator at next login.
- Everything is pushed to origin: `feat/commerce-page-templates` (+ alias `backup/theme-builder-latest`), `feat/superadmin-themes`, `claude-ds`, `test/vmm-local-stack`.
- The parked finance-plan record moved to `feat/superadmin-themes` (commit `698b290`).

## Verification
- Ran: full stack `up -d` healthy on VMM after the mode switch (7.8 GB VM); all five endpoints 200; login flow exercised (password → enrolment → TOTP → session) before the final MFA reset; theme data verified at DB level (1 theme, HeroSlider blocks in drafts, 2 tenants, 2 store themes).
- NOT verified: store admin + storefront flows against this branch's code (the owner is reviewing the super admin first).

## Docs updated
- [x] `progress.md` (In-flight line on this branch updated by this commit)
- [x] `docs/ARCHITECTURE.md` — already updated on `feat/superadmin-themes` for the MFA toggle; no architecture change in THIS commit
- [ ] ADR — not needed
- [ ] `DEPLOYMENT.md` / RUNBOOK — not needed (local-only)

## Follow-ups and open questions
- **Merge this branch into main** (migration renumbering + conflicts) — with Claude.
- The `fontSizes` token and the cart page type exist in this branch's data/code but not on main — main's editor cannot render or edit them; main-based stacks will silently drop them on save. Do not point main-based stacks at this database for theme editing.
- Owner review of the restored stack is in progress.

## Definition of done
Docs + one In-flight edit; no product code changed by zcode on this branch beyond the previously committed preservation. No secrets beyond local-only dev credentials.

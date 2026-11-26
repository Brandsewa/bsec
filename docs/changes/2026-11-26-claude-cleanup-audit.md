# Cleanup audit: branches, worktrees, PRs and sessions

- **Date:** 2026-11-26
- **Agent:** claude
- **Branch:** `docs/system-diagram-and-plans` (merged in #341, 2ed2e797); cleanup done by hand after merge
- **Area:** repo housekeeping (branches, worktrees, PRs, sessions), docs
- **Type:** audit
- **State checked against:** `origin/main` at `feat(ai-access): connect Google Antigravity (#340)`; last three `main` runs green.

## Summary
Every bsec branch, worktree, open PR and Claude Code session was checked against GitHub. Almost everything is merged and only needs removing. Five things still need a decision or a save before cleanup: (1) uncommitted docs in the main checkout that never reached `main`, (2) the unshipped marketing home animation work, (3) stale PR #164, (4) two Dependabot PRs, (5) the stale "In flight" list in `progress.md`.

Note: "commits not in main" counts below are non-zero for merged branches because PRs are squash-merged; the PR state is the source of truth.

## A. Needs a decision or a save first (do these before deleting anything)

| # | Item | What is there | Suggested action |
|---|---|---|---|
| A1 | `C:/dev/bsec` untracked docs **not on main** | `docs/GO-LIVE-HARDENING-PLAN.md`, `docs/SYSTEM-DIAGRAM.md`, `docs/diagrams/`, `docs/changes/2026-11-03-claude-go-live-hardening-plan.md`, `docs/changes/2026-11-18-claude-bugfix-updates-session.md`, `docs/changes/2026-11-25-claude-system-diagram.md`, plus the 2 lines in `docs/ARCHITECTURE.md` that point to SYSTEM-DIAGRAM.md | Save in one docs PR (`docs/system-diagram-and-plans`), then clean the checkout. Without this they are lost. |
| A2 | Worktree `C:/dev/bsec-home-modern`, branch `feat/marketing-home-modern` | 10 uncommitted files (+293/-22): bcom.si animated backdrop, pointer light, hover effects, record `2026-11-13-claude-marketing-home-motion.md`. Never committed or PR'd; branch is 80 commits behind main. Session "bcom.si homepage redesign" | Owner: ship it (commit, rebase on main, PR) or drop it. |
| A3 | PR #164 `docs/lucide-icon-pack-record` (open since 2026-10-31) | Its change record is already on `main` | Close without merging, delete the branch (remote and local). |
| A4 | PR #307 Dependabot minor/patch group (47 updates) | Open since 2026-11-21 | Review and merge if CI is green. |
| A5 | PR #242 Dependabot `@types/node` 24 to 26 | Major bump; runtime is Node 24.15 | Close (types should match Node 24) and ignore that major in Dependabot. |
| A6 | `progress.md` "In flight" on `main` | 9 lines for merged work (ai-antigravity #340, rebuild-runbook #328, tabs-revisions #322, tabs-widget #321, ruttl-fixes #320, ai-content-tools #315, ai-products-full #312, ai-access-limits #311, ai-access-mcp #310) and 2 ancient lines (`feat/cashfree-gateway` 2026-10-19, `fix/admin-polish-phase-1` 2026-10-17) with no branch or PR anywhere | Remove the 9 merged lines; owner to confirm the 2 old ones are abandoned or already shipped, then remove. Can go in the same docs PR as A1. |

## B. Worktrees

| Worktree | Branch | PR | Local changes | Action |
|---|---|---|---|---|
| `C:/dev/bsec` (main checkout) | `feat/builder-copy-paste-delete` | #303 merged | 26 modified + code files untracked; all already on `main` in newer form (Ruttl #291, login panel as migration 0115, variant cards #288/#290). Only A1 docs, dev logs and `old-widget-count.sql` are unique | After A1: discard leftovers, delete logs, `git switch main`, `git pull` (local `main` is 97 behind). Keep `old-widget-count.sql` outside the repo if still wanted. |
| `C:/dev/bsec-branding` | `fix/brand-endpoint-marketing-host` | #240 merged | clean | remove worktree, delete branch |
| `C:/dev/bsec-bulk-editor` | `main` (detached copy) | #231 merged | clean | remove worktree |
| `C:/dev/bsec-fixes` | `fix/storefront-fixes-2026-11-14` | #257 merged | clean | remove worktree, delete branch |
| `C:/dev/bsec-home-modern` | `feat/marketing-home-modern` | none | **uncommitted work** | see A2 |
| `C:/dev/bsec-mcp` | `feat/ai-antigravity` | #340 merged | clean | remove worktree, delete branch |
| `C:/dev/bsec-pk-fix` | `fix/stripe-publishable-key-length` | #280 merged | clean | remove worktree, delete branch |
| `C:/dev/bsec-ruttl-fixes` | `fix/builder-ruttl-fixes-2026-11-24` | #320 merged | clean | remove worktree, delete branch |
| `C:/dev/bsec-state-pricing-grid` | `feat/state-pricing-default-edit` | #334 merged | clean | remove worktree, delete branch |
| `C:/dev/bsec-tabs` | `feat/tabs-revisions-custom-fields` | #322 merged | clean | remove worktree, delete branch |

## C. Local branches with no worktree (remote already deleted, PR merged)

`feat/state-pricing-grid` (#333), `feat/tabs-widget-review-position` (#321), `feat/ai-content-tools` (#315), `feat/ai-products-full` (#312), `fix/ai-access-limits-tier` (#311), `feat/ai-access-mcp` (#310), `docs/checkout-turnstile-merged` (#302), `docs/discount-auto-add-merged` (#246), `docs/discounts-merged` (#244), `docs/branding-logo-placement-merged` (#239), `docs/branding-phase3-merged` (#237), `fix/billing-invoice-currency` (#191): delete locally.

`docs/go-live-hardening-plan`: no commits of its own, no PR; its plan file lives untracked in the main checkout (A1). Delete after A1.

## D. Remote branches

Only `main`, the two Dependabot branches (A4, A5) and `docs/lucide-icon-pack-record` (A3) remain. Everything else is already pruned.

## E. Claude Code sessions (bsec)

All idle. Archive once the matching item above is done.

| Session | PR | Action |
|---|---|---|
| MCP Setup | #310 merged (also #340) | archive |
| Product updates and bugs | #337 merged | archive |
| Backup and restore security measures | #323 merged | archive (memory: pgBackRest cutover and deferred items tracked in `docs/BACKUP-DR-PLAN.md`) |
| btw: second Cloudflare backup (child of the above) | none, Q&A | archive |
| State pricing plugin table optimization | #333 merged | archive |
| System architecture design | none | archive **after A1** (its files are the unsaved SYSTEM-DIAGRAM docs) |
| Domain Setup | #134 merged | archive |
| Website Audit and Quality | #313 merged | archive |
| Ruttl tickets from today | #320 merged | archive |
| Copy, Paste, Delete buttons for page builder | #303 merged | archive |
| Profile settings redesign plan | #305 merged | archive |
| Security audit findings verification | #297 merged | archive |
| Ruttl bug tracking setup | #291 merged | archive |
| Login items startup bug | #288 merged | archive |
| darjeelinghoney.com header and lookbook | #282 merged | archive |
| Security and quality issues audit | #274 merged | archive |
| Stripe and Razorpay embedded checkout | #263 merged | archive |
| Merchant Store SEO/GEO/AEO audit | #264 merged | archive |
| Analytics setup and audit | #267 merged | archive (work parked until GA4/Meta go live; plan holds the checklist) |
| Mirror ARCHITECTURE... to Notion | #258 merged | archive |
| Project OS setup documentation review | none (Notion work) | archive |
| Bug fix and update session log | #257 merged | archive |
| bcom.si homepage redesign | none | keep until A2 is decided |
| Discounts & Offers plan | #243 merged | archive |
| Platform branding section in Superadmin | #235 merged | archive |
| Minimal SaaS marketing homepage redesign | #192 merged | archive |
| Bulk editing feature | #230 merged | archive |
| Razorpay cancelled payment order creation | #164 open | archive after A3 |
| Multimarket store setup plan | #149 merged | archive |
| Order fulfillment and tracking optimization | #154 merged | archive |

Two Saywai sessions (different project) are also open; not part of this audit.

## Cleanup order
1. A1 + A6 in one docs PR; wait for the `main` run to finish.
2. Decide A2; A3, A4, A5 on GitHub.
3. Clean the main checkout, switch it to `main`, pull.
4. Remove worktrees (B), delete local branches (B, C), `git fetch --prune`.
5. Archive sessions (E).

## Verification
Read-only checks: `git worktree list`, `git for-each-ref`, `gh pr list --state all` per branch, `gh run list --branch main`, a line-by-line check that the main checkout's uncommitted code already exists on `origin/main`, and the session list. `pnpm docs:check` passes on this branch.

## Owner decisions (2026-11-26)
A1 save in this PR; A2 drop the home animation work; A3 close #164; A4 review and merge #307; A5 close #242; A6 old In flight items are done, list cleared in this PR.

## Outcome (2026-11-26, after the audit)
- A1, A6: merged in #341 and deployed.
- A2: `C:/dev/bsec-home-modern` and `feat/marketing-home-modern` deleted; the home animation work was dropped.
- A3: #164 closed, branch deleted. A5: #242 closed, branch deleted.
- A4: Dependabot replaced #307 with #342 (50 updates). It needed two fixes before merging (pdfkit kept out of the Next bundle; the 404 page no longer loads the client Button, product page 50.37 to 34.93 KB) and one after (#343, pdfkit held at 0.20.2 because 0.21 crashed the bundled worker in the staging smoke test). See `2026-11-26-claude-pdfkit-pin.md`. #343 deployed to production.
- Main checkout: leftovers stashed (`cleanup 2026-11-26`), switched to `main`. All worktrees and merged local branches removed, plus four orphan folders and old logs under `C:/dev`.
- 30 bsec Claude Code sessions archived.

## Not done
- The 404 page was not opened in a browser after the Button swap.

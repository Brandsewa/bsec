# Page version history: History tab and safe restore

- **Date:** 2026-11-17
- **Agent:** claude
- **Branch:** `feat/page-version-history` (not merged yet)
- **Area:** admin, block-editor, domain, contracts, web
- **Type:** feature
- **Supersedes:** none

## Summary
The page editor now has a History tab: every saved version of the page, a read-only preview of any version on the canvas, and a two-step restore. On the server, restore is safer: it refuses a version that belongs to another page, creates a new version instead of re-pointing at the old row (so it can be undone), and writes an audit row. Follows `docs/PAGE-VERSION-HISTORY-PLAN.md`; built after a stale-editor bug (#282) overwrote a store's Header and Home pages and recovery needed raw API calls.

## What changed
- `packages/domain/src/content-services.ts`: `listPageVersions` (limit, `before` cursor, author name, block count), new `getPageVersion`, `savePageDraft` records `created_by`, `rollbackPage` checks the page, copies into a new published version and writes `audit_logs` `page.restored`.
- `packages/contracts/src/admin.ts`: `pages.versions` input and output extended, new `pages.version`. `apps/web/src/server/api.ts`: handler for `pages.version` (`content.write`).
- `packages/block-editor/src/HistoryPanel.tsx` (new) and `BlockEditor.tsx`: History tab, canvas preview, `history` prop. While previewing, edits, Save, Publish and Preview are refused and leaving the preview puts the page's own data back.
- `apps/admin/src/components/page-editor/PageVisualEditor.tsx`: wires the tab to the API; after a restore the page is re-read and the editor remounts.
- No migration: `page_versions.created_by` already existed (it was never written).

## Decisions and trade-offs
Open questions in the plan were not answered before the build, so the plan's proposals were used: keep every version, show the author, preview only (no diff), staff with `content.write` can look, `theme.publish` is needed to restore. Preview uses the live canvas (`setData`) rather than a second renderer; the guard against saving a preview is in `BlockEditor`. Versions saved before this change show no author.

## Verification
- Typecheck: contracts, domain, web, block-editor, admin pass. Lint: block-editor and admin have no errors (pre-existing warnings only).
- Unit: `packages/block-editor/test/history-panel.test.tsx`.
- Real-database tests written in `packages/domain/test/page-versions.int.test.ts` and `isolation.int.test.ts` (new `pages.version` case). **Not run locally**: Docker was not running on the dev machine, so these run first in CI.
- NOT verified: a browser walkthrough of the tab (list, preview, back to current, restore, restore at 375 px). Needs the local stack or a preview deploy.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (API list, theme flow paragraph)
- [x] ADR: not needed (follows the plan)
- [x] `DEPLOYMENT.md` / RUNBOOK: not needed
- [x] `progress.md` (in flight)

## Follow-ups and open questions
- Block-level diff in the confirm step; version labels; retention (all open in the plan, section 7).
- Walk through the tab in a browser before relying on it.

## Definition of done
No secrets or generated files; real-DB tests added but not yet run (CI will); browser check outstanding.

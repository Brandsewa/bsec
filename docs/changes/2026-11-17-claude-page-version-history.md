# Page version history: History tab and safe restore

- **Date:** 2026-11-17
- **Agent:** claude
- **Branch:** `feat/page-version-history` (merged in #284, 6bff0ea)
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
- Real-database tests in `packages/domain/test/page-versions.int.test.ts` (6) and `isolation.int.test.ts` (new `pages.version` case) were run locally against Postgres once Docker was started: `page-versions`, `isolation`, `media-document-usages` and `themes` suites pass (1873 tests).
- Browser walkthrough done on the local stack (real Postgres, seeded demo store, "About us" page), read through the DOM because screenshots timed out with the window hidden: the History tab lists versions with author, block count and Live marker; previewing shows the old version, disables Save draft and a click on Publish is refused with "You are previewing an old version" (Publish and Preview stay enabled, the guard is in the handlers); Back to current returns the canvas to the page's own blocks; restore asks for confirmation, creates a new "Restored" version by the signed-in owner and keeps the old ones; restoring the earlier version again undoes it.
- At 375 px the version list fits with no horizontal scroll, but the History button in the editor's side rail sits off-screen (x=462), so on a phone it is not tappable. Likely how the editor lays out the rail at that width; not fixed here.
- NOT tested: editing then previewing (dirty snapshot), "Preview on store" during a preview, many versions (paging in the UI), the Header/Footer restore warning, a restore by a user without `theme.publish`.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (API list, theme flow paragraph)
- [x] ADR: not needed (follows the plan)
- [x] `DEPLOYMENT.md` / RUNBOOK: not needed
- [x] `progress.md` (in flight)

## Follow-ups and open questions
- Block-level diff in the confirm step; version labels; retention (all open in the plan, section 7).
- Make the History rail button reachable at phone width (see Verification).
- Cover the untested cases listed under Verification.

## Definition of done
No secrets or generated files; real-DB tests added and run locally; browser walkthrough done at desktop width, phone-width rail access open.

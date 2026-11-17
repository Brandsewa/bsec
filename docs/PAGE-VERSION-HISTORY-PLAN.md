# Page version history and restore (theme and page editor)

- **Status:** proposed, not started. Owner decision needed on the open questions in section 7.
- **Author:** Claude Code, 2026-11-17
- **Why now:** on 2026-11-16/17 a store's Header page and Home page were overwritten by a stale-editor bug (fixed in #282). Recovery needed browser-console calls to `admin.pages.rollback` because the editor has no history screen. Every save already stores a full copy of the page, so the data exists; only the screen and a few server guards are missing.

## 1. What exists today (verified in code, 2026-11-17)

| Piece | Where | Behaviour |
|---|---|---|
| Version rows | `page_versions` (`document` JSON), written by `savePageDraft` in `packages/domain/src/content-services.ts` | One immutable row per Save draft / Publish. Nothing is ever pruned. |
| List | `listPageVersions` (same file) | id, note, createdAt, isPublished, isDraft. **Capped at 30 rows.** No document, no author. |
| Restore | `rollbackPage` (same file), contract `admin.pages.rollback` | Points `publishedVersionId` and `draftVersionId` at an old version (no new row) and invalidates the cache. Needs `theme.publish`. |
| UI | none | `apps/admin` never calls `pages.versions` or `pages.rollback`. |

Size on a live store (darjeelinghoney.com): Home about 20 KB of JSON, all 14 pages about 56 KB, 173 versions about 1.5 MB in total.

### Gaps found while writing this plan
1. **`rollbackPage` does not check the version belongs to the page.** It looks the version up by id only (RLS keeps it inside the tenant, but not inside the page). A wrong id would point Home at the Header's blocks, the same class of bug as the incident.
2. **No audit log.** Rollback changes live content but writes no `audit_logs` row (AGENTS.md rule 6).
3. **No way to read an old version's blocks**, so a person cannot tell which version to restore without restoring it live.
4. **No author on a version**, so "who saved this" cannot be shown.
5. Restore moves the draft pointer too, so any unsaved-draft work is dropped from view with no marker.

## 2. What other products do (research notes, 2026-11-17)

Sources are search summaries, not hands-on tests; check each vendor's current docs before quoting them.

- **WordPress**: revisions on by default, restore replaces the current content with no confirmation step, and sites cap the count (`WP_POST_REVISIONS`) or use a cleanup plugin. Lesson: keep history cheap, cap it, make the restore step explicit. [Hostinger guide](https://www.hostinger.com/tutorials/wordpress-revisions), [Kinsta](https://kinsta.com/blog/wordpress-revisions/).
- **Contentful**: view earlier versions, compare a snapshot with the current one, then restore; Experiences has its own version history. Lesson: **compare before restore**, restore as a deliberate action. [Versioning FAQ](https://www.contentful.com/help/faq/versioning/), [Experiences version history](https://www.contentful.com/help/studio/experiences/version-history-in-experiences/).
- **HubSpot**: the CMS API exposes list versions and a restore-version call. Lesson: our API already has this shape; the editor screen is the missing piece. [HubSpot restore PageVersion](https://developers.hubspot.com/docs/api-reference/legacy/cms/pages/v2/restore-PageVersion).
- **Squiz Page Builder**: a version history panel inside the editor. [Squiz docs](https://docs.squiz.net/page-builder/latest/version-history/using-version-history.html).
- **Shopify**: the theme editor's own history is limited and merchants often cannot find it; many rely on paid backup apps with 7 to 30 day windows. Lesson: a built-in, discoverable history is a real advantage for merchants. [Shopify community thread](https://community.shopify.com/t/help-i-need-to-restore-my-website-to-an-older-version/42894/1).
- **Webflow**: results were thin and dated; not relied on.

### Practices we adopt
1. History lives inside the editor, one click from the page being edited.
2. Preview (and ideally compare) before restore; restore is never one click.
3. Restore is non-destructive: it creates a new entry, so "undo the restore" is the same feature.
4. Show who and when, mark Live and Draft, and let people label a version.
5. Cap what the list loads, not what is stored; prune only by an explicit retention rule.
6. Restore needs the publish permission and is audited.

## 3. Proposed design

### 3.1 Server (packages/contracts, packages/domain, apps/web `api.ts`)
- **`admin.pages.versions`**: add `cursor` and `limit` (default 30, max 100); return `createdBy` (staff display name, nullable) and `blockCount`. Still no document, so the list stays small.
- **`admin.pages.version`** (new, `{ id, versionId }`): returns that version's `blocks`. Checks the version belongs to the page. Permission `content.write`.
- **`admin.pages.rollback`**: (a) verify the version's `pageId` equals `input.id` (gap 1); (b) **create a new version** copying the target's document, note `Restored from <date>`, and publish that instead of re-pointing at the old row (practice 3); (c) write an `audit_logs` row `page.restored` with the from and to version ids (gap 2); (d) keep the cache invalidation and tolerant media-usage sync.
- **`page_versions.created_by`**: new nullable column (expand step only per `docs/migrations.md`, no backfill; older rows show "Unknown"). Written by `savePageDraft` from `ctx.actor`.
- Optional version **label** through the existing `note` column (no migration).

### 3.2 Admin UI (apps/admin, packages/block-editor)
- New **History** entry in the editor's left rail (next to Theme, General, Header, Footer, Blocks, Outline), lazy-loaded with the editor bundle.
- Panel: list of versions (time, author, Live and Draft badges, optional label), "Load more".
- Selecting a version shows a **read-only preview** on the canvas using the existing renderer, with a banner "Previewing 16 Nov, 07:05" and two actions: **Restore this version** (confirm dialog from the shared kit, names the page and says it goes live) and **Back to current**.
- Optional second step: a plain block-level diff (added, removed, changed block types) in the confirm dialog. Not required for the first release.
- Header and Footer pages get the same panel, because they are pages too.
- Follows `docs/admin-ui-standards.md` (no native confirm, shared drawer and list components).

### 3.3 Out of scope
- Auto-restore, scheduled publish, branching, per-block history.
- Cross-store or cross-theme restore.
- Changing how drafts are saved (that was #282).

## 4. Cost (measured and estimated)

- Storage: one nullable column; each restore adds one row (about 20 KB for Home). Measured: 1.5 MB across 173 versions for a whole store. Worst case 100 pages x 100 saves x 20 KB is about 200 MB, almost always far less.
- Reads: the list returns ids and timestamps only; a version's blocks load only when clicked. The panel is lazy-loaded.
- Writes: restore is one insert and one pointer update, the same as a publish.
- Retention: not needed for launch. If wanted later, keep the latest N (for example 200) per page and never delete the live or draft version. Decide in section 7.

## 5. Work breakdown and acceptance criteria

1. **Server hardening (ship first, small).** Page check and audit log on `rollbackPage`; list cursor.
   *Accept:* real-DB test in `packages/domain/test/*.int.test.ts` proving a version id from another page is refused and an `audit_logs` row is written; `isolation.int.test.ts` updated for any new `admin.*` procedure.
2. **Read a version.** `admin.pages.version`.
   *Accept:* returns blocks for the page's own version, refuses another page's and another tenant's.
3. **Restore as a new version, plus `created_by`.** Expand-only migration; `savePageDraft` records the actor.
   *Accept:* restoring creates a new published version whose document equals the target; the old row is unchanged; migrations lock updated.
4. **History panel.** UI as in 3.2.
   *Accept:* in a browser, save three versions, preview the oldest, restore it, confirm the live storefront changes, then restore the previous one. Checked at 375 px and desktop.
5. **Docs.** `docs/ARCHITECTURE.md` (pages and versions), change record, `progress.md`.

Steps 1 and 3 are the safety work and are worth shipping even if the panel waits.

## 6. Risks
- Restoring over unsaved edits: the confirm dialog and the editor's unsaved-changes guard must both run first.
- Old versions can reference deleted media or removed block versions. `rollbackPage` already syncs media usage tolerantly; the preview must fall back to a placeholder, not crash.
- Cache: restore must invalidate the same tags as publish (`invalidatePageCache`).
- A restored header or footer affects every page, so the confirm text must say so.

## 7. Open questions for the owner
1. Keep every version forever, or prune (for example keep the latest 200 per page)?
2. Is "who saved it" (the `created_by` column) required for the first release?
3. Is a block-level diff wanted in the first release, or preview only?
4. Should staff without `theme.publish` be able to preview history but not restore? (Proposed: yes.)
5. Priority against the go-live hardening items.

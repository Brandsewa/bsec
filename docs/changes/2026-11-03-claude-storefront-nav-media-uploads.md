# Storefront navigation and Media in Super Admin, and the image upload fix

- **Date:** 2026-11-03
- **Agent:** claude
- **Branch:** `feat/storefront-nav-media` (not merged yet)
- **Area:** superadmin, content-admin, admin, platform image, domain, docs
- **Type:** feature and fix
- **Supersedes:** none

## Summary
Slice S1 of Phase 5 (`docs/MARKETING-SITE-CMS-PLAN.md` section 5a). The Super Admin group is now **Storefront**: Pages, Blogs, Navigation, Media, Settings. Two production bugs reported by the owner are fixed: image uploads failed, and adding a page failed with no reason.

## Root causes
- **Uploads:** the Platform runtime image has no `node_modules`, and `sharp` (the image library that reads an image's size on upload) is external to the esbuild bundle. `import("sharp")` therefore failed on every Marketing upload, and the server deleted the file and answered "corrupted or invalid image file". The worker image already installs `sharp`; the Platform image did not. Reproduced locally (the bundle could not resolve `sharp` either) and fixed.
- **Adding a page:** the server did reject the page, for example `home` is a reserved slug or the slug already exists. Those messages had no `Bad Request:` prefix, so the API turned them into a 500 and the screen showed "Failed to create page". The same hid the reason for stores. The cause of the owner's specific failure was not seen: the production log could not be read (Coolify session expired). With this change the screen shows the real reason.

## What changed
- `infra/docker/platform.Dockerfile` installs `sharp@0.35.5` next to the bundle; `apps/platform` lists `sharp` 0.35.5 so local runs resolve it. `apps/platform/test/image-sharp.test.ts` keeps both images on the domain package's version.
- `media-services.ts`: a missing `sharp` now says "Image processing is not available on this server" instead of blaming the file.
- `content-services.ts`: page and menu validation messages carry `Bad Request:` or `Not Found:` (26 messages), so the API returns 400 or 404 with the text. Real-database test added.
- Media screen, table helpers and pagination moved from `apps/admin` to `@bs/content-admin` (`MediaScreen`, `use-table-state`, `pagination`); the store admin keeps thin wrappers and re-exports.
- Super Admin: sidebar group Storefront; URLs `/storefront/pages|blog|navigation|media|settings`; `/marketing` redirects to Settings; Media added. API routes, audit action names and `marketing.*` procedures are unchanged.

## Decisions and trade-offs
- URLs moved to `/storefront/...` to match the new name; the API namespace stays `marketing` so nothing deployed outside the SPA changes.
- `sharp` is installed in the Platform image rather than moving uploads to the worker: the Marketing upload path already works through the server, and the worker image is for jobs.
- Settings is the old Website page for now; S2 grows it into sections.

## Verification
See the session's gate output. Driven in headless Chromium against local Platform and Super Admin: sidebar shows Pages, Blogs, Navigation, Media, Settings; `/marketing` lands on Settings; a rejected page shows "The URL slug "home" is reserved and cannot be used for a custom page." and "A page with the URL slug ... already exists."; a PNG uploaded through Media finished ("Uploads completed"), was stored, and counted 8.3 KB of storage.

NOT verified: uploads to real R2 (local used a local folder) and whether the browser-to-R2 direct upload needs CORS for `superadmin.bcom.si`; if it does not, the file falls back to the server upload automatically. The Platform image build with `npm install sharp` only runs on `main`: this PR cannot prove it, so watch the first `main` run (a failed image build stops before the deploy). The thumbnail in local Media is blank because local files are served by the web app, which was not running.

## Docs updated
- [x] `docs/MARKETING-SITE-CMS-PLAN.md` (section 5a)
- [x] ADR-042
- [x] `docs/ARCHITECTURE.md`

## Follow-ups and open questions
- S2 to S5 in the plan. Owner to confirm the defaults listed there.
- Upload folder for the website is `catalog` (the shared screen's default); a `website` folder would be tidier.

## Definition of done
Not done until merged: see `AGENTS.md` section 7.

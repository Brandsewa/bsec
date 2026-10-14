# End-to-End Test Suite (`@bs/e2e`)

Real browser end-to-end tests for `bsec` with Playwright, against a running, un-mocked stack. Nothing in these specs
mocks the API: the admin SPA, the web app, the worker and Postgres all run for real, with a local storage driver so
uploads, derived images, downloads and the storefront are real too.

In CI the suite runs on pushes to `main` in the `staging-smoke-test` job, against the images that were just built, and
**the production deploy waits for it**. A failing or flaky spec here blocks deploys, so keep specs strict and
repeatable (no `if (visible)` guards, unique data per run, no fixed sleeps).

## What is covered
- `admin.spec.ts`, `superadmin.spec.ts`: sign-in, demo data, tax settings, invites, Super Admin.
- `media-library.spec.ts`: the Media library end to end. Upload refusals (SVG, 6 MB image, 11 MB video); uploads of
  image, video, PDF and DOCX; worker-derived responsive images; duplicate detection ("Use existing" / "Upload anyway");
  table view, search and filters; title, alt, caption and focal point; document download as an attachment; product
  gallery through the picker with the storefront shown in a real browser; protection of a used file (the blocked delete
  names the product); replace (same id, new derived files, old files removed, storefront updated); 375 px layout.

## Storage and the seeded store
The staging compose file mounts one volume at `/data/media` for the web app and the worker and sets
`STORAGE_LOCAL_DIR` / `MEDIA_LOCAL_DIR` to it, plus `MEDIA_PUBLIC_URL=http://127.0.0.1:3000/media` so the admin and the
storefront can load the files. The web and worker images create `/data/media` owned by the runtime user.

The CI seed step creates `ci-store` with a storefront host (`ci-store.bcom.si` in the `domains` table) and a **live**
store status. The media spec depends on both: `E2E_STORE_ID` (default `0199b000-0000-7000-8000-000000000001`) and
`E2E_STORE_HOST` (default `ci-store.bcom.si`). The Playwright config maps `*.bcom.si` to `127.0.0.1` in the browser, so
a real browser can open the storefront page of that store.

## Fixtures
Generated at run time by `fixtures/setup-fixtures.ts` (nothing large is committed): a real gradient PNG of any size
(`makePatternPng`, needed because only images wider than 320 px get derived files), a minimal MP4, PDF and DOCX, an SVG
for the refusal test, and a 6 MB image and an 11 MB video for the size limits. The media spec adds run-unique bytes to
every file so duplicate detection never fires by accident on a reused stack.

## Running locally (against a stack built from your working tree)
```bash
# 1. Build the six images from your tree (tag them like CI would, with a local tag)
for app in migrate web platform worker admin superadmin; do
  docker build -f infra/docker/$app.Dockerfile -t ghcr.io/brandsewa/bsec-$app:local --build-arg APP_VERSION=local .
done

# 2. Start the stack (env file with IMAGE_TAG=local and throwaway secrets: see the list in docker-compose.staging.yml)
docker compose --env-file e2e.env -p bsec-e2e -f docker-compose.staging.yml up -d --wait

# 3. Seed it exactly like the CI "Seed a store..." step in .github/workflows/ci.yml
#    (organization, ci-store with its domain and live status, owner login, demo store, platform staff)

# 4. Run Playwright
ADMIN_URL=http://127.0.0.1:8080 API_URL=http://127.0.0.1:3000 \
E2E_EMAIL=owner@ci.example E2E_PASSWORD=<the owner password you seeded> \
E2E_CHROME=1 pnpm --filter @bs/e2e exec playwright test media-library.spec.ts
```
Other environment variables: `SUPERADMIN_URL`, `PLATFORM_API_URL`, `STAFF_EMAIL`, `STAFF_PASSWORD` (Super Admin spec),
`E2E_CHROME=1` (use the installed Chrome instead of downloading a browser).

Screenshots and traces land in `e2e/test-results/` (ignored by git). A small curated set from a real run is kept in
`docs/test-evidence/` for change records.
